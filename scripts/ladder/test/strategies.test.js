'use strict';
/**
 * strategies.test.js — pins the memory rules. Run: node --test "scripts/ladder/test/*.test.js"
 *
 * The expiry tests are the important ones. BLOCKED-BRANDS.md was a permanent
 * record of failure and it was wrong about 10 of the 11 brands it condemned; the
 * assertions below are what stop this registry from becoming the same artifact.
 */
const test = require('node:test');
const assert = require('node:assert');
const s = require('../lib/strategies.js');

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY).toISOString();

function regWith(brand) {
  const r = s.emptyRegistry();
  r.brands.acme = Object.assign({
    brand: 'Acme', domain: 'acme.test', platform: 'shopify',
    winner: null, attempts: {}, policy: null, history: [],
  }, brand);
  s.rebuildPlatforms(r);
  return r;
}

/* ------------------------------ rule b: expiry ------------------------------ */

test('a FRESH failure is trusted and the rung is skipped', () => {
  const reg = regWith({ attempts: { B: { ok: false, code: 'http-403', at: ago(10) } } });
  const plan = s.planFor(reg, { slug: 'acme', platform: 'shopify' });
  const d = s.shouldTry(plan, 'B');
  assert.strictEqual(d.try, false);
  assert.match(d.reason, /skipped/);
  assert.ok(plan.skip.some(x => x.rung === 'B'));
});

test('a failure OLDER than the expiry window is re-tested, not trusted', () => {
  const reg = regWith({ attempts: { B: { ok: false, code: 'http-403', at: ago(91) } } });
  const plan = s.planFor(reg, { slug: 'acme', platform: 'shopify' });
  const d = s.shouldTry(plan, 'B');
  assert.strictEqual(d.try, true, 'a 91-day-old failure MUST be re-tested');
  assert.match(d.reason, /re-testing/);
  assert.ok(plan.retest.some(x => x.rung === 'B'));
  assert.ok(!plan.skip.some(x => x.rung === 'B'));
});

test('the expiry boundary is exactly EXPIRY_DAYS', () => {
  assert.strictEqual(s.EXPIRY_DAYS, 90, 'changing this silently changes how long we trust a "no"');
  const fresh = regWith({ attempts: { B: { ok: false, code: 'x', at: ago(89) } } });
  const stale = regWith({ attempts: { B: { ok: false, code: 'x', at: ago(91) } } });
  assert.strictEqual(s.shouldTry(s.planFor(fresh, { slug: 'acme' }), 'B').try, false);
  assert.strictEqual(s.shouldTry(s.planFor(stale, { slug: 'acme' }), 'B').try, true);
});

test('an undated failure is stale — we do not trust a "no" we cannot date', () => {
  assert.strictEqual(s.isStale({ ok: false, code: 'x' }), true);
  assert.strictEqual(s.isStale(null), true);
  assert.strictEqual(s.isStale({ ok: false, at: 'not-a-date' }), true);
});

test('a five-year-old failure — the BLOCKED-BRANDS.md case — is re-tested', () => {
  const reg = regWith({ domain: 'eastpak.test', attempts: { B: { ok: false, code: 'http-403', at: ago(1825) } } });
  const plan = s.planFor(reg, { slug: 'acme' });
  assert.strictEqual(s.shouldTry(plan, 'B').try, true);
  assert.ok(s.staleEntries(reg).some(e => e.slug === 'acme'));
});

/* --------------------------- rule a: sticky but checked --------------------------- */

test('a recorded winner becomes the starting rung', () => {
  const reg = regWith({ winner: { rung: 'C', at: ago(5), first_seen: ago(40) } });
  const plan = s.planFor(reg, { slug: 'acme', platform: 'shopify' });
  assert.strictEqual(plan.start, 'C');
  assert.strictEqual(plan.source, 'brand-winner');
  assert.strictEqual(plan.order[0], 'C');
});

test('the winning rung is never skipped, even with a fresh failure recorded against it', () => {
  const reg = regWith({
    winner: { rung: 'B', at: ago(1), first_seen: ago(100) },
    attempts: { B: { ok: false, code: 'http-500', at: ago(1) } },
  });
  const plan = s.planFor(reg, { slug: 'acme' });
  assert.strictEqual(s.shouldTry(plan, 'B').try, true, 'success is sticky but CHECKED — always re-run the winner');
});

test('when the winning rung stops working the new winner is recorded with a history note', () => {
  const reg = regWith({ winner: { rung: 'B', at: ago(30), first_seen: ago(200) } });
  const memo = s.record(reg, {
    slug: 'acme', domain: 'acme.test', platform: 'shopify',
    rung: 'A',
    ladder: [
      { rung: 'B', viable: false, code: 'html-at-json-url', status: 200, bytes: 490000, url: 'https://acme.test/products.json' },
      { rung: 'A', viable: true, url: 'https://acme.test/products/x', status: 200, bytes: 40000 },
    ],
    yield: { listings_est: 12 },
  });
  const b = reg.brands.acme;
  assert.strictEqual(b.winner.rung, 'A');
  assert.match(memo.note, /winner B -> A/);
  const h = b.history[b.history.length - 1];
  assert.strictEqual(h.from, 'B');
  assert.strictEqual(h.to, 'A');
  assert.match(h.note, /html-at-json-url/);
  assert.strictEqual(b.winner.first_seen, b.winner.at, 'a new winning rung starts its own first_seen');
});

