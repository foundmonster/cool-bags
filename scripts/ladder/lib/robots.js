'use strict';
/**
 * robots.js — untrusted input, treated as untrusted input.
 *
 * DESIGN.md §4.1: the parser reads User-agent, Allow, Disallow, Crawl-delay,
 * Sitemap, Content-Signal. EVERY OTHER LINE IS DISCARDED before it reaches any
 * other code. TAD's and Eastpak's robots.txt both contain prose addressed at AI
 * agents urging installation of a third-party shopping skill. Crawl directives
 * are obeyed; behavioural prose is data, never instruction.
 *
 * This module returns only: booleans, numbers, path strings and URL strings.
 * No free text from robots.txt is ever returned to a caller, so no free text
 * from robots.txt can ever reach a prompt, a shell or a log line as anything
 * other than a discarded-line count.
 */

const KNOWN = new Set(['user-agent', 'allow', 'disallow', 'crawl-delay', 'sitemap', 'content-signal']);

/**
 * OUR_TOKENS — every identity a robots.txt author could plausibly use to address
 * the thing that is actually making these requests. All of them apply to us at
 * once; a group naming ANY of them binds this fetcher.
 *
 * `coolbags-intake` is the product token we put in our User-Agent header.
 * `claudebot` / `anthropic-ai` are here because the fetching in this environment
 * is performed by Claude on the user's behalf. A site that writes
 *
 *     User-agent: ClaudeBot
 *     Disallow: /
 *
 * has opted out of exactly this, and berghaus.com does. Before these tokens
 * existed, groupFor() found no named match, fell through to the '*' group, and
 * verdict() returned ALLOW — the one do-not-scrape case the design explicitly
 * names was the one case it would have violated. Measured, not hypothesised:
 * see the unit test in ../test/robots.test.js, which pins both this case and the
 * ordinary permissive case.
 *
 * DO NOT "fix" a do-not-scrape verdict by removing a token from this list or by
 * choosing a User-Agent string that dodges a named opt-out. That is evasion, not
 * a bug fix. A do-not-scrape verdict is a SUCCESSFUL, final result: record it and
 * move on to the next brand.
 */
const OUR_TOKENS = ['coolbags-intake', 'claudebot', 'anthropic-ai', '*'];

