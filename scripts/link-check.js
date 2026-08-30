#!/usr/bin/env node
/**
 * link-check.js — verify that every `link` in bags.json still reaches the
 * product it claims to.
 *
 *   node scripts/link-check.js                    # every record
 *   node scripts/link-check.js --brand Urth       # one brand
 *   node scripts/link-check.js --limit 40         # first N records
 *   node scripts/link-check.js --json out.json    # machine-readable report
 *
 * Node 22, stdlib only, no npm dependencies. Politeness, cookies, redirect
 * hop tracking and robots parsing are reused from scripts/ladder/lib/ rather
 * than reimplemented — one HTTP layer for the whole project, one place where
 * an opt-out is honoured.
 *
 * WHY A STATUS CODE IS NOT ENOUGH
 *
 * The defect that motivated this file returns HTTP 200. urth.co serves
 * /products/tech-organiser-ash — a colourway handle that has been retired —
 * as its own homepage, with `<link rel="canonical" href="https://urth.co/">`
 * and the homepage's <title>. A checker that reads only the status code calls
 * that link healthy. A person who clicks it lands on a store's front door with
 * no idea which bag they were promised.
 *
 * So every 200 is interrogated three ways, cheapest first:
 *
 *   1. Where did the redirect chain actually end? A final URL whose pathname
 *      is "/" is a homepage, whatever the status said.
 *   2. What does the page say it is? A rel=canonical pointing at "/" is the
 *      site telling us, in its own markup, that this is not a product page.
 *   3. Does it look identical to the homepage? We fetch each host's homepage
 *      once and compare <title>. Equal titles mean the "product page" is the
 *      homepage wearing a product URL.
 *
 * Test 3 is the loosest and it is deliberately reported at lower confidence:
 * a handful of small brands do use one <title> across the whole site. Those
 * come back as `suspect`, not `broken`, because a checker that cries wolf gets
 * ignored — which is how this catalog accumulated the defects it has.
 *
 * ROBOTS
 *
 * Policy is resolved per origin and honoured before any product URL on that
 * origin is requested. A host that disallows us is reported as
 * `skipped-opt-out` and its links are left UNKNOWN rather than guessed at.
 * Kelty is the live example: 21 records, and kelty.com names our user-agent
 * and disallows "/". Not knowing is the correct output there. Do not add a
 * flag that overrides this.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { fetchUrl, Store } = require('./ladder/lib/http.js');
const robots = require('./ladder/lib/robots.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'ladder', '.cache', '_linkcheck');
const HOST_CONCURRENCY = 6;

// ---------------------------------------------------------------- verdicts

const BROKEN = new Set(['http-error', 'unreachable', 'redirects-to-homepage', 'canonical-is-homepage', 'js-redirect-stub']);
const SUSPECT = new Set(['title-matches-homepage']);
const UNKNOWN = new Set(['skipped-opt-out', 'blocked', 'no-link']);

// ------------------------------------------------------------------ helpers

function tagText(html, re) {
  const m = html.match(re);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

const titleOf = (html) => tagText(html, /<title[^>]*>([^<]*)</i);
const canonicalOf = (html) => tagText(html, /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
  || tagText(html, /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);

function pathnameOf(url) {
  try { return new URL(url).pathname.replace(/\/+$/, '') || '/'; } catch { return null; }
}

/** A product URL that ends up here is not showing a product. */
const isHomepagePath = (p) => p === '/' || p === '';

// -------------------------------------------------------------- the check

async function policyFor(store, origin) {
  const r = await fetchUrl(store, origin + '/robots.txt', { timeoutMs: 15000 });
  // RFC 9309 §2.3.1.4 is implemented inside robots.parse: 4xx means no file
  // (allow), 5xx/timeout means assume disallow. "We could not read your rules"
  // is not consent, so an unreadable robots.txt stops us here too.
  const parsed = robots.parse(r.body ? r.body.toString() : '', r.status == null ? 599 : r.status);
  return robots.verdict(parsed, ['/products/', '/']);
}

async function homepageBaseline(store, origin) {
  try {
    const r = await fetchUrl(store, origin + '/', { timeoutMs: 20000 });
    if (r.error || !r.body) return null;
    const html = r.body.toString();
    return { title: titleOf(html), finalPath: pathnameOf(r.final_url || origin + '/') };
  } catch { return null; }
}

async function checkOne(store, rec, baseline) {
  const r = await fetchUrl(store, rec.link, { timeoutMs: 25000 });

  if (r.error) return { verdict: 'unreachable', detail: r.error };
  if (r.status === 403 || r.status === 429) {
    return { verdict: 'blocked', detail: `HTTP ${r.status} — the site refused us, which says nothing about the link` };
  }
  if (r.status >= 400) return { verdict: 'http-error', detail: `HTTP ${r.status}`, status: r.status };

  const finalUrl = r.final_url || rec.link;
  const finalPath = pathnameOf(finalUrl);
  if (isHomepagePath(finalPath)) {
    return { verdict: 'redirects-to-homepage', detail: `ends at ${finalUrl}`, final_url: finalUrl, hops: r.redirect_hops };
  }

  const html = r.body ? r.body.toString() : '';

  // A parked domain answers 200 for every path with a stub whose only content is
  // a JS redirect. halfdayco.com serves 114 bytes —
  //   <script>window.onload=function(){window.location.href="/lander"}</script>
  // — for /products/anything, so status, final URL, canonical and title checks all
  // pass and six live records scored `ok` while pointing at a dead brand domain.
  // A body this small with a scripted location assignment is not a product page.
  if (html.length < 4096 && /window\.location(\.href)?\s*=/.test(html) && !/<title[^>]*>[^<]/i.test(html)) {
    return { verdict: 'js-redirect-stub', detail: `HTTP 200 but the body is a ${html.length}-byte JS redirect stub, not a product page`, final_url: finalUrl };
  }

  const canon = canonicalOf(html);
  if (canon && isHomepagePath(pathnameOf(canon))) {
    return { verdict: 'canonical-is-homepage', detail: `HTTP 200 but rel=canonical is ${canon}`, canonical: canon, final_url: finalUrl };
  }

  const title = titleOf(html);
  if (baseline && baseline.title && title && title === baseline.title) {
    return { verdict: 'title-matches-homepage', detail: `<title> is byte-equal to the homepage's: ${JSON.stringify(title.slice(0, 60))}`, final_url: finalUrl };
  }

  return { verdict: 'ok', detail: null, final_url: finalUrl, title };
}

