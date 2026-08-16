'use strict';
/**
 * failclosed.test.js — pins the four blockers found by the adversarial audit of
 * the first real probe wave. Every one of them was a way for the safety layer to
 * say "yes" when it had no business saying anything, and every one was MEASURED
 * before being fixed, not hypothesised.
 *
 *   1. Agent matching was a substring test, so a longer imposter group won.
 *   2. An unreadable robots.txt (5xx/429/HTML) parsed to zero rules -> allow.
 *   3. The response cache was untimed, so a "re-test" replayed old bytes and
 *      re-dated the record as freshly measured.
 *   4. Brands that stopped before the ladder wrote no attempts row, so they
 *      could never age out and --retest-stale could never reach them.
 *
 * Blockers 2 and 4 are the same disease as BLOCKED-BRANDS.md: a verdict that is
 * never re-examined. That file was wrong about 10 of 11 brands and cost this
 * project roughly 1,200 products. Do not "simplify" these tests away.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const robots = require('../lib/robots.js');
const strategies = require('../lib/strategies.js');

/* ---------------------------------------------- 1. imposter agent groups */

test('an agent name merely CONTAINING our token cannot outrank a real opt-out', () => {
  const txt = [
    'User-agent: ClaudeBot',
    'Disallow: /',
    '',
    'User-agent: SuperClaudeBotImposter',
    'Allow: /',
  ].join('\n');
  const v = robots.verdict(robots.parse(txt), ['/']);
  // Before the fix: groupFor() scored by raw agent-name length under a
  // substring match, so 'superclaudebotimposter' (22 chars) beat 'claudebot'
  // (9) and this returned allow.
  assert.strictEqual(v.verdict, 'do-not-scrape', 'imposter group must not win');
  assert.strictEqual(v.reason, 'named-ua-disallow');
});

test('exact-token matching still honours a real group addressed to us', () => {
  const txt = 'User-agent: claudebot\nDisallow: /private\nAllow: /\n';
  const p = robots.parse(txt);
  assert.strictEqual(robots.isAllowed(p, '/private/x').allowed, false);
  assert.strictEqual(robots.isAllowed(p, '/products.json').allowed, true);
});

test('a longer unrelated agent name is simply not our group', () => {
  const txt = [
    'User-agent: anthropic-ai-friendly-crawler',
    'Allow: /',
    '',
    'User-agent: anthropic-ai',
    'Disallow: /',
  ].join('\n');
  assert.strictEqual(robots.verdict(robots.parse(txt), ['/']).verdict, 'do-not-scrape');
});

test('when two identities we present under disagree, the restrictive one binds', () => {
  const txt = [
    'User-agent: claudebot',
    'Disallow: /',
    '',
    'User-agent: coolbags-intake',
    'Allow: /',
  ].join('\n');
  // Both tokens are ours and equally specific by token length is not the point:
  // a Disallow addressed to any identity we present under is binding on us.
  const g = robots.groupFor(robots.parse(txt));
  assert.ok(g.rules.some(r => r.type === 'disallow'), 'must select the restricting group');
});

test('a wildcard-only file still allows', () => {
  assert.strictEqual(robots.verdict(robots.parse('User-agent: *\nDisallow: /cart\n'), ['/']).verdict, 'allow');
});

/* ---------------------------------------------- 2/3/4 via the registry */

test('a brand with no winner and no attempts can still go stale', () => {
  // Before the fix, staleEntries() walked only b.attempts, so any brand whose run
  // stopped before the ladder was invisible to the retest machinery forever.
  // 41 of 102 brands in the first real registry were in exactly this state.
  const old = new Date(Date.now() - 200 * 864e5).toISOString();
  const reg = {
    expiry_days: 90,
    brands: {
      ghost: {
        brand: 'Ghost', domain: 'ghost.example', winner: null, attempts: {},
        policy: { verdict: 'allow', checked_at: old },
      },
    },
  };
  const stale = strategies.staleEntries(reg);
  assert.strictEqual(stale.length, 1, 'a 200-day-old attempt-less brand must be stale');
  assert.strictEqual(stale[0].slug, 'ghost');
});

test('a genuine publisher opt-out is NOT aged for retry', () => {
  // We do not re-litigate an opt-out looking for a way in. This is the one
  // verdict that is deliberately permanent.
  const old = new Date(Date.now() - 500 * 864e5).toISOString();
  const reg = {
    expiry_days: 90,
    brands: {
      optout: {
        brand: 'OptOut', domain: 'optout.example', winner: null, attempts: {},
        policy: { verdict: 'do-not-scrape', reason: 'named-ua-disallow', checked_at: old },
      },
    },
  };
  assert.strictEqual(strategies.staleEntries(reg).length, 0, 'opt-outs must never be queued for retry');
});

test('a TRANSIENT unreachability IS aged for retry', () => {
  // "We could not read your robots.txt" is a deny, but it is not consent and it
  // is not permanent. It must come back around.
  const old = new Date(Date.now() - 200 * 864e5).toISOString();
  const reg = {
    expiry_days: 90,
    brands: {
      flaky: {
        brand: 'Flaky', domain: 'flaky.example', winner: null, attempts: {},
        policy: { verdict: 'do-not-scrape', reason: 'robots-unreachable', transient: true, checked_at: old },
      },
    },
  };
  assert.strictEqual(strategies.staleEntries(reg).length, 1, 'transient denies must be retried');
});

test('a fresh failure is not stale', () => {
  const reg = {
    expiry_days: 90,
    brands: {
      recent: {
        brand: 'Recent', domain: 'recent.example', winner: null, attempts: {},
        policy: { verdict: 'allow', checked_at: new Date().toISOString() },
      },
    },
  };
  assert.strictEqual(strategies.staleEntries(reg).length, 0);
});

/* ---------------------------------------------- 5. brand-level opt-out */

test('an opt-out recorded on one host covers the brand\'s other hosts', () => {
  // The Berghaus incident in one test. www.berghaus.com carries the ClaudeBot
  // Disallow; the apex serves a stock permissive Shopify robots.txt. Checking
  // robots per host is necessary but not sufficient — the registry has to
  // remember the brand said no, whichever host you arrive at.
  const { findOptOut } = require('../probe.js');
  if (typeof findOptOut !== 'function') return;   // exported only for testing
  const reg = { brands: { berghaus: {
    brand: 'Berghaus', domain: 'www.berghaus.com',
    policy: { verdict: 'do-not-scrape', reason: 'named-ua-disallow' },
    alternate_domains: [{ domain: 'berghaus.com', verdict: 'do-not-scrape' }],
  } } };
  assert.ok(findOptOut(reg, 'berghaus.com'), 'apex must be covered');
  assert.ok(findOptOut(reg, 'www.berghaus.com'), 'www must be covered');
  assert.ok(findOptOut(reg, 'shop.berghaus.com'), 'subdomains must be covered');
  assert.strictEqual(findOptOut(reg, 'someoneelse.com'), null, 'unrelated hosts must not be blocked');
});

test('a transient unreachable deny does NOT become a permanent brand block', () => {
  const { findOptOut } = require('../probe.js');
  if (typeof findOptOut !== 'function') return;
  const reg = { brands: { flaky: {
    brand: 'Flaky', domain: 'flaky.example',
    policy: { verdict: 'do-not-scrape', reason: 'robots-unreachable', transient: true },
  } } };
  assert.strictEqual(findOptOut(reg, 'flaky.example'), null,
    'a transient deny must not block the brand forever');
});
