'use strict';
/**
 * strategies.js — the ladder's memory. Reads and writes scripts/ladder/strategies.json.
 *
 * ============================ WHY THIS FILE EXISTS ============================
 *
 * BLOCKED-BRANDS.md was this project's previous memory. It was a PERMANENT record
 * of failure with no expiry: a brand written down as "403 / bot-protected" stayed
 * written down forever, and nobody re-tested it. A re-test of 11 of those brands
 * found 10 reachable. Five of them hand over their ENTIRE catalog to one
 * unauthenticated curl:
 *
 *     Eastpak 212 products · Demobaza 250 · Heimplanet 237 · Matador 191 · Killspencer 123
 *
 * That is roughly 1,200 products this project did not have because a failure
 * record never expired. Two of the recorded "blocks" were never the site's doing
 * at all: Magpul's CSP header alone is 14,519 bytes and overflowed Node's default
 * 16 KB maxHeaderSize (curl is indifferent), and Eastpak had replatformed to
 * Shopify at us.eastpak.com, so the old Akamai 403s came from a site that no
 * longer serves the catalog. The tool was broken and the note blamed the brand.
 *
 * Hence the two rules this module implements, and they pull in opposite
 * directions on purpose:
 *
 *   a. SUCCESS IS STICKY BUT CHECKED. The next run starts at the recorded winning
 *      rung instead of climbing from scratch. If that rung no longer works we
 *      fall through the remaining rungs, record the new winner, and append a
 *      history entry naming the change. Stickiness saves requests; it never
 *      suppresses a re-test of the rung it is sticking to.
 *
 *   b. FAILURE VERDICTS EXPIRE — see EXPIRY_DAYS below. This is the single most
 *      important rule in the file.
 *
 * ============================== SCHEMA ==============================
 *
 * The file is one JSON object. Every timestamp is ISO-8601 UTC. Every count in
 * it came from a response that was actually received — nothing here is estimated.
 *
 * {
 *   "version":      1,
 *   "expiry_days":  90,            // failure freshness window; see EXPIRY_DAYS
 *   "updated_at":   "2026-08-15T…",
 *
 *   "brands": {                    // keyed by slug (hostname's first label)
 *     "<slug>": {
 *       "brand":     "Tom Bihn",   // display name, from --brand, else null
 *       "domain":    "www.tombihn.com",
 *       "issue":     42,           // GitHub issue number, from --issue, else null
 *       "platform":  "shopify",    // storefront signature; see lib/ladder.js fingerprint()
 *       "signals":   ["robots:shopify-collections-sort_by", …],  // literal evidence
 *
 *       "winner": {                // null until some rung returns product data
 *         "rung":       "B",
 *         "url":        "https://…/products.json?limit=250",
 *         "returned":   { "products": 155, "listings_est": 90, "bytes": 812345,
 *                         "sha256": "…", "structure_fingerprint": "…" },
 *         "at":         "2026-08-15T…",   // last date this rung was CONFIRMED working
 *         "first_seen": "2026-05-02T…"    // first date it ever won
 *       },
 *
 *       "attempts": {              // keyed by rung: the LAST outcome for that rung
 *         "A": { "ok": false, "code": "no-structured-product-in-static-html",
 *                "status": 200, "bytes": 41022, "url": "https://…", "at": "2026-08-15T…" },
 *         "B": { "ok": true,  "code": null, "status": 200, … }
 *       },
 *
 *       "policy": {                // last robots.txt verdict — AUDIT ONLY, never a gate
 *         "verdict": "do-not-scrape",
 *         "reason":  "named-ua-disallow",
 *         "rule":    { "type": "disallow", "path": "/" },   // the rule that triggered it
 *         "blocked_path": "/",
 *         "robots_sha256": "…",
 *         "at": "2026-08-15T…"
 *       },
 *
 *       "history": [               // append-only; every change of winning rung
 *         { "at": "…", "from": "B", "to": "A", "note": "rung B returned html-at-json-url" }
 *       ]
 *     }
 *   },
 *
 *   "platforms": {                 // cross-brand priors, so a NEW brand with a
 *     "shopify": {                 // known signature starts where that signature works
 *       "wins":       { "B": 31, "A": 2 },   // winning-rung tally across brands
 *       "start_rung": "B",                   // argmax(wins)
 *       "brands":     33,
 *       "updated_at": "2026-08-15T…"
 *     }
 *   }
 * }
 *
 * ------------------------- what is NOT in here -------------------------
 * No free text from any fetched page or robots.txt. `code` values are a closed
 * vocabulary produced by lib/ladder.js assertShape() and this module; `rule` is a
 * {type,path} pair the robots parser already reduced to machine values. Anything
 * a site author wrote stays out of this file, because this file gets read back
 * into a running program and, eventually, into a prompt.
 */

