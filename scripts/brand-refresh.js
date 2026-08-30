#!/usr/bin/env node
/**
 * brand-refresh.js — reconcile one brand's records against its live catalog.
 *
 *   node scripts/brand-refresh.js "Mission Workshop"
 *   node scripts/brand-refresh.js Tomtoc --json out.json
 *
 * Node 22, stdlib only. Fetching, cookies, redirects and robots come from
 * scripts/ladder/lib/ — same politeness layer as probe.js and link-check.js.
 *
 * WHY THIS EXISTS SEPARATELY FROM link-check.js
 *
 * The two answer different questions and neither is sufficient alone. That is
 * not a design preference, it is a measured result from the 2026-08-19 pass:
 *
 *   - Catalog matching alone called Pakt 59 and 64 dead. Both return 200 and
 *     are live; they are simply missing from the products.json page.
 *   - Link checking alone called Aer 37 dead, because its URL 404s. The model
 *     is alive, split by size into -20l and -24l handles.
 *
 * Deleting on either signal by itself would have been wrong both times. So the
 * rule this tool exists to support is: ACT ONLY WHERE BOTH AGREE, and before
 * deleting anything, look for a successor — a rename, a size split, or a new
 * generation. Mission Workshop's Capsule was not discontinued; it became
 * Capsule Pro. A checker cannot tell those apart. A person reading this output
 * can.
 *
 * WHAT IT WILL NOT DO
 *
 * It does not write to bags.json. Every deletion, repoint and price change in
 * this project has been a judgement call about what an id MEANS — ids are the
 * pin and share key, so silently repointing one changes the bag under someone
 * who saved it. This prints evidence and stops.
 *
 * CURRENCY
 *
 * Price drift is reported, never assumed. wexley.jp publishes 23100 where our
 * record says 210: that is yen against dollars, not staleness. Any store whose
 * host is not clearly a USD storefront is flagged `currency-unverified` and its
 * prices are reported for reading, not for copying.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { fetchUrl, Store } = require('./ladder/lib/http.js');
const robots = require('./ladder/lib/robots.js');

const ROOT = path.join(__dirname, '..');
const CACHE = path.join(__dirname, 'ladder', '.cache', '_refresh');

// Titles that are not carry gear. Checked before the bag words, so
// "Zipper Puller Kit" does not enter the queue on the strength of "kit".
const NOT_GEAR = ['gift card', 'e-gift', 'tee', 't-shirt', 'shirt', 'hoodie', 'socks', 'hat', 'cap',
  'sticker', 'patch', 'keychain', 'lanyard', 'bottle', 'towel', 'poster', 'book', 'cleaner',
  'warranty', 'repair', 'zipper puller', 'strap only', 'gift wrap'];
const GEAR = ['pack', 'bag', 'sling', 'tote', 'duffel', 'duffle', 'pouch', 'cube', 'case', 'backpack',
  'briefcase', 'folio', 'kit', 'crossbody', 'satchel', 'organiser', 'organizer', 'sleeve', 'roll',
  'rucksack', 'holster', 'insert', 'carrier'];

const MATERIAL = /\b(ultra|x-?pac|ecopak|cordura|dyneema|ripstop|waxed canvas|canvas|leather)\b/g;

/** Collapse colourway and material variants so a queue lists models, not SKUs. */
function baseModel(title) {
  return title.toLowerCase()
    .replace(/^(custom|personalized|personalised)\s+/, '')
    .replace(/\((\d{4}|pre-order)\)/g, '')
    .replace(MATERIAL, '')
    .replace(/\b\d+(\.\d+)?\s*l\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[-–\s]+|[-–\s]+$/g, '');
}