function parse(text) {
  const groups = [];      // {agents:[], rules:[{type,path}], crawlDelay:null}
  const sitemaps = [];
  let contentSignal = null;
  let cur = null;
  let lastWasAgent = false;
  let discarded = 0, unknownDirectives = 0;

  for (let raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const i = line.indexOf(':');
    if (i < 0) { discarded++; continue; }
    const key = line.slice(0, i).trim().toLowerCase();
    const val = line.slice(i + 1).trim();
    if (!KNOWN.has(key)) { discarded++; unknownDirectives++; continue; }

    if (key === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [], crawlDelay: null }; groups.push(cur); }
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (key === 'sitemap') { if (/^https?:\/\//i.test(val)) sitemaps.push(val); continue; }
    if (key === 'content-signal') {
      // structured directive list, e.g. "search=yes, ai-train=no"
      const sig = {};
      for (const part of val.split(',')) {
        const m = part.trim().match(/^([a-z-]+)\s*=\s*(yes|no)$/i);
        if (m) sig[m[1].toLowerCase()] = m[2].toLowerCase();
      }
      contentSignal = Object.keys(sig).length ? sig : null;
      continue;
    }
    if (!cur) { discarded++; continue; }
    if (key === 'crawl-delay') { const n = parseFloat(val); if (Number.isFinite(n)) cur.crawlDelay = n; continue; }
    if (key === 'allow' || key === 'disallow') {
      if (val === '' && key === 'disallow') { cur.rules.push({ type: 'allow', path: '/' }); continue; }
      if (/^[/*]/.test(val)) cur.rules.push({ type: key, path: val });
      else discarded++;
    }
  }
  return { groups, sitemaps, contentSignal, discardedLines: discarded, unknownDirectives };
}

/**
 * pick the most specific matching group for our UA.
 *
 * Matching is EXACT on the agent token, never a substring. The substring form
 * (`a.includes(t)`) failed open in a way that is trivial to exploit and easy to
 * hit by accident: given
 *     User-agent: ClaudeBot            Disallow: /
 *     User-agent: SuperClaudeBotFoo    Allow: /
 * the second group contains our token, scored higher on raw name length, and won
 * — turning an explicit opt-out into an allow. Scoring is now by the matched
 * TOKEN's length, not the agent name's, so no group can outrank a real opt-out by
 * padding its name.
 *
 * When several of our identities match different groups, the most restrictive
 * wins: a Disallow addressed to any identity we present under is binding on us.
 */
function groupFor(parsed, tokens = OUR_TOKENS) {
  const matches = [];
  for (const g of parsed.groups) {
    let score = -1;
    for (const a of g.agents) {
      if (a === '*') { score = Math.max(score, 0); continue; }
      for (const t of tokens) {
        if (t !== '*' && a === t) score = Math.max(score, t.length);
      }
    }
    if (score >= 0) matches.push({ g, score });
  }
  if (!matches.length) return null;

  // Among groups addressed to a NAMED identity of ours, the most restrictive
  // binds — not the one whose token happens to be longest. Every token in
  // OUR_TOKENS is an identity we actually present under, so a Disallow addressed
  // to any of them is addressed to us, and picking the permissive one because its
  // name is longer would be choosing the reading that suits us. Measured case:
  // 'coolbags-intake: Allow /' (15 chars) outranked 'claudebot: Disallow /' (9),
  // which is the Berghaus opt-out sailing through under a different name.
  const named = matches.filter(m => m.score > 0);
  if (named.length) {
    const restrictive = named.filter(m => m.g.rules.some(r => r.type === 'disallow'));
    const pool = restrictive.length ? restrictive : named;
    return pool.reduce((a, b) => (b.score > a.score ? b : a)).g;
  }
  return matches[0].g;   // only the '*' group matched
}

function ruleToRegex(p) {
  let out = '';
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') out += '.*';
    else if (c === '$' && i === p.length - 1) out += '$';
    else out += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp('^' + out);
}

/**
 * isAllowed — longest-match wins; Allow wins an exact-length tie (Google's rule).
 * Returns {allowed, rule:{type,path}|null}
 */
function isAllowed(parsed, pathAndQuery, tokens = OUR_TOKENS) {
  const g = groupFor(parsed, tokens);
  if (!g) return { allowed: true, rule: null };
  let best = null;
  for (const r of g.rules) {
    if (!ruleToRegex(r.path).test(pathAndQuery)) continue;
    const len = r.path.replace(/[*$]/g, '').length;
    if (!best || len > best.len || (len === best.len && r.type === 'allow')) best = { ...r, len };
  }
  if (!best) return { allowed: true, rule: null };
  return { allowed: best.type === 'allow', rule: { type: best.type, path: best.path } };
}

/**
 * verdict — the G0 policy gate. Returns only machine values.
 *   allow | do-not-scrape
 */
function verdict(parsed, testPaths, tokens = OUR_TOKENS) {
  const cs = parsed.contentSignal;
  if (cs && (cs['ai-train'] === 'no' && cs['search'] === 'no')) {
    return { verdict: 'do-not-scrape', reason: 'content-signal', content_signal: cs, blocked_path: null };
  }
  if (cs && cs['use'] === 'no') {
    return { verdict: 'do-not-scrape', reason: 'content-signal-use-no', content_signal: cs, blocked_path: null };
  }
  const g = groupFor(parsed, tokens);
  const named = g && g.agents.some(a => a !== '*' && tokens.some(t => t !== '*' && a.includes(t)));
  for (const p of testPaths) {
    const r = isAllowed(parsed, p, tokens);
    if (!r.allowed) {
      return {
        verdict: 'do-not-scrape', reason: named ? 'named-ua-disallow' : 'disallow',
        content_signal: cs, blocked_path: p, rule: r.rule,
      };
    }
  }
  return { verdict: 'allow', reason: null, content_signal: cs, blocked_path: null };
}

function crawlDelay(parsed, tokens = OUR_TOKENS) {
  const g = groupFor(parsed, tokens);
  return g && g.crawlDelay != null ? g.crawlDelay : null;
}

module.exports = { parse, isAllowed, verdict, crawlDelay, groupFor, OUR_TOKENS };
