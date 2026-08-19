'use strict';
/**
 * politeness.test.js — pins three defects found by an adversarial re-probe of
 * the registry. All three were MEASURED against the probe's own cache, not
 * hypothesised, and each one is a violation of a rule the project calls
 * non-negotiable. The fixtures are verbatim bytes from the live hosts.
 *
 *   1. Rung C rendered a robots-disallowed path.
 *      www.511tactical.com/robots.txt says `Disallow: /catalog/` in the group
 *      that binds us. Rung A refused all three sample PDPs for exactly that
 *      reason and `continue`d — which left `sample` still pointing at the
 *      disallowed URL, and rung C launched Chrome on it: 853,362 bytes taken
 *      from a closed path. A browser is not exempt from robots.txt.
 *
 *   2. A redirect hop never stamped the host it landed on.
 *      Hosts have separate queues. `apex/robots.txt` 302s to `www/robots.txt`,
 *      the bytes come from www, but only the apex's clock was set — so the next
 *      request, the homepage on the www origin, fired with `last = 0`. 38 pairs
 *      of same-site requests in the cached run landed under 2 s apart this way,
 *      the closest 35 ms (osprey.com).
 *
 *   3. A 200 response is not proof of a robots.txt.
 *      deuter.com/robots.txt answers 200 with 297,247 bytes of its own homepage.
 *      Parsed as robots it yields zero groups, which reads as "no rules" — so
 *      the real robots.txt at www.deuter.com, which declares six sitemaps, was
 *      never read, rung A never got a candidate URL, and Deuter was recorded
 *      `no-viable-rung`. Its PDPs carry a complete JSON-LD ProductGroup.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const robots = require('../lib/robots.js');
const http = require('../lib/http.js');

const fixture = (n) => fs.readFileSync(path.join(__dirname, 'fixtures', n), 'utf8');

/* ---- 1. the path rung C rendered is disallowed, and must be seen as such ---- */

test('5.11: /catalog/ is disallowed for us, so no rung may fetch a /catalog/ URL', () => {
  const parsed = robots.parse(fixture('511tactical.robots.txt'));
  const r = robots.isAllowed(parsed, '/catalog/product/view/id/230671');
  assert.strictEqual(r.allowed, false, 'the URL rung C rendered must read as disallowed');
  assert.strictEqual(r.rule.type, 'disallow');
  assert.strictEqual(r.rule.path, '/catalog/');
});

test('5.11: robots.txt is readable and the site is otherwise open — the refusal is path-scoped', () => {
  const parsed = robots.parse(fixture('511tactical.robots.txt'));
  assert.strictEqual(robots.verdict(parsed, ['/']).verdict, 'allow');
  assert.strictEqual(robots.crawlDelay(parsed), 1, 'declared Crawl-delay must survive parsing');
});

/* ---- 2. a soft-404 robots.txt must not be mistaken for permission ---- */

// The guard probe.js applies. Kept in step with it by these tests; if the copy
// in probe.js changes, change it here and say why.
const looksLikeRobots = (res) => {
  if (res.status !== 200) return false;
  const head = res.body.toString('utf8', 0, 400).trim();
  if (/^<(!doctype|html|\?xml)/i.test(head) || /<html[\s>]/i.test(head)) return false;
  return /text\/plain/i.test(res.ctype || '') || /^\s*(#|user-agent:|sitemap:|allow:|disallow:)/i.test(head);
};

test('deuter: a 200 that is really the homepage is NOT a robots.txt', () => {
  const body = Buffer.from(fixture('deuter-apex-soft404.robots.html'));
  assert.strictEqual(
    looksLikeRobots({ status: 200, ctype: 'text/html; charset=UTF-8', body }), false);
  // and the damage it did: parsed as robots it looks like a site with no rules
  const parsed = robots.parse(body.toString('utf8'));
  assert.strictEqual(parsed.groups.length, 0);
  assert.strictEqual(parsed.sitemaps.length, 0, 'the sitemaps rung A needs are simply absent');
});

test('deuter: the real robots.txt at the redirect target is readable and declares sitemaps', () => {
  const body = Buffer.from(fixture('deuter-www.robots.txt'));
  assert.strictEqual(looksLikeRobots({ status: 200, ctype: 'text/plain; charset=utf-8', body }), true);
  const parsed = robots.parse(body.toString('utf8'));
  assert.ok(parsed.sitemaps.length >= 6, 'six sitemaps the apex soft-404 hid');
  assert.strictEqual(robots.verdict(parsed, ['/', '/us-en/ac-lite-16/4046051156996']).verdict, 'allow');
});

test('a plain-text robots.txt with no content-type still reads as robots', () => {
  const body = Buffer.from('User-agent: *\nDisallow: /admin\n');
  assert.strictEqual(looksLikeRobots({ status: 200, ctype: '', body }), true);
});

test('a non-200 is never treated as a readable robots.txt', () => {
  const body = Buffer.from('User-agent: *\nDisallow: /\n');
  assert.strictEqual(looksLikeRobots({ status: 403, ctype: 'text/plain', body }), false);
});

/* ---- 3. every host a redirect touches gets its clock stamped ---- */

test('a redirect hop to another host makes the NEXT request to that host wait', async () => {
  // Two hosts, one 302 from the first to the second. Without the fix the second
  // request to hostB starts immediately, because only hostA's clock was set.
  const nodeHttp = require('node:http');
  let hits = [];
  const srvB = nodeHttp.createServer((req, res) => {
    hits.push({ host: 'B', at: Date.now(), url: req.url });
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('User-agent: *\nAllow: /\n');
  });
  const srvA = nodeHttp.createServer((req, res) => {
    hits.push({ host: 'A', at: Date.now(), url: req.url });
    res.writeHead(302, { location: `http://127.0.0.1:${srvB.address().port}${req.url}` }); res.end();
  });
  await new Promise(r => srvB.listen(0, '127.0.0.1', r));
  await new Promise(r => srvA.listen(0, '127.0.0.1', r));
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'cb-politeness-'));
  try {
    const store = new http.Store(path.join(dir, 'raw'));
    const A = `http://127.0.0.1:${srvA.address().port}`;
    const B = `http://127.0.0.1:${srvB.address().port}`;
    // hop lands on B (this is the apex/robots.txt -> www/robots.txt shape)
    await http.fetchUrl(store, A + '/robots.txt');
    // then the storefront origin, which is B (the homepage fetch)
    await http.fetchUrl(store, B + '/');
    const onB = hits.filter(h => h.host === 'B');
    assert.strictEqual(onB.length, 2, 'both requests reached host B');
    const gap = onB[1].at - onB[0].at;
    assert.ok(gap >= http.MIN_GAP_MS,
      `host B was hit twice ${gap} ms apart; the floor is ${http.MIN_GAP_MS} ms`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise(r => srvA.close(r));
    await new Promise(r => srvB.close(r));
  }
});