const fs = require('fs');
const path = require('path');

const VERSION = 1;

/**
 * EXPIRY_DAYS — how long a RECORDED FAILURE is trusted before it is re-tested.
 *
 * ### DO NOT REMOVE THIS. DO NOT RAISE IT TO "SAVE REQUESTS". ###
 *
 * A rung recorded as failing is skipped on the next run only while that record is
 * younger than this window. Once it is older, the rung is TRIED AGAIN even though
 * we "know" it fails. That re-test is not waste; it is the whole point.
 *
 * The cost of this rule is a handful of extra HTTP requests per brand per quarter.
 * The cost of NOT having it is measured and known: BLOCKED-BRANDS.md was wrong
 * about 10 of the 11 brands it condemned, and being wrong cost ~1,200 products.
 * Sites replatform (Eastpak moved to Shopify), unblock, drop a WAF rule, or ship
 * JSON-LD they did not have last quarter. A permanent "no" encodes the assumption
 * that the web is static, and the web is not static.
 *
 * SUCCESS is not expired by this window — a winning rung stays the starting point
 * indefinitely, but it is re-run every probe, so it self-corrects the moment it
 * stops working. Only the word "no" gets a shelf life here.
 */
const EXPIRY_DAYS = 90;

const RUNG_ORDER = ['A', 'B', 'C', 'D'];

/**
 * SKIPPABLE — rungs memory is allowed to skip.
 *
 * Rung A is deliberately absent. Its fetches are not only a rung attempt: they
 * are also how the probe discovers and validates which candidate URLs are real
 * product pages, and rung C renders exactly the candidates rung A confirmed
 * returned 200. Skipping A would leave C with nothing trustworthy to render, so
 * A is always climbed. It is also the cheapest rung, so there is little to save.
 * Listing A as "skipped" in a plan it then ignores would make the plan a lie.
 */
const SKIPPABLE = ['B', 'C', 'D'];
const DAY_MS = 86400000;

function emptyRegistry() {
  return { version: VERSION, expiry_days: EXPIRY_DAYS, updated_at: null, brands: {}, platforms: {} };
}

function defaultPath() { return path.resolve(__dirname, '..', 'strategies.json'); }

/** load — never throws. A missing or corrupt registry is an empty registry, not a crash. */
function load(file = defaultPath()) {
  let reg;
  try { reg = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return emptyRegistry(); }
  if (!reg || typeof reg !== 'object') return emptyRegistry();
  reg.version = reg.version || VERSION;
  reg.expiry_days = Number.isFinite(reg.expiry_days) ? reg.expiry_days : EXPIRY_DAYS;
  reg.brands = reg.brands && typeof reg.brands === 'object' ? reg.brands : {};
  reg.platforms = reg.platforms && typeof reg.platforms === 'object' ? reg.platforms : {};
  return reg;
}

/** save — atomic, sorted, stable. Sorted keys keep the committed diff readable. */
function save(reg, file = defaultPath()) {
  reg.updated_at = new Date().toISOString();
  const sorted = {
    version: reg.version, expiry_days: reg.expiry_days, updated_at: reg.updated_at,
    brands: sortKeys(reg.brands), platforms: sortKeys(reg.platforms),
  };
  const data = JSON.stringify(sorted, null, 2) + '\n';
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp' + process.pid;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  return file;
}

function sortKeys(o) {
  const out = {};
  for (const k of Object.keys(o).sort()) out[k] = o[k];
  return out;
}

function ageDays(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? (now - t) / DAY_MS : Infinity;
}

