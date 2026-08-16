#!/usr/bin/env -S node --max-http-header-size=65536
'use strict';
/**
 * probe.js — discovery. Given a brand URL, report WHICH RUNG OF THE EXTRACTION
 * LADDER WORKS and what it found.
 *
 * DESIGN.md §4.1/§4.2. Two cheap requests decide the shape of the whole brand:
 * robots.txt, then one catalog probe. The Shopify fingerprint in robots.txt
 * (the stock template's `Disallow: /collections/*sort_by*`) predicts
 * /products.json availability before anything is downloaded.
 *
 * Every rung actually attempted is recorded in `ladder[]` with the URL, the
 * status, the bytes and the reason it did or did not work. A rung is never
 * reported as viable on a fingerprint alone -- it is reported viable because it
 * returned parseable product data, and the evidence is on disk.
 *
 *   node scripts/ladder/probe.js <url> [--brand "Name"] [--issue N] [--json]
 *   node scripts/ladder/probe.js --status         print the registry: brands by rung, stale entries
 *   node scripts/ladder/probe.js --retest-stale   re-probe verdicts older than the expiry window
 *
 * Also accepted: --slug <slug> (override the derived slug), --sample <url>
 * (probe this PDP instead of discovering one), --render (force rung C even when
 * a cheaper rung already worked), --force (bypass the response cache).
 *
 * Exit: 0 a usable rung was found · 3 do-not-scrape (a SUCCESSFUL, final result)
 *       1 no rung found / unreachable · 2 usage
 *
 * MEMORY. Every run consults and updates scripts/ladder/strategies.json via
 * lib/strategies.js: it starts at the rung that won last time, skips rungs whose
 * failure is still fresh, and RE-TESTS any failure older than the expiry window.
 * Read the header of lib/strategies.js before changing that behaviour — the
 * expiry rule is there because a permanent failure record cost this project
 * ~1,200 products.
 *
 * --max-http-header-size=65536 is in the shebang on purpose: Magpul's response
 * headers measure 15,747 bytes against Node's 16 KB default, and that was the
 * entire "Magpul is blocked" story.
 */
// The --max-http-header-size in the shebang applies ONLY when this file is run
// directly (./probe.js). README.md and the CLAUDE.md workflow both document
// `node scripts/ladder/probe.js`, and `node <file>` ignores a shebang entirely —
// so under the documented invocation the flag was inert. Reproduced against a
// server returning a 17,112-byte CSP header: `node probe.js` died with
// "Headers Overflow Error" and recorded robots-unreachable, while `./probe.js`
// succeeded. That is precisely the Magpul failure this flag exists to prevent,
// so re-exec once with the flag rather than depending on how we were invoked.
// Gated on require.main so that importing this module (the test suite does)
// never spawns a second process and never re-runs the CLI.
const NEEDED_HEADER_SIZE = 65536;
if (require.main === module
    && require('http').maxHeaderSize < NEEDED_HEADER_SIZE
    && !process.env.__LADDER_HEADER_REEXEC) {
  const r = require('child_process').spawnSync(
    process.execPath,
    [`--max-http-header-size=${NEEDED_HEADER_SIZE}`, __filename, ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __LADDER_HEADER_REEXEC: '1' } });
  process.exit(r.status == null ? 1 : r.status);
}

const fs = require('fs');
const path = require('path');
const http = require('./lib/http.js');
const robots = require('./lib/robots.js');
const ladder = require('./lib/ladder.js');
const htmlLib = require('./lib/html.js');
const fields = require('./lib/fields.js');
const render = require('./lib/render.js');
const strategies = require('./lib/strategies.js');

// Response bodies and per-brand probe artifacts. Regenerable and machine-local,
// so .cache/ is the one thing under scripts/ladder/ that IS gitignored —
// strategies.json, the code and the tests are all committed.
const STAGING = path.resolve(__dirname, '.cache');

const VALUE_FLAGS = ['slug', 'issue', 'sample', 'brand'];
const RENDER_CAP = 2;   // max headless-Chrome launches per probe; a probe is not a crawl

function args(argv) {
  const a = { _: [], flags: {} };
  for (let i = 2; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const eq = t.indexOf('=');
      const k = (eq > 0 ? t.slice(2, eq) : t.slice(2));
      if (eq > 0) a.flags[k] = t.slice(eq + 1);
      else if (VALUE_FLAGS.includes(k)) a.flags[k] = argv[++i];
      else a.flags[k] = true;
    } else a._.push(t);
  }
  return a;
}

const USAGE = [
  'usage:',
  '  probe.js <url> [--brand "Name"] [--issue N] [--json]',
  '  probe.js --status            print the registry: brands by rung, stale entries',
  '  probe.js --retest-stale      re-probe verdicts older than the expiry window',
  '',
  'exit: 0 usable rung · 3 do-not-scrape · 1 no rung found · 2 usage',
].join('\n');

/** slug — stable brand key: the hostname minus www. and minus the public suffix. */
function slugFor(u) {
  return new URL(u).hostname.replace(/^www\./, '').split('.')[0].toLowerCase();
}

function pct(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }

/**
 * findOptOut — does ANY brand in the registry carry a publisher opt-out that
 * covers this hostname? Checks the primary domain and every alternate_domains
 * entry, matching the host exactly or as a subdomain.
 *
 * Only a genuine publisher opt-out counts. A transient "we could not read your
 * robots.txt" deny is not an opt-out and must not become a permanent block.
 */
function findOptOut(reg, hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^www\./, '');
  if (!h) return null;
  const covers = (d) => {
    const x = String(d || '').toLowerCase().replace(/^www\./, '');
    return !!x && (x === h || h.endsWith('.' + x) || x.endsWith('.' + h));
  };
  for (const [slug, b] of Object.entries((reg && reg.brands) || {})) {
    const permanent = (b.policy && b.policy.verdict === 'do-not-scrape' && !b.policy.transient)
                      || b.do_not_scrape === true;
    if (!permanent) continue;
    const hosts = [b.domain, ...(b.alternate_domains || []).map(x => (typeof x === 'string' ? x : x && x.domain))];
    const hit = hosts.find(covers);
    if (hit) {
      const alt = (b.alternate_domains || []).find(x => x && x.domain && covers(x.domain));
      return { slug, brand: b.brand, matched: hit, note: (alt && alt.note) || (b.policy && b.policy.note) || null };
    }
  }
  return null;
}

/**
 * probeOne — probe a single brand. Returns {code, out, plan, memo} and NEVER
 * calls process.exit, so --retest-stale can run it in a loop.
 */
