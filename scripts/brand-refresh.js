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
    // Two independent traps live in this one number, and both have already
    // corrupted records in this catalog.
    //
    // 1. SALE. Shopify puts the sale price in `price` and the original in
    //    `compare_at_price`. Mountainsmith's 2024 Sidekick reads 13.95 /
    //    compare_at 27.95 against our stored 28 — reading `price` would have
    //    replaced a correct record with a sale.
    // 2. VARIANT CHOICE. `variants[0]` is whatever the merchant happened to
    //    order first, and it is routinely NOT the base product:
    //      - ILE  load-cell-cuboid  variants[0] = "Kit of 3" bundle, $130,
    //        while the real sizes are 40/48/56 — the values we already store.
    //      - Chrome Barrage        variants[0] = a premium colourway, +$5 over
    //        the black we catalogue under the tier rules.
    //      - Alpaka               prices by material; variants[0] is the cheap
    //        Axoflux, so every X-Pac record looks wrong.
    //      - Cotopaxi Allpa 18L   10 of 11 variants are 110; variants[0] is the
    //        one 130 outlier.
    //    Reading variants[0] alone would have flagged 17 correct records as
    //    drifted. So: collect the base price of EVERY variant, and treat the
    //    record as correct if it matches ANY of them. Report the modal price as
    //    the headline and carry the full set, because picking one for a
    //    multi-variant product is a judgement about which product the record
    //    means — not something this script gets to decide.
    const variants = (p && Array.isArray(p.variants)) ? p.variants : [];
    const basesOf = (v) => {
      const price = parseFloat(v.price);
      const cmp = v.compare_at_price == null ? null : parseFloat(v.compare_at_price);
      return { base: cmp && cmp > price ? cmp : price, sale: cmp && cmp > price ? price : null };
    };
    const all = variants.map(basesOf);
    const bases = [...new Set(all.map((x) => x.base))].sort((a, b) => a - b);
    const counts = new Map();
    for (const x of all) counts.set(x.base, (counts.get(x.base) || 0) + 1);
    const modal = bases.length ? [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0] : null;
    const onSale = all.some((x) => x.sale != null);
    const v0 = variants[0] || null;
    const livePrice = modal;
    rows.push({ id: r.id, name: r.name, our_price: r.price, our_volume: r.volume, handle: h,
      found: !!p, matched_by: how, live_title: p ? p.title : null, live_handle: p ? p.handle : null,
      live_price: livePrice, live_bases: bases, live_variant_count: variants.length,
      live_on_sale: !!onSale, live_sale_price: onSale ? Math.min(...all.filter((x) => x.sale != null).map((x) => x.sale)) : null,
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
  const drift = rows.filter((r) => r.found && r.live_price != null && r.our_price != null
    && !(r.live_bases || []).some((b) => Math.abs(b - r.our_price) <= 0.5));

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
    for (const r of drift) {
      if (r.live_price > r.our_price) up++;
      const spread = (r.live_bases || []).length > 1 ? `  [${r.live_variant_count} variants, bases ${r.live_bases.join('/')}]` : '';
      console.log(`  #${r.id} ${r.name}: ours ${r.our_price} live ${r.live_price}${r.live_on_sale ? `  (on sale at ${r.live_sale_price}; base shown)` : ''}${spread}`);
    }
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