/**
 * isStale — has this recorded outcome outlived the expiry window?
 * An outcome with no parseable date is stale (age Infinity): we do not trust a
 * failure we cannot date.
 */
function isStale(entry, now = Date.now(), expiryDays = EXPIRY_DAYS) {
  if (!entry || !entry.at) return true;
  return ageDays(entry.at, now) > expiryDays;
}

/**
 * planFor — what order should we climb, and may we skip anything?
 *
 * Returns { order, start, source, skip:[{rung,code,age_days}], retest:[{rung,…}], note }
 *
 *   source = 'brand-winner'   this brand has a recorded winning rung -> start there
 *          | 'platform-prior' new brand, but its signature has a known best rung
 *          | 'default'        nothing known -> cheapest-first A,B,C,D
 *
 * A rung lands in `skip` ONLY when its last recorded outcome is a failure AND that
 * record is still inside the expiry window. A failure older than the window lands
 * in `retest` instead and is climbed normally. The winning rung is never skipped.
 */
function planFor(reg, { slug, platform } = {}, now = Date.now()) {
  const expiry = reg.expiry_days || EXPIRY_DAYS;
  const b = reg.brands[slug] || null;
  const plat = platform && reg.platforms[platform] ? reg.platforms[platform] : null;

  let order = RUNG_ORDER.slice();
  let source = 'default';
  let start = order[0];
  let note = 'no memory for this brand or platform; climbing cheapest-first';

  if (b && b.winner && b.winner.rung) {
    start = b.winner.rung;
    order = [start, ...RUNG_ORDER.filter(r => r !== start)];
    source = 'brand-winner';
    note = `rung ${start} last confirmed working ${Math.round(ageDays(b.winner.at, now))}d ago`;
  } else if (plat && plat.start_rung) {
    start = plat.start_rung;
    order = [start, ...RUNG_ORDER.filter(r => r !== start)];
    source = 'platform-prior';
    note = `new brand; ${plat.brands} known ${platform} brand(s) win at rung ${start}`;
  }

  const skip = [], retest = [];
  const attempts = (b && b.attempts) || {};
  for (const r of SKIPPABLE) {
    if (r === start) continue;                       // never skip where we start
    const a = attempts[r];
    if (!a || a.ok) continue;                        // unknown or previously OK -> try it
    const age = Math.round(ageDays(a.at, now));
    if (isStale(a, now, expiry)) {
      retest.push({ rung: r, code: a.code || null, age_days: age,
                    why: `failure record older than ${expiry}d — re-testing rather than trusting it` });
    } else {
      skip.push({ rung: r, code: a.code || null, age_days: age,
                  expires_in_days: Math.max(0, expiry - age) });
    }
  }
  return { order, start, source, note, skip, retest, expiry_days: expiry };
}

/** shouldTry — the per-rung question probe.js asks. Mirrors planFor's skip logic. */
function shouldTry(plan, rung) {
  const s = plan.skip.find(x => x.rung === rung);
  if (s) return { try: false, reason: `skipped: recorded ${s.code} ${s.age_days}d ago, expires in ${s.expires_in_days}d` };
  const r = plan.retest.find(x => x.rung === rung);
  if (r) return { try: true, reason: `re-testing: ${r.code} recorded ${r.age_days}d ago, past the ${plan.expiry_days}d window` };
  return { try: true, reason: rung === plan.start ? `starting rung (${plan.source})` : 'no fresh record' };
}

/**
 * record — fold one probe result into the registry.
 * `probe` is probe.js's `out` object. Returns {changed:[], note} describing what moved.
 */