async function probeOne(input0, a, reg) {
  const ev = [];
  const quiet = !!a.flags.json;
  function event(type, data) {
    const e = { at: new Date().toISOString(), type, ...data };
    ev.push(e);
    if (quiet) return;
    const s = Object.entries(data || {}).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' ');
    process.stderr.write(`[${type}] ${s}\n`);
  }

  let input = input0;
  if (!/^https?:\/\//.test(input)) input = 'https://' + input;
  const origin0 = new URL(input).origin;
  const slug = a.flags.slug || slugFor(input);
  const dir = path.join(STAGING, slug);
  const store = new http.Store(path.join(dir, 'raw'));
  const out = {
    slug, brand: a.flags.brand || null, issue: a.flags.issue ? Number(a.flags.issue) : null,
    input_url: input, domain: new URL(input).hostname,
    probed_at: new Date().toISOString(),
    policy: null, platform: null, signals: [], rung: null, ladder: [], yield: null,
    sample_pdp: null, score: null, tier: null, gate: null,
    plan: null, memory: null,
  };

  // MEMORY, first pass: what do we already know about this brand? The platform
  // half of the plan is refined after the fingerprint, below.
  let plan = strategies.planFor(reg, { slug, platform: null });

  // --force bypasses BOTH caches: the HTTP response cache and the memory's
  // skip-on-fresh-failure. You need this whenever the ladder code itself changes,
  // because yesterday's "this rung fails" was measured by yesterday's checker —
  // adding microdata support to rung A is exactly such a change.
  const memoFor = (rung) => (a.flags.force
    ? { try: true, reason: '--force: memory skip bypassed' }
    : strategies.shouldTry(plan, rung));
  event('plan', { source: plan.source, start: plan.start, note: plan.note,
                  skip: plan.skip.map(s => `${s.rung}:${s.code}`).join(',') || '-',
                  retest: plan.retest.map(s => `${s.rung}:${s.code}`).join(',') || '-' });

  const finish = (code) => {
    out.plan = { source: plan.source, start: plan.start, order: plan.order, note: plan.note,
                 skipped: plan.skip, retested: plan.retest, expiry_days: plan.expiry_days };
    const memo = strategies.record(reg, out, new Date());
    out.memory = memo;
    http.writeAtomic(path.join(dir, 'probe.json'), JSON.stringify(out, null, 2));
    fs.appendFileSync(path.join(dir, 'events.ndjson'), ev.map(e => JSON.stringify(e)).join('\n') + '\n');
    const summary = {
      slug: out.slug, brand: out.brand, domain: out.domain,
      policy: out.policy && out.policy.verdict, policy_reason: out.policy && out.policy.reason,
      platform: out.platform, rung: out.rung, gate: out.gate,
      listings_est: out.yield && out.yield.listings_est, score: out.score, tier: out.tier,
      ladder: out.ladder.map(r => `${r.rung}:${r.viable ? 'VIABLE' : r.code}`),
      plan: `${plan.source} -> start ${plan.start}`,
      memory: memo.note,
      requests: store.newRequests, cache_hits: store.cacheHits,
      exit: code,
      probe_json: path.join(dir, 'probe.json'),
    };
    console.log(JSON.stringify(summary, null, 2));
    return { code, out, plan, memo };
  };

  /* ------------------------------------- 0. brand-level opt-out, before any I/O */
  // An opt-out belongs to the BRAND, not to the one hostname that happens to
  // carry the directive. Berghaus opted out at www.berghaus.com; the apex serves
  // a stock permissive Shopify robots.txt, and a probe of the apex sailed
  // straight through and pulled a 248-product catalog. Checking robots per host
  // is necessary but not sufficient — the registry has to remember that this
  // brand said no, whichever host you arrive at.
  const optOut = strategies.optOutFor
    ? strategies.optOutFor(reg, out.domain)
    : findOptOut(reg, out.domain);
  if (optOut) {
    out.policy = { verdict: 'do-not-scrape', reason: 'brand-level-opt-out',
                   recorded_for: optOut.brand || optOut.slug, matched_domain: out.domain,
                   note: optOut.note || 'this brand has a recorded publisher opt-out on another host' };
    out.gate = 'do-not-scrape';
    event('policy-stop', { reason: 'brand-level-opt-out', brand: optOut.slug, host: out.domain });
    return finish(3);
  }

  /* ---------------------------------------------------------- 1. robots.txt */
  let rres = await http.fetchUrl(store, origin0 + '/robots.txt', { force: a.flags.force });
  if (rres.error) { event('robots-error', { url: origin0 + '/robots.txt', error: rres.error }); out.gate = 'robots-unreachable'; return finish(1); }
  let origin = new URL(rres.final_url || (origin0 + '/robots.txt')).origin;

  // A 200 is not proof we were handed robots.txt. deuter.com answers
  // /robots.txt with a 200 and 297,247 bytes of its own HOMEPAGE (a soft 404,
  // redirected to www.deuter.com/us-en); jstark.co answers with 31 bytes of
  // text/html prose. Parsing either as robots yields zero groups, which reads as
  // "no rules" -- so the real robots.txt at the real origin is never read at all.
  // For Deuter that cost the sitemap list, hence every rung-A candidate, hence a
  // no-viable-rung verdict for a brand whose PDPs carry complete JSON-LD.
  // A "no" we cannot date is stale; a "yes" we never actually read is worse.
  const looksLikeRobots = (res) => {
    if (res.status !== 200) return false;
    const head = res.body.toString('utf8', 0, 400).trim();
    if (/^<(!doctype|html|\?xml)/i.test(head) || /<html[\s>]/i.test(head)) return false;
    return /text\/plain/i.test(res.ctype || '') || /^\s*(#|user-agent:|sitemap:|allow:|disallow:)/i.test(head);
  };
  let robotsReadable = looksLikeRobots(rres);
  // If the request crossed origins on the way (apex -> www, .com -> regional),
  // ask the origin that actually serves the storefront for ITS robots.txt.
  if (!robotsReadable && origin !== origin0) {
    event('robots-not-robots', { url: rres.final_url || null, status: rres.status, ctype: rres.ctype || null,
                                 retry_at: origin + '/robots.txt' });
    const r2 = await http.fetchUrl(store, origin + '/robots.txt', { force: a.flags.force });
    if (!r2.error && looksLikeRobots(r2)) { rres = r2; robotsReadable = true; }
  }
  // Still not robots. RFC 9309 §2.3.1.4 draws a line here that the previous
  // version of this code did not:
  //
  //   "Unavailable"  (4xx)                 -> no robots.txt exists; access is allowed.
  //   "Unreachable"  (5xx, timeouts, 429)  -> "assume complete disallow".
  //
  // Everything used to collapse to the allow branch, so a 503 or an HTML error
  // page parsed to zero rules and returned allow. Measured before this fix: a
  // robots.txt returning 503 produced policy=allow and five further requests.
  // "We could not read your rules" is not consent. Fail CLOSED unless the server
  // positively told us there are no rules.
  const robotsStatus = Number(rres.status) || 0;
  const genuinelyAbsent = robotsReadable || (robotsStatus >= 400 && robotsStatus < 500 && robotsStatus !== 429);
  if (!robotsReadable) {
    event('robots-unreadable', {
      status: rres.status, ctype: rres.ctype || null, bytes: rres.bytes || 0,
      treated_as: genuinelyAbsent ? 'absent-allow' : 'unreachable-deny',
    });
  }
  if (!genuinelyAbsent) {
    out.policy = {
      verdict: 'do-not-scrape', reason: 'robots-unreachable',
      robots_status: rres.status || null, robots_readable: false,
      robots_url: rres.final_url || rres.url || null, robots_ctype: rres.ctype || null,
      note: 'robots.txt could not be read (5xx, 429, timeout or unparseable body). ' +
            'RFC 9309 requires assuming complete disallow. Re-probe later; this is ' +
            'a transient verdict, not a publisher opt-out.',
      transient: true, checked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 1 * 864e5).toISOString(),
    };
    event('robots', { status: rres.status, verdict: 'do-not-scrape', reason: 'robots-unreachable' });
    out.gate = 'robots-unreachable';
    return finish(3);
  }
  const robotsText = robotsReadable ? rres.body.toString('utf8') : '';
  const parsed = robots.parse(robotsText);
  const v = robots.verdict(parsed, ['/', '/products.json', '/products/example', '/collections/all']);
  const delay = robots.crawlDelay(parsed);
  if (delay) http.setCrawlDelay(new URL(origin).host, delay);
  out.policy = {
    verdict: v.verdict, reason: v.reason, robots_status: rres.status, robots_sha256: rres.sha256,
    robots_readable: robotsReadable, robots_url: rres.final_url || rres.url, robots_ctype: rres.ctype || null,
    robots_bytes: rres.bytes, blocked_path: v.blocked_path, rule: v.rule || null,
    content_signal: v.content_signal || null, crawl_delay: delay,
    sitemaps: parsed.sitemaps, discarded_lines: parsed.discardedLines,
    unknown_directives: parsed.unknownDirectives,
    effective_delay_ms: Math.max(http.MIN_GAP_MS, (delay || 0) * 1000),
    checked_at: new Date().toISOString(),
    expires_at: v.verdict === 'do-not-scrape' && v.reason !== 'disallow'
      ? null : new Date(Date.now() + 90 * 864e5).toISOString(),
  };
  event('robots', { status: rres.status, bytes: rres.bytes, verdict: v.verdict, delay,
                    readable: robotsReadable, discarded_lines: parsed.discardedLines });

  /**
   * allowFor — the policy check for ANY url, on any host.
   *
   * Every robots check used to run against `parsed`, which is the robots.txt of
   * the ENTRY origin only. A candidate on another host — a redirect target, a
   * regional storefront, an apex vs www split — was fetched under a policy that
   * was never that host's. That is the bug behind the Berghaus incident: the
   * brand opted out at www.berghaus.com, the apex serves a stock permissive file,
   * and a probe of the apex sailed through and pulled the catalog.
   *
   * Each new origin gets its own robots.txt, parsed under the same fail-closed
   * rules as the entry origin. Results are memoised per run.
   */
  const policyByOrigin = new Map([[origin, { parsed, verdict: v }]]);
  async function policyFor(originX) {
    if (policyByOrigin.has(originX)) return policyByOrigin.get(originX);
    const r = await http.fetchUrl(store, originX + '/robots.txt', { force: a.flags.force });
    let entry;
    if (r.error || !looksLikeRobots(r)) {
      const st = Number(r.status) || 0;
      const absent = !r.error && st >= 400 && st < 500 && st !== 429;
      if (absent) {
        entry = { parsed: robots.parse(''), verdict: { verdict: 'allow' }, absent: true };
      } else {
        entry = { parsed: null, verdict: { verdict: 'do-not-scrape', reason: 'robots-unreachable' }, unreachable: true };
      }
      event('robots-cross-origin', { origin: originX, status: r.status || null,
                                     treated_as: absent ? 'absent-allow' : 'unreachable-deny' });
    } else {
      const p2 = robots.parse(r.body.toString('utf8'));
      const v2 = robots.verdict(p2, ['/']);
      const d2 = robots.crawlDelay(p2);
      if (d2) http.setCrawlDelay(new URL(originX).host, d2);
      entry = { parsed: p2, verdict: v2 };
      event('robots-cross-origin', { origin: originX, status: r.status, verdict: v2.verdict, delay: d2 });
    }
    policyByOrigin.set(originX, entry);
    return entry;
  }
  async function allowFor(urlStr) {
    let u;
    try { u = new URL(urlStr); } catch { return { allowed: false, reason: 'bad-url' }; }
    const pol = await policyFor(u.origin);
    if (!pol.parsed) return { allowed: false, reason: pol.verdict.reason || 'robots-unreachable' };
    if (pol.verdict && pol.verdict.verdict === 'do-not-scrape') {
      return { allowed: false, reason: pol.verdict.reason || 'do-not-scrape' };
    }
    const r = robots.isAllowed(pol.parsed, u.pathname + (u.search || ''));
    return { allowed: r.allowed, reason: r.allowed ? null : 'disallow', rule: r.rule || null };
  }
  // A do-not-scrape verdict is a SUCCESSFUL, FINAL result, not an error and not
  // an obstacle. We record the rule that triggered it and stop. robots.txt is
  // re-read on every run, so if the site ever removes the rule we will see it —
  // but nothing here ever tries to get around one.
  if (v.verdict === 'do-not-scrape') {
    out.gate = 'do-not-scrape'; out.rung = null;
    event('policy-stop', { reason: v.reason, blocked_path: v.blocked_path,
                           rule: v.rule ? `${v.rule.type} ${v.rule.path}` : null });
    return finish(3);
  }

  /* --------------------------------------------------------- 2. entry page */
  const home = await http.fetchUrl(store, origin + '/', { accept: 'text/html', force: a.flags.force });
  const homeShape = ladder.assertShape(home, 'html');
  const homeHtml = homeShape.ok ? homeShape.text : '';
  const fp = ladder.fingerprint(robotsText, homeHtml, {});
  out.platform = fp.platform; out.commerce_backend = fp.commerce; out.signals = fp.signals;
  out.predicts_rung_b = fp.predicts_rung_b;
  if (home.error) event('home-error', { url: origin + '/', error: home.error });
  event('fingerprint', { platform: fp.platform, commerce: fp.commerce, predicts_rung_b: fp.predicts_rung_b,
                         signals: fp.signals.join(','), home_bytes: home.bytes || 0 });

  // MEMORY, second pass. Now that the storefront signature is known, a brand we
  // have never probed can inherit the starting rung from other brands with the
  // same signature instead of climbing from A. planFor() prefers this brand's own
  // recorded winner when it has one, so re-running a known brand is unaffected.
  plan = strategies.planFor(reg, { slug, platform: fp.platform });
  event('plan', { source: plan.source, start: plan.start, platform: fp.platform, note: plan.note });

  /* ------------------------------------------------- 3. rung B: catalog API */
  const bUrl = origin + '/products.json?limit=250';
  const bAllowed = await allowFor(bUrl);   // per-host policy, not the entry origin's
  const bMemo = memoFor('B');
  let catalog = null;
  if (!bAllowed.allowed) {
    out.ladder.push({ rung: 'B', url: bUrl, viable: false, code: 'robots-disallow', rule: bAllowed.rule });
  } else if (!bMemo.try) {
    // Skipped on a FRESH failure record only. Once that record ages past the
    // expiry window the rung is climbed again — see lib/strategies.js.
    out.ladder.push({ rung: 'B', url: bUrl, viable: false, skipped: true,
                      code: 'skipped-fresh-failure', memory: bMemo.reason });
    event('rung-b-skipped', { reason: bMemo.reason });
  } else {
    const br = await http.fetchUrl(store, bUrl, { accept: 'application/json', force: a.flags.force });
    const shape = ladder.assertShape(br, 'json');
    if (shape.ok && shape.json && Array.isArray(shape.json.products)) {
      catalog = shape.json;
      out.ladder.push({ rung: 'B', url: bUrl, viable: true, status: br.status, bytes: br.bytes,
                        sha256: br.sha256, products: catalog.products.length,
                        fingerprint: ladder.structureFingerprint('shopify-catalog', catalog).sha256,
                        predicted_by_robots: fp.signals.includes('robots:shopify-collections-sort_by') });
    } else {
      out.ladder.push({ rung: 'B', url: bUrl, viable: false, status: br.status || null,
                        bytes: br.bytes || 0, code: shape.code || 'not-a-product-catalog',
                        ctype: br.ctype || null,
                        predicted_by_robots: fp.signals.includes('robots:shopify-collections-sort_by') });
      event('rung-b-failed', { code: shape.code, status: br.status, bytes: br.bytes || 0, ctype: br.ctype });
    }
  }

  /* -------------------------------------------- 4. find one sample PDP url */
  let sample = a.flags.sample || null;
  let samples = [];
  if (!sample && catalog && catalog.products.length) {
    const bags = catalog.products.filter(p => fields.isBagLike(p.title));
    samples = (bags.length ? bags : catalog.products).slice(0, 3).map(p => origin + '/products/' + p.handle);
    sample = samples[0];
  }
  const pdpRe = /href="((?:https?:\/\/[^"]*)?\/(?:products?|shop|store|collections\/[^"\/]+\/products)\/[^"?#]+)"/gi;
  if (!sample && homeHtml) {
    const seen = new Set(); let m;
    while ((m = pdpRe.exec(homeHtml))) {
      const u = m[1].startsWith('http') ? m[1] : origin + m[1];
      if (new URL(u).host !== new URL(origin).host) continue;
      seen.add(u);
      if (seen.size > 40) break;
    }
    const ranked = [...seen].sort((x, y) => (fields.isBagLike(y) ? 1 : 0) - (fields.isBagLike(x) ? 1 : 0));
    samples = ranked.slice(0, 3);
    sample = samples[0] || null;
  }
  // Enumerate the catalog from the sitemap the brand DECLARES in robots.txt.
  // For a non-rung-B brand this is the only honest product list: guessing URLs
  // or crawling links is how you end up extracting a cross-sell as a product.
  let sitemapUrls = 0, productUrls = [], looseUrls = [], sitemapTotal = 0;
  const sitemaps = [...new Set(parsed.sitemaps)];
  if (!catalog && sitemaps.length) {
    let locs = [];
    const sm = await http.fetchUrl(store, sitemaps[0], { force: a.flags.force });
    if (!sm.error && sm.status === 200) {
      locs = [...sm.body.toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]);
      let cls = ladder.classifyProductUrls(locs, origin);
      if (!cls.strict.length) {                        // sitemap index -> one child
        const child = locs.find(u => /product/i.test(u) && /\.xml/i.test(u));
        if (child) {
          const sm2 = await http.fetchUrl(store, child, { force: a.flags.force });
          if (!sm2.error && sm2.status === 200) {
            locs = [...sm2.body.toString('utf8').matchAll(/<loc>([^<]+)<\/loc>/g)].map(x => x[1]);
            cls = ladder.classifyProductUrls(locs, origin);
          }
        }
      }
      productUrls = cls.strict; looseUrls = cls.loose; sitemapTotal = cls.total;
      sitemapUrls = productUrls.length;
      // Only the strict tier is ever written down as a product list. The loose
      // tier exists to give rung A something to TRY; it is never counted.
      if (productUrls.length) {
        http.writeAtomic(path.join(dir, 'catalog-urls.json'),
          JSON.stringify({ source: sitemaps[0], classifier: 'strict', count: productUrls.length, urls: productUrls }, null, 2));
      }
      const pool = productUrls.length ? productUrls : looseUrls;
      if (pool.length) {
        const bagish = pool.filter(u => fields.isBagLike(decodeURIComponent(u.split('/').pop().replace(/[-_]/g, ' ').replace(/\.html?$/i, ''))));
        // The homepage-scraped candidate only keeps its place at the front if the
        // sitemap classifier also calls it a product. bellroy.com's nav links
        // /products/category/backpacks, which is a listing page — leaving it first
        // spent a browser launch rendering a category before reaching a real PDP.
        const keepHome = sample && productUrls.length
          ? ladder.classifyProductUrls([sample], origin).strict.length > 0
          : !!sample;
        samples = [...new Set([...(keepHome ? [sample] : []), ...bagish, ...pool])].slice(0, 3);
        sample = samples[0];
      }
      event('sitemap', { source: sitemaps[0], total_urls: sitemapTotal, strict_product_urls: productUrls.length,
                         loose_candidates: looseUrls.length,
                         sampling_from: productUrls.length ? 'strict' : 'loose' });
    }
  }
  out.sample_pdp = sample;
  out.sitemap_product_urls = sitemapUrls || null;   // STRICT classifier only — safe to quote
  out.sitemap_total_urls = sitemapTotal || null;    // every same-host <loc>, products or not
  out.sitemap_loose_candidates = looseUrls.length || null;
  out.policy.sitemaps = sitemaps;

  /* ---------------------------------------- 5. rung A: static PDP structured */
  // Try up to 3 declared product URLs before concluding the rung is dead. A
  // brand's own sitemap lists dead products -- 7 of Troubadour's 85 return 404 --
  // and a one-sample probe reports "no viable rung" for a brand that works.
  let staticInv = null, staticHtml = '';
  if (!samples.length && sample) samples = [sample];
  const aAttempts = [];
  for (const cand of samples) {
    const allowedA = await allowFor(cand);   // per-host policy, not the entry origin's
    if (!allowedA.allowed) { aAttempts.push({ url: cand, code: 'robots-disallow', rule: allowedA.rule }); continue; }
    const pr = await http.fetchUrl(store, cand, { accept: 'text/html', force: a.flags.force });
    const ps = ladder.assertShape(pr, 'html');
    if (!ps.ok) { aAttempts.push({ url: cand, status: pr.status || null, code: ps.code }); continue; }
    const inv = ladder.structuredInventory(ps.text);
    const av = ladder.rungAViable(inv);
    const viable = av.viable;
    aAttempts.push({ url: cand, status: pr.status, bytes: pr.bytes, sha256: pr.sha256, inventory: inv,
                     via: av.via, code: av.code });
    if (viable) { staticInv = inv; staticHtml = ps.text; sample = cand; break; }
    if (!staticInv) { staticInv = inv; staticHtml = ps.text; }
  }
  if (!aAttempts.length) out.ladder.push({ rung: 'A', viable: false, code: 'no-sample-pdp-found' });
  else {
    const win = aAttempts.find(x => x.code === null);
    out.ladder.push({ rung: 'A', viable: !!win, url: (win || aAttempts[0]).url,
                      status: (win || aAttempts[0]).status, bytes: (win || aAttempts[0]).bytes,
                      sha256: (win || aAttempts[0]).sha256, inventory: (win || aAttempts[0]).inventory,
                      via: win ? win.via : null,
                      code: win ? null : aAttempts[0].code, attempts: aAttempts.map(x => ({ url: x.url, status: x.status || null, code: x.code, via: x.via || null })) });
    event('rung-a', { viable: !!win, via: win ? win.via : null, tried: aAttempts.length,
                      jsonld_products: staticInv ? staticInv.jsonld_products : 0,
                      microdata_price: staticInv && staticInv.microdata ? staticInv.microdata.price : null });
  }

  /* ------------------------------------------- 6. rung C: headless rendering */
  // Only render when no cheaper rung produced a product record IN ANY ENCODING.
  // Checking JSON-LD alone here is what sent Magpul to a browser it did not need.
  const aWon = out.ladder.some(r => r.rung === 'A' && r.viable);
  const needRender = !catalog && !aWon;
  const cMemo = memoFor('C');
  if (sample && (a.flags.render || needRender) && !cMemo.try) {
    // Rung C costs a browser launch. Skipping it on a fresh failure record is the
    // biggest single saving memory buys — and it still expires like every other
    // failure, so a site that starts shipping JSON-LD gets noticed.
    out.ladder.push({ rung: 'C', url: sample, viable: false, skipped: true,
                      code: 'skipped-fresh-failure', memory: cMemo.reason });
    event('rung-c-skipped', { reason: cMemo.reason });
  } else if (sample && (a.flags.render || needRender)) {
    // Render the SAME candidate list rung A tried, not just the first URL. Rung A
    // records exactly which candidates returned 200, and a render is expensive, so
    // prefer those and cap the number of browser launches.
    const rendered200 = aAttempts.filter(x => x.status === 200).map(x => x.url);
    const cCands = [...new Set([...rendered200, sample])].slice(0, RENDER_CAP);
    let cDone = false;
    for (const cand of cCands) {
      if (cDone) break;
      // ROBOTS FIRST, EVERY RUNG. `sample` reaches this loop even when rung A
      // refused it for robots-disallow (rung A `continue`s past a disallowed
      // candidate without clearing it), so a rung-C render could reach a path the
      // site had closed. Measured: www.511tactical.com disallows /catalog/ and
      // /catalog/product/view/id/230671 was rendered anyway — 853,362 bytes taken
      // from a disallowed path. A browser is not exempt from robots.txt.
      const allowedC = await allowFor(cand);   // per-host policy, not the entry origin's
      if (!allowedC.allowed) {
        // Not `skipped` — strategies.record() drops skipped rows, and a
        // robots refusal is exactly the fact most worth having in the registry.
        // It is re-derived from a live robots.txt on every run, so re-dating it
        // is honest, and it matches how rungs A and B record the same refusal.
        out.ladder.push({ rung: 'C', url: cand, viable: false,
                          code: 'robots-disallow', rule: allowedC.rule });
        event('rung-c-refused', { url: cand, rule: `${allowedC.rule.type} ${allowedC.rule.path}` });
        continue;
      }
      const dr = await render.dumpDom(store, cand, { force: a.flags.force });
      if (dr.error) {
        out.ladder.push({ rung: 'C', url: cand, viable: false, code: dr.error });
        continue;
      }
      const dom = dr.body.toString('utf8');
      const inv = ladder.structuredInventory(dom);
      sample = cand;
      // IDENTITY ASSERTION AT RUNG C. A render that silently lands somewhere else
      // is the worst failure mode this ladder has: it returns a real, parseable
      // page for the wrong product. Measured on troubadourgoods.com before the
      // cookie jar existed -- Chrome followed a 302 loop to /undefined/... and
      // rendered the HOME page, 230,753 bytes of perfectly valid DOM.
      const rc = htmlLib.canonicalUrl(dom);
      const want = decodeURIComponent(new URL(sample).pathname.split('/').filter(Boolean).pop());
      const got = rc ? decodeURIComponent(new URL(rc.value, sample).pathname.split('/').filter(Boolean).pop() || '') : null;
      const identityOk = rc ? got === want : null;
      const cv = ladder.rungAViable(inv);   // same "is there a product record" test, post-render
      const viable = cv.viable && identityOk !== false;
      out.ladder.push({
        rung: 'C', url: sample, viable, via: viable ? cv.via : null, bytes: dr.bytes, sha256: dr.sha256, inventory: inv,
        code: viable ? null : (identityOk === false ? 'identity-mismatch-after-render' : 'no-structured-product-after-render'),
        identity: { requested: want, rendered_canonical: rc ? rc.value : null, ok: identityOk },
        delta_vs_static: staticInv ? {
          bytes: dr.bytes - (out.ladder.find(r => r.rung === 'A') || {}).bytes,
          jsonld_products: inv.jsonld_products - staticInv.jsonld_products,
          jsonld_types_added: inv.jsonld_types.filter(t => !staticInv.jsonld_types.includes(t)),
        } : null,
      });
      event('rung-c', { url: cand, viable, via: cv.via, jsonld_products: inv.jsonld_products,
                        microdata_price: inv.microdata ? inv.microdata.price : null, bytes: dr.bytes });
      if (viable) cDone = true;
    }
  }

  /* --------------------------------------------------------- 7. yield / G0 */
  if (catalog) {
    const ps = catalog.products;
    const bagLike = ps.filter(p => fields.isBagLike(p.title));
    const fam = new Set(bagLike.map(p => fields.familyKey(p.title)));
    const has = (f) => bagLike.filter(f).length;
    out.yield = {
      basis: 'rung-B catalog payload',
      products: ps.length, bag_like: bagLike.length, listings_est: fam.size,
      price_pct: pct(has(p => (p.variants || []).some(x => parseFloat(x.price) > 0)), bagLike.length),
      weight_pct: pct(has(p => (p.variants || []).some(x => Number(x.grams) > 0)), bagLike.length),
      volume_pct: pct(has(p => fields.volumeFrom(p.title) || fields.volumeFrom(p.body_html || '')), bagLike.length),
      desc_pct: pct(has(p => (p.body_html || '').replace(/<[^>]+>/g, '').trim().length > 40), bagLike.length),
    };
    out.rung = 'B';
  } else {
    const cRung = out.ladder.find(r => r.rung === 'C' && r.viable);
    const aRung = out.ladder.find(r => r.rung === 'A' && r.viable);
    out.rung = aRung ? 'A' : cRung ? 'C' : null;
    const inv = (cRung || aRung || {}).inventory || staticInv;
    out.yield = {
      // listings_est stays NULL when the strict classifier recognised nothing.
      // We would rather report "unknown" than publish a count derived from the
      // loose tier, which includes category pages. An unknown yield is a research
      // task; a wrong yield is a wrong number in the catalog.
      basis: sitemapUrls ? 'sitemap product URL count, strict classifier (estimate)'
                         : 'single sample PDP; sitemap URL scheme not recognised by the strict classifier',
      products: sitemapUrls || null, bag_like: null, listings_est: sitemapUrls || null,
      price_pct: inv && inv.offer_price != null ? 100 : 0,
      weight_pct: null, volume_pct: null,
      desc_pct: inv && inv.jsonld_product_fields.includes('description') ? 100 : 0,
      note: 'per-field percentages require a full fetch pass at this rung; single-PDP evidence only',
    };
  }

  const cost = { A: 1, B: 1, C: 2, D: 4 }[out.rung] || 4;
  const y = out.yield;
  const completeness = (0.40 * (y.price_pct || 0) + 0.25 * (y.weight_pct || 0)
                      + 0.20 * (y.volume_pct || 0) + 0.15 * (y.desc_pct || 0)) / 100;
  out.score = y.listings_est ? Math.round((y.listings_est * completeness / cost) * 10) / 10 : null;
  out.tier = out.score == null ? null : out.score >= 20 ? 1 : out.score >= 8 ? 2 : 3;

  // Exit code answers exactly one question: did we find a usable rung?
  // The yield/score gates are triage advice for a human and are reported in
  // `gate`, but a brand that yields little still has a working rung, so it still
  // exits 0. Only "no rung at all" is exit 1.
  if (!out.rung) { out.gate = 'no-viable-rung'; event('gate', { gate: out.gate }); return finish(1); }
  if (y.listings_est != null && y.listings_est < 8) { out.gate = 'below-yield-floor'; event('gate', { gate: out.gate, listings_est: y.listings_est }); return finish(0); }
  if (out.score != null && out.score < 5) { out.gate = 'parked-low-score'; event('gate', { gate: out.gate, score: out.score }); return finish(0); }
  out.gate = 'queued';
  return finish(0);
}

