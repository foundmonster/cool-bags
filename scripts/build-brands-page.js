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
 * that are measured.
 *
 * It renders as ONE SORTABLE TABLE — issue, brand, website, bags, on the site —
 * rather than four two-column lists. The lists could not answer "is brand X on
 * the site?" without scanning four sections, and they had no room for the URL,
 * which is the field that actually unblocks work: probe.js can determine
 * nothing without one. The four categories survive as the sidebar statistics,
 * with these definitions:
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
      // ALL states, not just open. A live brand's issue is closed — that is the
      // "shipped, issue closed" case — and fetching only open ones stripped the
      // issue number off every one of the 47 live rows.
      const raw = execFileSync('gh', ['issue', 'list', '--repo', 'foundmonster/cool-bags',
        '--state', 'all', '--limit', '500', '--json', 'number,title,labels,state'], { encoding: 'utf8' });
      fs.writeFileSync(ISSUE_CACHE, raw);
      return JSON.parse(raw);
    } catch (e) {
      console.error(`gh failed (${e.message.split('\n')[0]}); falling back to the cache`);
    }
  }
  if (!fs.existsSync(ISSUE_CACHE)) throw new Error('no issue cache and gh unavailable');
  return JSON.parse(fs.readFileSync(ISSUE_CACHE, 'utf8'));
}

// Issue titles are user-submitted prose, not a field. The open list contains
// feature requests ("Capacity filtrer", "filter by bag size", "Add list view"),
// test submissions ("9 test 9", "another testo 4") and sentences ("Add Patagonia
// and Osprey please"). The old page listed every one of them as a brand.
const JUNK = /\btest(o|ing)?\b|\bfilter\b|\bview\b|\bproject\b|\bsearch\b|\bsort\b|\bdark mode\b|\bfeature\b|\bbug\b|\bpage\b/i;

/** Strip the decorations issue titles carry so the brand name is comparable. */
function brandFromIssue(title) {
  const name = title
    .replace(/^\[?(brand request|brand)\]?:?\s*/i, '')
    .replace(/\s*(brand integration|[-–—]\s*(add|integration|research).*)$/i, '')
    .replace(/^add\s+/i, '')      // "Add Bellroy Brand" -> "Bellroy Brand"
    .replace(/\s+brand$/i, '')    // -> "Bellroy", which merges with the live row
    .replace(/\s+please$/i, '')
    .trim();
  if (!name || JUNK.test(name)) return null;
  if (/[:?]|\sand\s|^obtain\b|^sample\b|^request\b/i.test(name)) return null;
  // A brand name is a name, not a sentence. Four words is generous — the longest
  // real one here is "Hyperlite Mountain Gear".
  if (name.split(/\s+/).length > 4) return null;
  return name;
}