function record(reg, probe, now = new Date()) {
  const at = now.toISOString();
  const slug = probe.slug;
  const prev = reg.brands[slug] || null;
  const b = reg.brands[slug] = Object.assign({
    brand: null, domain: null, issue: null, platform: null, signals: [],
    winner: null, attempts: {}, policy: null, history: [],
  }, prev || {});

  if (probe.brand) b.brand = probe.brand;
  if (probe.domain) b.domain = probe.domain;
  if (probe.issue != null) b.issue = probe.issue;
  if (probe.platform) b.platform = probe.platform;
  if (Array.isArray(probe.signals)) b.signals = probe.signals;

  const changed = [];

  /* --- policy. AUDIT ONLY. robots.txt is re-read on every probe; this is the
     record of what it said, never a substitute for asking. A cached "blocked"
     that is trusted without re-asking is exactly how BLOCKED-BRANDS.md happened. */
  if (probe.policy) {
    const p = probe.policy;
    const before = b.policy && b.policy.verdict;
    b.policy = {
      verdict: p.verdict, reason: p.reason || null,
      rule: p.rule || null, blocked_path: p.blocked_path || null,
      robots_sha256: p.robots_sha256 || null, crawl_delay: p.crawl_delay ?? null, at,
    };
    if (before && before !== p.verdict) {
      b.history.push({ at, from_verdict: before, to_verdict: p.verdict, note: 'robots.txt verdict changed' });
      changed.push(`policy ${before} -> ${p.verdict}`);
    } else if (!before) {
      changed.push(`policy recorded: ${p.verdict}${p.reason ? ' (' + p.reason + ')' : ''}`);
    }
  }

  /* --- every rung attempted, and why it failed.
     A rung we SKIPPED because its failure was still fresh is deliberately not
     re-stamped. Re-stamping it would reset the age clock on every run, the record
     would never reach the expiry window, and the skip would become permanent —
     which is precisely the BLOCKED-BRANDS.md failure this module exists to
     prevent. A skip is not evidence; only a request is. */
  for (const r of probe.ladder || []) {
    if (!r.rung || r.skipped) continue;
    // A rung may appear more than once (rung C renders several candidates). A
    // single success is what matters, so never let a later failure row overwrite
    // a recorded success for the same rung in the same run.
    const already = b.attempts[r.rung];
    if (already && already.at === at && already.ok && !r.viable) continue;
    b.attempts[r.rung] = {
      ok: !!r.viable,
      code: r.viable ? null : (r.code || (r.status ? 'http-' + r.status : 'unknown')),
      status: r.status ?? null,
      bytes: r.bytes ?? null,
      url: r.url || null,
      at,
    };
  }

  /* --- the winner, and whether it moved (rule a: sticky but checked) */
  if (probe.rung) {
    const row = (probe.ladder || []).find(r => r.rung === probe.rung && r.viable) || {};
    const wasRung = prev && prev.winner ? prev.winner.rung : null;
    b.winner = {
      rung: probe.rung,
      url: row.url || probe.sample_pdp || null,
      returned: {
        products: row.products ?? (probe.yield ? probe.yield.products : null) ?? null,
        listings_est: probe.yield ? probe.yield.listings_est ?? null : null,
        bytes: row.bytes ?? null,
        sha256: row.sha256 || null,
        structure_fingerprint: row.fingerprint || null,
      },
      at,
      first_seen: (prev && prev.winner && prev.winner.rung === probe.rung && prev.winner.first_seen) || at,
    };
    if (wasRung && wasRung !== probe.rung) {
      const why = (b.attempts[wasRung] && b.attempts[wasRung].code) || 'no longer viable';
      b.history.push({ at, from: wasRung, to: probe.rung, note: `rung ${wasRung} stopped working: ${why}` });
      changed.push(`winner ${wasRung} -> ${probe.rung} (${why})`);
    } else if (!wasRung) {
      b.history.push({ at, from: null, to: probe.rung, note: 'first winning rung recorded' });
      changed.push(`winner: none -> ${probe.rung}`);
    }
  } else if (prev && prev.winner) {
    b.history.push({ at, from: prev.winner.rung, to: null, note: 'no rung viable this run; previous winner retained for reference' });
    changed.push(`winner ${prev.winner.rung} -> none`);
  }

  rebuildPlatforms(reg);
  return { changed, note: changed.length ? changed.join('; ') : 'no change' };
}

/**
 * rebuildPlatforms — derive the cross-brand priors from the brand records.
 * Derived, never hand-edited, so it cannot drift from the evidence underneath it.
 */