// ------------------------------------------------------------------ driver

async function checkHost(origin, records, results, log) {
  const store = new Store(path.join(CACHE, origin.replace(/[^a-z0-9]+/gi, '-')));

  let policy;
  try { policy = await policyFor(store, origin); }
  catch (e) { policy = { verdict: 'do-not-scrape', reason: 'robots-unreadable: ' + e.message }; }

  if (policy.verdict !== 'allow') {
    log(`${origin.padEnd(38)} ${String(records.length).padStart(3)} links  SKIPPED — ${policy.reason || 'robots'}`);
    for (const rec of records) {
      results.push({ ...idOf(rec), verdict: 'skipped-opt-out', detail: `${origin} robots.txt: ${policy.reason || 'disallow'}${policy.rule ? ` (${typeof policy.rule === 'string' ? policy.rule : [policy.rule.type, policy.rule.value].filter(Boolean).join(' ')})` : ''}` });
    }
    return;
  }

  const baseline = await homepageBaseline(store, origin);
  let bad = 0;
  for (const rec of records) {
    const out = await checkOne(store, rec, baseline);
    if (BROKEN.has(out.verdict) || SUSPECT.has(out.verdict)) bad++;
    results.push({ ...idOf(rec), ...out });
  }
  log(`${origin.padEnd(38)} ${String(records.length).padStart(3)} links  ${bad ? bad + ' need attention' : 'all ok'}`);
}

const idOf = (rec) => ({ id: rec.id, brand: rec.brand, name: rec.name, link: rec.link });

async function pool(items, n, fn) {
  const queue = items.slice();
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

// -------------------------------------------------------------------- main

async function main() {
  const argv = process.argv.slice(2);
  const arg = (name) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };
  const brand = arg('--brand');
  const limit = arg('--limit') ? parseInt(arg('--limit'), 10) : null;
  const jsonOut = arg('--json');

  let bags = JSON.parse(fs.readFileSync(path.join(ROOT, 'bags.json'), 'utf8'));
  if (brand) bags = bags.filter((b) => (b.brand || '').toLowerCase() === brand.toLowerCase());
  if (limit) bags = bags.slice(0, limit);

  const results = [];
  const byHost = new Map();
  for (const rec of bags) {
    if (!rec.link) { results.push({ ...idOf(rec), verdict: 'no-link', detail: 'record has no link' }); continue; }
    let origin;
    try { origin = new URL(rec.link).origin; }
    catch { results.push({ ...idOf(rec), verdict: 'unreachable', detail: 'unparseable URL' }); continue; }
    if (!byHost.has(origin)) byHost.set(origin, []);
    byHost.get(origin).push(rec);
  }

  const started = Date.now();
  console.log(`Checking ${bags.length} links across ${byHost.size} hosts. Requests are serial per host, >=2s apart.\n`);
  await pool([...byHost.entries()], HOST_CONCURRENCY, ([origin, recs]) => checkHost(origin, recs, results, console.log));

  // ------------------------------------------------------------- report
  const by = (set) => results.filter((r) => set.has(r.verdict));
  const broken = by(BROKEN), suspect = by(SUSPECT), unknown = by(UNKNOWN);
  const ok = results.filter((r) => r.verdict === 'ok');

  const section = (title, rows, note) => {
    if (!rows.length) return;
    console.log(`\n${title} — ${rows.length}`);
    if (note) console.log(`  ${note}`);
    const groups = new Map();
    for (const r of rows) { if (!groups.has(r.verdict)) groups.set(r.verdict, []); groups.get(r.verdict).push(r); }
    for (const [verdict, rs] of groups) {
      console.log(`\n  [${verdict}]  ${rs.length}`);
      for (const r of rs.slice(0, 40)) {
        console.log(`    · #${r.id} ${r.brand} — ${r.name}`);
        console.log(`        ${r.link}`);
        if (r.detail) console.log(`        ${r.detail}`);
      }
      if (rs.length > 40) console.log(`    … ${rs.length - 40} more (use --json for the full list)`);
    }
  };

  section('BROKEN', broken, 'These do not reach the product. Every one needs a corrected URL or a deleted record.');
  section('SUSPECT', suspect, 'Lower confidence: some small sites legitimately reuse one <title>. Open one before trusting the class.');
  section('UNKNOWN', unknown, 'Not checked, and deliberately not guessed at.');

  console.log(`\nSUMMARY: ${results.length} links | ${ok.length} ok | ${broken.length} broken | ${suspect.length} suspect | ${unknown.length} unknown` +
    ` | ${Math.round((Date.now() - started) / 1000)}s`);

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ at: new Date().toISOString(), counts: { total: results.length, ok: ok.length, broken: broken.length, suspect: suspect.length, unknown: unknown.length }, results }, null, 2));
    console.log(`report: ${jsonOut}`);
  }

  process.exit(broken.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