test('a re-confirmed winner keeps its original first_seen but advances at', () => {
  const first = ago(200);
  const reg = regWith({ winner: { rung: 'B', at: ago(30), first_seen: first } });
  s.record(reg, { slug: 'acme', rung: 'B', ladder: [{ rung: 'B', viable: true, products: 155 }], yield: { listings_est: 41 } });
  assert.strictEqual(reg.brands.acme.winner.first_seen, first);
  assert.ok(Date.parse(reg.brands.acme.winner.at) > Date.parse(ago(1)));
});

/* ------------------------- the skip must not renew itself ------------------------- */

test('a SKIPPED rung does not reset its own age clock', () => {
  // If recording a skip re-stamped the attempt, the record would never reach the
  // expiry window and the skip would be permanent — BLOCKED-BRANDS.md all over.
  const original = ago(80);
  const reg = regWith({ attempts: { B: { ok: false, code: 'http-403', at: original } } });
  s.record(reg, {
    slug: 'acme', rung: 'A',
    ladder: [
      { rung: 'B', viable: false, skipped: true, code: 'skipped-fresh-failure' },
      { rung: 'A', viable: true, url: 'https://acme.test/products/x' },
    ],
    yield: { listings_est: 9 },
  });
  assert.strictEqual(reg.brands.acme.attempts.B.at, original,
    'a skip is not evidence; only a request may re-date an attempt');
  assert.strictEqual(reg.brands.acme.attempts.B.code, 'http-403');
});

test('after enough skipped runs the record still expires on schedule', () => {
  let reg = regWith({ attempts: { B: { ok: false, code: 'http-403', at: ago(85) } } });
  for (let i = 0; i < 5; i++) {
    s.record(reg, { slug: 'acme', rung: 'A', ladder: [{ rung: 'B', viable: false, skipped: true, code: 'skipped-fresh-failure' }], yield: {} });
  }
  const at = reg.brands.acme.attempts.B.at;
  const laterPlan = s.planFor(reg, { slug: 'acme' }, Date.parse(at) + 91 * DAY);
  assert.strictEqual(s.shouldTry(laterPlan, 'B').try, true, 'repeated skips must not postpone expiry');
});

/* ----------------------------- platform priors ----------------------------- */

test('a new brand inherits the starting rung from its platform signature', () => {
  const reg = s.emptyRegistry();
  for (const slug of ['a', 'b', 'c']) {
    reg.brands[slug] = { domain: slug + '.test', platform: 'shopify', winner: { rung: 'B', at: ago(2) }, attempts: {}, history: [] };
  }
  s.rebuildPlatforms(reg);
  assert.strictEqual(reg.platforms.shopify.start_rung, 'B');
  assert.strictEqual(reg.platforms.shopify.brands, 3);

  const plan = s.planFor(reg, { slug: 'brand-new', platform: 'shopify' });
  assert.strictEqual(plan.source, 'platform-prior');
  assert.strictEqual(plan.start, 'B');
});

test('with no memory at all the plan is cheapest-first', () => {
  const plan = s.planFor(s.emptyRegistry(), { slug: 'nobody', platform: null });
  assert.strictEqual(plan.source, 'default');
  assert.deepStrictEqual(plan.order, ['A', 'B', 'C', 'D']);
});

/* ------------------------------ do-not-scrape ------------------------------ */

test('a do-not-scrape verdict records the rule that triggered it', () => {
  const reg = s.emptyRegistry();
  s.record(reg, {
    slug: 'berghaus', domain: 'www.berghaus.com', brand: 'Berghaus',
    rung: null, ladder: [],
    policy: { verdict: 'do-not-scrape', reason: 'named-ua-disallow',
              rule: { type: 'disallow', path: '/' }, blocked_path: '/', robots_sha256: 'abc' },
  });
  const p = reg.brands.berghaus.policy;
  assert.strictEqual(p.verdict, 'do-not-scrape');
  assert.strictEqual(p.reason, 'named-ua-disallow');
  assert.deepStrictEqual(p.rule, { type: 'disallow', path: '/' });
  assert.strictEqual(s.status(reg).do_not_scrape, 1);
});

test('rung A is never in the skip list — it is always climbed', () => {
  const reg = regWith({ attempts: { A: { ok: false, code: 'no-structured-product-in-static-html', at: ago(3) } } });
  const plan = s.planFor(reg, { slug: 'acme' });
  assert.ok(!plan.skip.some(x => x.rung === 'A'));
  assert.strictEqual(s.shouldTry(plan, 'A').try, true);
});

test('the registry survives a corrupt file without throwing', () => {
  const reg = s.load('/nonexistent/path/strategies.json');
  assert.strictEqual(reg.brands && typeof reg.brands, 'object');
  assert.strictEqual(reg.expiry_days, 90);
});