/* ============================== CLI ============================== */

function printStatus(reg) {
  const s = strategies.status(reg);
  const L = [];
  L.push(`registry: ${s.file}`);
  L.push(`version ${s.version} · expiry ${s.expiry_days}d · updated ${s.updated_at || 'never'}`);
  L.push(`brands: ${s.brands}`);
  L.push('');
  L.push('BY WINNING RUNG');
  const rungs = Object.keys(s.by_rung).sort();
  if (!rungs.length) L.push('  (none recorded yet)');
  for (const r of rungs) L.push(`  rung ${r}   ${s.by_rung[r]}`);
  if (s.no_viable_rung) L.push(`  none     ${s.no_viable_rung}`);
  L.push(`  do-not-scrape  ${s.do_not_scrape}`);
  L.push('');
  L.push('BY PLATFORM SIGNATURE');
  for (const [p, v] of Object.entries(s.by_platform)) {
    const mix = Object.entries(v.rungs).map(([k, n]) => `${k}:${n}`).join(' ') || '-';
    L.push(`  ${p.padEnd(12)} brands=${String(v.brands).padEnd(4)} rungs=${mix}`);
  }
  L.push('');
  L.push('PLATFORM PRIORS (where a new brand with this signature starts)');
  const pri = Object.entries(s.platform_priors);
  if (!pri.length) L.push('  (none derived yet)');
  for (const [p, v] of pri) L.push(`  ${p.padEnd(12)} start=${v.start_rung}  from ${v.brands} brand(s)  wins=${JSON.stringify(v.wins)}`);
  L.push('');
  L.push(`STALE — failure records older than ${s.expiry_days}d (these get RE-TESTED, never trusted)`);
  if (!s.stale.length) L.push('  (none)');
  for (const e of s.stale) {
    L.push(`  ${e.slug.padEnd(16)} ${e.stale.map(x => `${x.rung}:${x.code}@${x.age_days}d`).join(' ')}`);
  }
  console.log(L.join('\n'));
}