function rebuildPlatforms(reg) {
  const acc = {};
  for (const b of Object.values(reg.brands)) {
    if (!b.platform || !b.winner || !b.winner.rung) continue;
    const p = acc[b.platform] || (acc[b.platform] = { wins: {}, brands: 0 });
    p.wins[b.winner.rung] = (p.wins[b.winner.rung] || 0) + 1;
    p.brands++;
  }
  const at = new Date().toISOString();
  const out = {};
  for (const [k, v] of Object.entries(acc)) {
    const start = Object.entries(v.wins).sort((a, b) => b[1] - a[1] || RUNG_ORDER.indexOf(a[0]) - RUNG_ORDER.indexOf(b[0]))[0];
    out[k] = { wins: sortKeys(v.wins), start_rung: start ? start[0] : null, brands: v.brands, updated_at: at };
  }
  reg.platforms = out;
  return out;
}

/** staleEntries — brands with at least one failure record past the window, or never probed. */
function staleEntries(reg, now = Date.now()) {
  const expiry = reg.expiry_days || EXPIRY_DAYS;
  const out = [];
  for (const [slug, b] of Object.entries(reg.brands)) {
    const stale = [];
    for (const [rung, a] of Object.entries(b.attempts || {})) {
      if (!a.ok && isStale(a, now, expiry)) stale.push({ rung, code: a.code, age_days: Math.round(ageDays(a.at, now)) });
    }
    const dns = b.policy && b.policy.verdict === 'do-not-scrape';

    // A brand with NO winning rung and NO attempts rows was invisible here, because
    // this loop only ever walked b.attempts. Any run that stopped before the ladder
    // — host unreachable, no URL, robots unreadable — wrote no attempt, so it could
    // never age out and --retest-stale could never reach it. Measured on the first
    // real registry: 41 of 102 brands were permanently unreachable by the retest
    // machinery. That is the same permanent-failure trap this file exists to break,
    // so a bare policy/probe date counts as an ageable failure too.
    //
    // A genuine publisher opt-out (do-not-scrape from a robots rule addressed to us)
    // is deliberately NOT aged: it is a policy decision, not a measurement, and we do
    // not re-litigate it looking for a way in. Transient unreachability IS aged.
    const transient = !!(b.policy && b.policy.transient);
    const permanentOptOut = dns && !transient;
    if (!stale.length && !b.winner && !permanentOptOut) {
      const at = (b.policy && b.policy.checked_at) || (b.probe && b.probe.at) || b.updated_at || b.at;
      if (at && isStale({ at }, now, expiry)) {
        stale.push({
          rung: '-',
          code: (b.policy && b.policy.reason) || (b.verdict) || 'no-viable-rung',
          age_days: Math.round(ageDays(at, now)),
          note: 'no attempts recorded; aged on the probe date',
        });
      }
    }
    if (stale.length) out.push({ slug, domain: b.domain, platform: b.platform, do_not_scrape: dns, stale });
  }
  return out.sort((a, b) => b.stale.length - a.stale.length);
}

/** status — the shape --status prints. All numbers derived from the file. */
function status(reg, now = Date.now()) {
  const expiry = reg.expiry_days || EXPIRY_DAYS;
  const byRung = {}, byPlatform = {};
  let dns = 0, none = 0;
  for (const b of Object.values(reg.brands)) {
    if (b.policy && b.policy.verdict === 'do-not-scrape') dns++;
    const r = b.winner && b.winner.rung;
    if (r) byRung[r] = (byRung[r] || 0) + 1; else none++;
    const p = b.platform || 'unknown';
    byPlatform[p] = byPlatform[p] || { brands: 0, rungs: {} };
    byPlatform[p].brands++;
    if (r) byPlatform[p].rungs[r] = (byPlatform[p].rungs[r] || 0) + 1;
  }
  return {
    file: defaultPath(), version: reg.version, expiry_days: expiry, updated_at: reg.updated_at,
    brands: Object.keys(reg.brands).length,
    by_rung: byRung, no_viable_rung: none, do_not_scrape: dns,
    by_platform: byPlatform, platform_priors: reg.platforms,
    stale: staleEntries(reg, now),
  };
}

module.exports = {
  VERSION, EXPIRY_DAYS, RUNG_ORDER,
  load, save, defaultPath, emptyRegistry,
  planFor, shouldTry, record, rebuildPlatforms,
  isStale, ageDays, staleEntries, status,
};