function build({ offline = false } = {}) {
  const bags = JSON.parse(fs.readFileSync(path.join(ROOT, 'bags.json'), 'utf8'));
  const strategies = JSON.parse(fs.readFileSync(path.join(__dirname, 'ladder', 'strategies.json'), 'utf8')).brands || {};
  const issues = loadIssues(offline);

  // ---- LIVE is ground truth: it is what index.html renders. The website comes
  // from the brand's own record links, which is more reliable than the ladder's
  // domain because those URLs are link-checked.
  const counts = new Map();
  const siteFromRecords = new Map();
  for (const b of bags) {
    counts.set(b.brand, (counts.get(b.brand) || 0) + 1);
    if (!siteFromRecords.has(b.brand)) {
      try { siteFromRecords.set(b.brand, new URL(b.link).hostname.replace(/^www\./, '')); } catch { /* unparseable link */ }
    }
  }

  const ladder = new Map();
  for (const [slug, rec] of Object.entries(strategies)) {
    const entry = {
      verdict: rec.verdict || null,
      rung: rec.winner ? rec.winner.rung : null,
      domain: rec.domain ? String(rec.domain).replace(/^www\./, '') : null,
      products: rec.probe ? rec.probe.products_found : null,
    };
    for (const k of [...aliasKeys(rec.brand || slug), key(slug), key(String(slug).replace(/^name:/, ''))]) {
      if (k && !ladder.has(k)) ladder.set(k, entry);
    }
  }
  const look = (name) => {
    for (const k of aliasKeys(name)) if (ladder.has(k)) return ladder.get(k);
    return null;
  };

  // ---- one row per brand, merged across all three sources
  const rows = new Map();
  const rejected = new Set();
  const findKey = (name) => {
    for (const k of aliasKeys(name)) if (rows.has(k)) return k;
    return key(name);
  };
  const put = (name, patch) => {
    const k = findKey(name);
    const cur = rows.get(k) || { brand: name, issue: null, website: null, bags: 0, live: false };
    rows.set(k, { ...cur, ...patch, brand: cur.brand || name });
  };

  for (const [brand, n] of counts) {
    const l = look(brand);
    put(brand, { brand, bags: n, live: true, website: siteFromRecords.get(brand) || (l && l.domain) || null });
  }
  for (const iss of issues) {
    const labels = (iss.labels || []).map((l) => l.name.toLowerCase());
    if (labels.includes('bug') || labels.includes('enhancement')) continue;
    if (/^seo:|^link rot|^defective|^brands\.html/i.test(iss.title)) continue;
    const name = brandFromIssue(iss.title);
    if (!name || name.length > 40) continue;
    const k = findKey(name);
    const existing = rows.get(k);
    // Test submissions arrive lowercase and unspaced ("tstsar", "sealson"). So
    // does a real issue titled "tomtoc", so this can only fire for a name that
    // appears in no other source — applied unconditionally it dropped a live
    // brand off the page entirely.
    if (!existing && !look(name) && !/\s/.test(name) && name === name.toLowerCase() && !/\d/.test(name)) continue;
    // A CLOSED issue only means something for a brand that is actually live —
    // the "shipped, issue closed" case. Otherwise it was rejected or was never a
    // brand, and must not create a row: closed #25 "Capacity filtrer" did.
    if (iss.state !== 'OPEN' && !(existing && existing.live)) {
      // Remember the rejection. A brand can still have a strategies.json entry
      // from a probe — Linus Tech Tips answers rung B with 129 products — and
      // without this it reappears from the ladder loop below and keeps counting
      // toward In Progress after someone deliberately closed it as out of scope.
      rejected.add(k);
      continue;
    }
    if (existing && existing.issue && iss.state !== 'OPEN') continue;
    const l = look(name);
    put(name, {
      issue: iss.number,
      website: (existing && existing.website) || (l && l.domain) || null,
      bags: existing ? existing.bags : 0,
      live: existing ? existing.live : false,
    });
  }
  for (const [slug, rec] of Object.entries(strategies)) {
    const name = rec.brand || String(slug).replace(/^name:/, '');
    const k = findKey(name);
    if (rows.has(k)) continue;
    if (rejected.has(k)) continue;   // closed as out of scope; a probe does not resurrect it
    put(name, { website: rec.domain ? String(rec.domain).replace(/^www\./, '') : null });
  }

  // ---- the four categories survive as the sidebar statistics
  for (const r of rows.values()) {
    const l = look(r.brand);
    r.status = r.live ? 'live'
      : (l && BLOCKING.has(l.verdict)) ? 'blocked'
      : (l && l.rung) ? 'in-progress'
      : 'queued';
  }

  const list = [...rows.values()].sort((a, b) => b.bags - a.bags || a.brand.localeCompare(b.brand));
  const liveCount = list.filter((r) => r.live).length;
  const inProgress = list.filter((r) => r.status === 'in-progress').length;
  const queued = list.filter((r) => r.status === 'queued').length;
  const blocked = list.filter((r) => r.status === 'blocked').length;
  const totalBags = list.reduce((n, r) => n + r.bags, 0);
  const progress = Math.round((liveCount / list.length) * 100);

  const body = list.map((r) => `                    <tr>
                      <td data-sort="${r.issue == null ? 999999 : r.issue}">${r.issue == null ? '<span class="muted">—</span>' : `<a href="https://github.com/foundmonster/cool-bags/issues/${r.issue}" target="_blank" rel="noopener noreferrer">#${r.issue}</a>`}</td>
                      <td data-sort="${esc(r.brand.toLowerCase())}">${esc(r.brand)}</td>
                      <td data-sort="${esc(r.website || 'zzz')}">${r.website ? `<a href="https://${esc(r.website)}" target="_blank" rel="noopener noreferrer">${esc(r.website)}</a>` : '<span class="muted">—</span>'}</td>
                      <td class="num" data-sort="${r.bags}">${r.bags || '<span class="muted">0</span>'}</td>
                      <td data-sort="${r.live ? 1 : 0}">${r.live ? 'Yes' : '<span class="no">No</span>'}</td>
                    </tr>`).join('\n');

  const sections = `            <div class="table-controls">
              <input type="search" id="brand-filter" placeholder="Filter brands…" autocomplete="off">
              <button class="chip" id="only-live" aria-pressed="false">On the site only</button>
              <button class="chip" id="only-missing" aria-pressed="false">Not on the site</button>
            </div>

            <table class="brands" id="brands-table">
              <colgroup>
                <col style="width: 88px">
                <col style="width: 26%">
                <col>
                <col style="width: 92px">
                <col style="width: 116px">
              </colgroup>
              <thead>
                <tr>
                  <th data-type="num">Issue<span class="arrow"></span></th>
                  <th data-type="str">Brand<span class="arrow"></span></th>
                  <th data-type="str">Website<span class="arrow"></span></th>
                  <th data-type="num" class="num">Bags<span class="arrow"></span></th>
                  <th data-type="num">On the site<span class="arrow"></span></th>
                </tr>
              </thead>
              <tbody>
${body}
              </tbody>
            </table>
            <div class="rowcount" id="rowcount"></div>

            <script>
              (function () {
                const table = document.getElementById('brands-table');
                const tbody = table.tBodies[0];
                const all = [...tbody.rows];
                const heads = [...table.tHead.rows[0].cells];

                // Sort reads data-sort, never the rendered text: "#103" and an em
                // dash would sort as strings, and Yes/No would sort alphabetically
                // rather than by state.
                heads.forEach((th, i) => th.addEventListener('click', () => {
                  const dir = th.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
                  heads.forEach(h => h.removeAttribute('aria-sort'));
                  th.setAttribute('aria-sort', dir === 1 ? 'ascending' : 'descending');
                  const numeric = th.dataset.type === 'num';
                  const val = r => { const v = r.cells[i].dataset.sort; return numeric ? Number(v) : String(v); };
                  all.sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * dir; });
                  render();
                }));

                const q = document.getElementById('brand-filter');
                const onlyLive = document.getElementById('only-live');
                const onlyMissing = document.getElementById('only-missing');
                [onlyLive, onlyMissing].forEach(b => b.addEventListener('click', () => {
                  const on = b.getAttribute('aria-pressed') === 'true';
                  [onlyLive, onlyMissing].forEach(o => o.setAttribute('aria-pressed', 'false'));
                  b.setAttribute('aria-pressed', on ? 'false' : 'true');
                  render();
                }));
                q.addEventListener('input', render);

                function render() {
                  const term = q.value.trim().toLowerCase();
                  const live = onlyLive.getAttribute('aria-pressed') === 'true';
                  const missing = onlyMissing.getAttribute('aria-pressed') === 'true';
                  let shown = 0;
                  tbody.replaceChildren();
                  for (const r of all) {
                    const isLive = r.cells[4].dataset.sort === '1';
                    if (live && !isLive) continue;
                    if (missing && isLive) continue;
                    if (term && !r.cells[1].textContent.toLowerCase().includes(term)
                             && !r.cells[2].textContent.toLowerCase().includes(term)) continue;
                    tbody.appendChild(r); shown++;
                  }
                  document.getElementById('rowcount').textContent = shown + ' of ' + all.length + ' brands';
                }
                render();
              })();
            <\/script>`;

  const stat = (label, value, extra = '') =>
    `                        <li${extra}>\n                            <span class="stat-label">${label}</span>\n` +
    `                            <span class="stat-value">${value}</span>\n                        </li>`;
  const stats = `<ul class="stats-list">\n` + [
    stat('Live Brands', liveCount),
    stat('In Progress', inProgress),
    stat('Queued', queued),
    stat('Blocked', blocked),
    stat('Total Brands', list.length),
    stat('Progress', `${progress}%`, ` class="progress-item" data-progress="${progress}%"`),
  ].join('\n') + `\n                    </ul>`;

  const version = `Generated ${new Date().toISOString().slice(0, 10)} from ${bags.length} records`;

  const html = fs.readFileSync(TEMPLATE, 'utf8')
    .replace('{{SECTIONS}}', sections)
    .replace('{{STATS}}', stats)
    .replace('{{VERSION}}', version);

  return { html, list, liveCount, inProgress, queued, blocked, totalBags, progress };
}

function main() {
  const argv = process.argv.slice(2);
  const check = argv.includes('--check');
  const r = build({ offline: argv.includes('--offline') });

  console.log(`${r.list.length} brands | live ${r.liveCount} | in progress ${r.inProgress} | queued ${r.queued} | blocked ${r.blocked} | ${r.totalBags} bags | ${r.progress}%`);

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