const handleOf = (link) => (String(link || '').match(/\/products\/([^/?#]+)/) || [])[1] || null;
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function liveCatalog(store, origin) {
  const policy = await (async () => {
    const r = await fetchUrl(store, origin + '/robots.txt', { timeoutMs: 15000 });
    return robots.verdict(robots.parse(r.body ? r.body.toString() : '', r.status == null ? 599 : r.status), ['/products.json', '/products/']);
  })();
  if (policy.verdict !== 'allow') return { policy, products: [] };

  const products = [];
  for (let page = 1; page <= 6; page++) {
    const r = await fetchUrl(store, `${origin}/products.json?limit=250&page=${page}`, { timeoutMs: 30000 });
    if (r.error || r.status !== 200 || !r.body) break;
    let j;
    // A shape assertion, not politeness: troubadourgoods.com answers
    // /products.json with 490KB of Next.js HTML and status 200. Parsing that
    // as a catalog would report every record dead.
    try { j = JSON.parse(r.body.toString()); } catch { break; }
    if (!j || !Array.isArray(j.products) || !j.products.length) break;
    products.push(...j.products);
    if (j.products.length < 250) break;
  }
  return { policy, products };
}

async function main() {
  const argv = process.argv.slice(2);
  const brandArg = argv.find((a) => !a.startsWith('--'));
  const jsonOut = argv.includes('--json') ? argv[argv.indexOf('--json') + 1] : null;
  if (!brandArg) { console.error('usage: brand-refresh.js "<Brand>" [--json out.json]'); process.exit(2); }

  const bags = JSON.parse(fs.readFileSync(path.join(ROOT, 'bags.json'), 'utf8'));
  const ours = bags.filter((b) => (b.brand || '').toLowerCase() === brandArg.toLowerCase());
  if (!ours.length) { console.error(`no records for brand ${JSON.stringify(brandArg)}`); process.exit(2); }

  const origins = [...new Set(ours.map((r) => { try { return new URL(r.link).origin; } catch { return null; } }).filter(Boolean))];
  const origin = origins[0];
  if (origins.length > 1) console.log(`note: records span ${origins.length} origins; using ${origin}\n`);

  const store = new Store(path.join(CACHE, origin.replace(/[^a-z0-9]+/gi, '-')));
  const { policy, products } = await liveCatalog(store, origin);
  if (policy.verdict !== 'allow') {
    console.log(`${brandArg}: ${origin} robots.txt says ${policy.verdict} (${policy.reason}). Not fetched, nothing inferred.`);
    process.exit(3);
  }

  const byHandle = new Map(products.map((p) => [p.handle, p]));
  const byTitle = new Map(products.map((p) => [norm(p.title), p]));
  const usdLikely = /\.(com|us|co)$/.test(new URL(origin).hostname.replace(/^www\./, '').split('/')[0]) && !/\.jp$/.test(origin);

  const rows = [], matched = new Set();
  for (const r of ours.sort((a, b) => a.id - b.id)) {
    const h = handleOf(r.link);
    let p = h ? byHandle.get(h) : null;
    let how = p ? 'handle' : null;
    if (!p) { p = byTitle.get(norm(r.name)); how = p ? 'title' : null; }
    if (p) matched.add(p.handle);
    // BASE price, not the price on the tag today. Shopify puts the sale price in
    // `price` and the original in `compare_at_price`, so a product on sale reports
    // half its real price. Mountainsmith's 2024 Sidekick reads 13.95 / compare_at
    // 27.95 against our stored 28 — copying `price` there would have replaced a
    // correct record with a sale. CLAUDE.md asks for base price; this is it.
    const v0 = p && p.variants && p.variants[0] ? p.variants[0] : null;
    const onSale = v0 && v0.compare_at_price && parseFloat(v0.compare_at_price) > parseFloat(v0.price);
    const livePrice = v0 ? parseFloat(onSale ? v0.compare_at_price : v0.price) : null;
    rows.push({ id: r.id, name: r.name, our_price: r.price, our_volume: r.volume, handle: h,
      found: !!p, matched_by: how, live_title: p ? p.title : null, live_handle: p ? p.handle : null,
      live_price: livePrice, live_on_sale: !!onSale, live_sale_price: onSale ? parseFloat(v0.price) : null,
      live_grams: v0 ? v0.grams : null });
  }

  const queue = new Map();
  for (const p of products) {
    if (matched.has(p.handle)) continue;
    const t = p.title.toLowerCase();
    if (NOT_GEAR.some((n) => t.includes(n))) continue;
    if (!GEAR.some((g) => t.includes(g)) && !GEAR.some((g) => String(p.product_type || '').toLowerCase().includes(g))) continue;
    const k = baseModel(p.title);
    if (!queue.has(k)) queue.set(k, []);
    queue.get(k).push(p);
  }

  // ------------------------------------------------------------- report
  const gone = rows.filter((r) => !r.found);
  const stale = rows.filter((r) => r.found && r.live_handle && r.handle !== r.live_handle);
  const drift = rows.filter((r) => r.found && r.live_price != null && r.our_price != null && Math.abs(r.live_price - r.our_price) > 0.5);

  console.log(`${brandArg} — ${ours.length} records vs ${products.length} live products at ${origin}\n`);

  if (gone.length) {
    console.log(`NOT IN CATALOG — ${gone.length}. Confirm with link-check before deleting, and look for a successor first.`);
    for (const r of gone) console.log(`  #${r.id} ${r.name}   handle=${r.handle}`);
    console.log('');
  }
  if (stale.length) {
    console.log(`HANDLE MOVED — ${stale.length}. The record still matches a live product under a different URL.`);
    for (const r of stale) console.log(`  #${r.id} ${r.name}: ${r.handle} -> ${r.live_handle}`);
    console.log('');
  }
  if (drift.length) {
    console.log(`PRICE DRIFT — ${drift.length}${usdLikely ? '' : '  (currency-unverified: do NOT copy these without checking)'}`);
    let up = 0;
    for (const r of drift) { if (r.live_price > r.our_price) up++; console.log(`  #${r.id} ${r.name}: ours ${r.our_price} live ${r.live_price}${r.live_on_sale ? `  (on sale at ${r.live_sale_price}; base shown)` : ''}`); }
    console.log(`  ${up} of ${drift.length} moved UP. A one-directional drift usually means the originals were captured on sale.\n`);
  }
  console.log(`QUEUE — ${[...queue.values()].reduce((n, v) => n + v.length, 0)} unmatched gear listings in ${queue.size} distinct models`);
  for (const [k, v] of queue) {
    const titles = [...new Set(v.map((p) => p.title))].sort();
    console.log(`  ${k.slice(0, 44).padEnd(46)} x${String(v.length).padEnd(3)} $${v[0].variants?.[0]?.price ?? '?'}  e.g. ${titles[0].slice(0, 46)}`);
  }

  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ brand: brandArg, origin, at: new Date().toISOString(),
      catalog_size: products.length, currency_verified: usdLikely, rows,
      queue: [...queue.entries()].map(([model, v]) => ({ model, variants: v.length, handle: v[0].handle,
        titles: [...new Set(v.map((p) => p.title))].slice(0, 8), price: v[0].variants?.[0]?.price ?? null })) }, null, 2));
    console.log(`\nreport: ${jsonOut}`);
  }
}

main().catch((e) => { console.error(e); process.exit(2); });
