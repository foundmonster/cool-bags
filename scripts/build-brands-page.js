#!/usr/bin/env node
/**
 * build-brands-page.js — generate brands.html from measured sources.
 *
 *   node scripts/build-brands-page.js            # write brands.html
 *   node scripts/build-brands-page.js --check    # exit 1 if the page is stale
 *   node scripts/build-brands-page.js --offline  # skip GitHub, use the issue cache
 *
 * WHY THIS EXISTS
 *
 * brands.html was hand-maintained: 101 <div class="brand-item"> blocks last
 * touched 2025-12-16. By 2026-08-30 an audit found it wrong in every way a
 * tracker can be wrong:
 *
 *   - It named ZERO of the 43 live brands. The .completed CSS styled nothing,
 *     so the page could not answer "is brand X on the site?"
 *   - Six brands marked Blocked answered at a working rung the same day
 *     (Bailey Works, CTactical, Cabin Zero, Day Owl, Fyro, Graphene-X).
 *   - Nine unreachable or robots-excluded brands sat under "In Progress".
 *   - WANDRD was listed in progress while live.
 *
 * None of that is fixable by editing, because the page's categories encoded a
 * judgement no source recorded. So the page becomes a VIEW over three files
 * that are measured, and the categories are given definitions that can be
 * checked:
 *
 *   LIVE        it has records in bags.json. Ground truth — this is what
 *               index.html renders.
 *   IN PROGRESS an open GitHub issue AND a proven extraction rung in
 *               strategies.json. "We know how to get this and it is queued."
 *   QUEUED      an open issue, no proven rung yet, nothing blocking.
 *   BLOCKED     a measured verdict: do-not-scrape, host-unreachable or
 *               wrong-business — printed WITH its probe date, because a blocked
 *               claim with no date is exactly what rotted here. `no-url` is NOT
 *               blocked; it is un-researched and lands in Queued.
 *               strategies.json expires failure verdicts after 90 days, so
 *               these age out and re-probe instead of calcifying.
 *
 * Run it in the same change as any bags.json merge. `--check` in CI or before
 * a release tells you the page drifted without editing anything.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = path.join(__dirname, 'templates', 'brands.tpl.html');
const OUT = path.join(ROOT, 'brands.html');
const ISSUE_CACHE = path.join(__dirname, 'templates', 'brand-issues.json');

// `no-url` is deliberately NOT here. It means nobody has recorded the brand's
// site yet — that is un-researched, not blocked, and mixing the two makes the
// blocked list look like a wall when half of it is a five-minute lookup.
const BLOCKING = new Set(['do-not-scrape', 'host-unreachable', 'wrong-business']);

// A brand's display name differs across sources: bags.json says "ILE", the issue
// says "Inside Line Equipment", the ladder slug says "ilequipment". Matching on a
// squashed key keeps one brand from appearing in two sections at once.
const key = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {
  ile: ['insidelineequipment'],
  goruck: ['gorucks'],
  wandrd: ['wandrd'],
  sixmoondesign: ['sixmoondesigns'],
};
function aliasKeys(name) {
  const k = key(name);
  const out = new Set([k]);
  for (const [a, list] of Object.entries(ALIAS)) {
    if (k === a) list.forEach((x) => out.add(x));
    if (list.includes(k)) out.add(a);
  }
  return out;
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function loadIssues(offline) {
  if (!offline) {
    try {
      const raw = execFileSync('gh', ['issue', 'list', '--repo', 'foundmonster/cool-bags',
        '--state', 'open', '--limit', '400', '--json', 'number,title,labels'], { encoding: 'utf8' });
      fs.writeFileSync(ISSUE_CACHE, raw);
      return JSON.parse(raw);
    } catch (e) {
      console.error(`gh failed (${e.message.split('\n')[0]}); falling back to the cache`);
    }
  }
  if (!fs.existsSync(ISSUE_CACHE)) throw new Error('no issue cache and gh unavailable');
  return JSON.parse(fs.readFileSync(ISSUE_CACHE, 'utf8'));
}

/** Strip the decorations issue titles carry so the brand name is comparable. */
function brandFromIssue(title) {
  return title
    .replace(/^\[?(brand request|brand)\]?:?\s*/i, '')
    .replace(/\s*[-–—]\s*(add|integration|research).*$/i, '')
    .trim();
}