async function main() {
  const a = args(process.argv);
  const regPath = strategies.defaultPath();
  const reg = strategies.load(regPath);

  if (a.flags.status) { printStatus(reg); process.exit(0); }

  if (a.flags['retest-stale']) {
    const stale = strategies.staleEntries(reg);
    if (!stale.length) { console.log('nothing stale: no failure record is older than ' + (reg.expiry_days) + ' days'); process.exit(0); }
    console.error(`[retest-stale] ${stale.length} brand(s) have a failure record past the ${reg.expiry_days}d window`);
    let worst = 0;
    for (const e of stale) {
      const url = e.domain ? 'https://' + e.domain : null;
      if (!url) { console.error(`[retest-stale] ${e.slug}: no domain recorded, skipping`); continue; }
      console.error(`[retest-stale] ${e.slug} -> ${url} (${e.stale.map(x => x.rung + ':' + x.code).join(', ')})`);
      const known = reg.brands[e.slug] || {};
      // force:true is REQUIRED here, not a convenience. A re-test that is allowed
      // to serve cached bytes makes zero requests, learns nothing, and re-dates
      // the record as freshly measured — which is exactly how a stale failure
      // verdict becomes permanent. Measured before this fix: a 200-day-old
      // failure "re-tested" with requests=0, cache_hits=6.
      const r = await probeOne(url, { ...a, flags: {
        ...a.flags, slug: e.slug, force: true,
        brand: a.flags.brand || known.brand || undefined,
        issue: a.flags.issue || (known.issue != null ? String(known.issue) : undefined),
      } }, reg);
      strategies.save(reg, regPath);
      if (r.code === 1) worst = Math.max(worst, 1);
    }
    process.exit(worst);
  }

  if (!a._.length) { console.error(USAGE); process.exit(2); }

  const r = await probeOne(a._[0], a, reg);
  strategies.save(reg, regPath);
  process.exit(r.code);
}

// Run the CLI only when invoked directly. Exporting the pure helpers lets the
// test suite import them without the module launching a probe on require().
if (require.main === module) {
  main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { findOptOut, slugFor, probeOne };