function build({ offline = false } = {}) {
  const bags = JSON.parse(fs.readFileSync(path.join(ROOT, 'bags.json'), 'utf8'));
  const strategies = JSON.parse(fs.readFileSync(path.join(__dirname, 'ladder', 'strategies.json'), 'utf8'));
  const issues = loadIssues(offline);

  // ---- LIVE: ground truth, straight from what the catalog renders
  const counts = new Map();
  for (const b of bags) counts.set(b.brand, (counts.get(b.brand) || 0) + 1);
  const live = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, n]) => ({ name, n }));
  const liveKeys = new Set();
  for (const l of live) for (const k of aliasKeys(l.name)) liveKeys.add(k);

  // ---- ladder verdicts, keyed for lookup
  const ladder = new Map();
  for (const [slug, rec] of Object.entries(strategies.brands || {})) {
    const entry = {
      verdict: rec.verdict, rung: rec.winner ? rec.winner.rung : null,
      policy: rec.policy ? rec.policy.verdict : null,
      reason: (rec.policy && rec.policy.reason) || rec.verdict,
      at: (rec.winner && rec.winner.at) || (rec.policy && rec.policy.at) || (rec.probe && rec.probe.at) || null,
      products: rec.probe ? rec.probe.products_found : null,
      name: rec.brand || slug,
    };
    for (const k of aliasKeys(rec.brand || slug)) if (!ladder.has(k)) ladder.set(k, entry);
    if (!ladder.has(key(slug))) ladder.set(key(slug), entry);
  }

  // ---- open issues that name a brand, excluding anything already live
  const seen = new Set();
  const pending = [];
  for (const iss of issues) {
    const labels = (iss.labels || []).map((l) => l.name.toLowerCase());
    const name = brandFromIssue(iss.title);
    if (!name || name.length > 40) continue;
    if (labels.includes('bug') || labels.includes('enhancement') || /^seo:|^link rot|^defective/i.test(iss.title)) continue;
    const k = key(name);
    if (!k || liveKeys.has(k) || seen.has(k)) continue;
    seen.add(k);
    pending.push({ name, number: iss.number, ladder: ladder.get(k) || null });
  }

  const blocked = pending.filter((p) => p.ladder && BLOCKING.has(p.ladder.verdict));
  const inProgress = pending.filter((p) => !blocked.includes(p) && p.ladder && p.ladder.rung);
  const queued = pending.filter((p) => !blocked.includes(p) && !inProgress.includes(p));

  const sort = (a, b) => a.name.localeCompare(b.name);
  blocked.sort(sort); inProgress.sort(sort); queued.sort(sort);

  // ---- render
  // The stylesheet has always had `.brand-item.completed .checkbox svg { display: block }`
  // and nothing ever rendered it, because no completed row existed. Emit the tick.
  // No stroke attribute on the path: the stylesheet already sets `stroke: white`
  // on `.checkbox svg`, and a presentation attribute here would override it and
  // paint the tick black on a black box.
  const TICK = '<svg viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const item = (cls, label, note) =>
    `                    <div class="brand-item ${cls}">\n` +
    `                        <div class="checkbox">${cls === 'completed' ? TICK : ''}</div>\n` +
    `                        <div class="brand-name">${esc(label)}${note ? ` <span class="brand-note">${esc(note)}</span>` : ''}</div>\n` +
    `                    </div>`;

  const section = (title, rows) =>
    `            <div class="section">\n` +
    `                <h2 class="section-title">${esc(title)}</h2>\n` +
    `                <div class="brands-list">\n${rows.join('\n')}\n                </div>\n` +
    `            </div>`;

  const sections = [
    section(`Live (${live.length})`, live.map((l) => item('completed', l.name, `${l.n} ${l.n === 1 ? 'bag' : 'bags'}`))),
    section(`In Progress (${inProgress.length})`, inProgress.map((p) =>
      item('in-progress', p.name, `rung ${p.ladder.rung}${p.ladder.products ? `, ${p.ladder.products} products` : ''} · #${p.number}`))),
    section(`Queued (${queued.length})`, queued.map((p) => item('pending', p.name,
      p.ladder && p.ladder.verdict === 'no-url' ? `no site recorded · #${p.number}` : `#${p.number}`))),
    // The date is the point of this section. A blocked verdict with no date is
    // what let a November 2025 failure still be believed in August 2026.
    section(`Blocked (${blocked.length})`, blocked.map((p) =>
      item('blocked', p.name, `${p.ladder.reason || p.ladder.verdict}${p.ladder.at ? ` · checked ${p.ladder.at.slice(0, 10)}` : ''} · #${p.number}`))),
  ].join('\n');

  const totalTracked = live.length + inProgress.length + queued.length + blocked.length;
  const progress = Math.round((live.length / totalTracked) * 100);
  const stat = (label, value, extra = '') =>
    `                        <li${extra}>\n                            <span class="stat-label">${label}</span>\n` +
    `                            <span class="stat-value">${value}</span>\n                        </li>`;
  const stats = `<ul class="stats-list">\n` + [
    stat('Live Brands', live.length),
    stat('In Progress', inProgress.length),
    stat('Queued', queued.length),
    stat('Blocked', blocked.length),
    stat('Total Brands', totalTracked),
    stat('Progress', `${progress}%`, ` class="progress-item" data-progress="${progress}%"`),
  ].join('\n') + `\n                    </ul>`;

  const bagCount = bags.length;
  const version = `Generated ${new Date().toISOString().slice(0, 10)} from ${bagCount} records`;

  const html = fs.readFileSync(TEMPLATE, 'utf8')
    .replace('{{SECTIONS}}', sections)
    .replace('{{STATS}}', stats)
    .replace('{{VERSION}}', version);

  return { html, live, inProgress, queued, blocked, totalTracked, progress };
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const r = build({ offline: argv.includes('--offline') });

  console.log(`live ${r.live.length} | in progress ${r.inProgress.length} | queued ${r.queued.length} | blocked ${r.blocked.length} | ${r.progress}% of ${r.totalTracked}`);

  if (check) {
    const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
    // The generated line stamps today's date, so compare everything else.
    const strip = (s) => s.replace(/<div class="version">[^<]*<\/div>/, '');
    if (strip(current) === strip(r.html)) { console.log('brands.html is current'); process.exit(0); }
    console.error('brands.html is STALE — run: node scripts/build-brands-page.js');
    process.exit(1);
  }

  fs.writeFileSync(OUT, r.html);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
}

main();
