'use strict';
/**
 * ladder.js — which rung of the extraction ladder works, and what it found.
 *
 * DESIGN.md §4.2:
 *   A  plain curl on the PDP, read JSON-LD / server-rendered spec block
 *   B  platform catalog endpoint (/products.json?limit=250) — 1-2 requests for a whole catalog
 *   C  local headless Chrome --dump-dom, SCOPED
 *   D  Chrome over DevTools Protocol (variant-locked fields)
 *
 * Gate G1 (shape assertion) lives here: the declared content-type must agree
 * with the parsed shape. HTML at a .json URL is a RUNG FAILURE — drop a rung,
 * log the reason, DO NOT PARSE. Measured cases: troubadourgoods.com/products.json
 * returned 490 KB of Next.js HTML with status 200; westernrise.com returned 0 bytes.
 */
const htmlLib = require('./html.js');
const crypto = require('crypto');

/** G1 — does the body's actual shape agree with its declared content-type? */
function assertShape(res, expect) {
  if (res.error) return { ok: false, code: 'transport-error', detail: res.error };
  if (res.status !== 200) return { ok: false, code: 'http-' + res.status };
  const body = res.body.toString('utf8');
  const head = body.slice(0, 400).trim();
  const looksHtml = /^<(!doctype|html|\?xml)/i.test(head) || /<html[\s>]/i.test(head);
  const looksJson = /^[{[]/.test(head);
  if (expect === 'json') {
    if (res.bytes === 0) return { ok: false, code: 'empty-body' };
    if (looksHtml) return { ok: false, code: 'html-at-json-url', ctype: res.ctype, bytes: res.bytes };
    if (!/json/i.test(res.ctype) && !looksJson) return { ok: false, code: 'ctype-not-json', ctype: res.ctype };
    try { return { ok: true, json: JSON.parse(body) }; }
    catch (e) { return { ok: false, code: 'json-parse-error', detail: String(e.message).slice(0, 120) }; }
  }
  if (expect === 'html') {
    if (res.bytes === 0) return { ok: false, code: 'empty-body' };
    if (looksJson) return { ok: false, code: 'json-at-html-url' };
    return { ok: true, text: body };
  }
  return { ok: true, text: body };
}

/** platform fingerprint from robots.txt + one page of HTML. No guessing: each signal is a literal. */
function fingerprint(robotsText, html, headers) {
  const signals = [];
  const has = (re, name) => { if (re.test(html || '')) signals.push(name); };
  if (/Disallow:\s*\/collections\/\*sort_by\*/i.test(robotsText || '')) signals.push('robots:shopify-collections-sort_by');
  if (/Disallow:\s*\/checkouts?\//i.test(robotsText || '')) signals.push('robots:shopify-checkouts');
  if (/Disallow:\s*\/wp-admin/i.test(robotsText || '')) signals.push('robots:wp-admin');
  has(/cdn\.shopify\.com|cdn\/shop\//i, 'html:cdn.shopify.com');
  has(/Shopify\.theme|window\.Shopify/i, 'html:window.Shopify');
  has(/__NEXT_DATA__/i, 'html:__NEXT_DATA__');
  has(/\/_next\/static\//i, 'html:_next/static');
  has(/self\.__next_f\.push/i, 'html:next-app-router-flight');
  has(/wp-content\/(themes|plugins)/i, 'html:wp-content');
  has(/woocommerce/i, 'html:woocommerce');
  has(/BigCommerce|bigcommerce\.com/i, 'html:bigcommerce');
  has(/data-squarespace|static1\.squarespace\.com/i, 'html:squarespace');
  has(/Wix\.com|static\.parastorage\.com/i, 'html:wix');
  const server = (headers && (headers['x-shopid'] || headers['x-shopify-stage'])) ? 'header:x-shopify' : null;
  if (server) signals.push(server);

  // The STOREFRONT decides which rung works; the COMMERCE BACKEND does not.
  // troubadourgoods.com serves cdn.shopify.com images from a Next.js front end on
  // Vercel: reading "shopify" off the image host would predict rung B, and rung B
  // returns 490 KB of HTML there. The front end wins the platform label.
  const next = signals.some(s => /next/i.test(s));
  const shopifyStore = signals.some(s => /robots:shopify|window\.Shopify|header:x-shopify/i.test(s));
  const shopifyCdn = signals.includes('html:cdn.shopify.com');
  let platform = 'unknown';
  if (next) platform = 'nextjs';
  else if (shopifyStore || shopifyCdn) platform = 'shopify';
  else if (signals.some(s => /woocommerce|wp-content/i.test(s))) platform = 'woocommerce';
  else if (signals.some(s => /bigcommerce/i.test(s))) platform = 'bigcommerce';
  else if (signals.some(s => /squarespace|wix/i.test(s))) platform = signals.find(s => /squarespace|wix/.test(s)).split(':')[1];
  const commerce = (shopifyStore || shopifyCdn) ? 'shopify' : null;
  return { platform, commerce, signals, predicts_rung_b: shopifyStore && !next };
}

/**
 * microdataInventory — schema.org expressed as MICRODATA rather than JSON-LD.
 *
 * Measured on magpul.com: /daka-pouch-small.html serves a complete
 * itemtype="http://schema.org/Product" with a nested Offer carrying
 * itemprop="price" content="19.95" and priceCurrency USD — 450,058 bytes of
 * perfectly good rung-A data. The probe reported "microdata-only" and dropped to
 * rung C, which found nothing either, and the brand came out as "no viable rung".
 * Microdata is not a lesser format; it is just an older one, and a rung that
 * refuses to read it invents a block that the site never imposed.
 */
function microdataInventory(html) {
  const h = html || '';
  const attr = (prop) => {
    const m = h.match(new RegExp('itemprop=["\']' + prop + '["\'][^>]*?content=["\']([^"\']+)["\']', 'i'))
           || h.match(new RegExp('content=["\']([^"\']+)["\'][^>]*?itemprop=["\']' + prop + '["\']', 'i'));
    return m ? m[1] : null;
  };
  const product = /itemtype=["']https?:\/\/schema\.org\/Product["']/i.test(h);
  const offer = /itemtype=["']https?:\/\/schema\.org\/(Offer|AggregateOffer)["']/i.test(h);
  const price = attr('price');
  return {
    product, offer,
    price: price != null && price !== '' ? price : null,
    currency: attr('priceCurrency'),
    sku: attr('sku'),
    has_name: /itemprop=["']name["']/i.test(h),
    has_description: /itemprop=["']description["']/i.test(h),
  };
}

/** what structured data does this HTML actually carry? (rung A viability) */
function structuredInventory(html) {
  const lds = htmlLib.jsonLd(html);
  const types = [];
  for (const s of lds) {
    if (!s.json) { types.push('PARSE-ERROR'); continue; }
    for (const n of [].concat(s.json['@graph'] || s.json)) {
      const t = n && n['@type'];
      if (t) types.push(...(Array.isArray(t) ? t : [t]));
    }
  }
  const products = lds.flatMap(s => s.json ? htmlLib.ldNodes(s.json, 'Product') : []);
  const next = htmlLib.scriptJsonById(html, '__NEXT_DATA__');
  return {
    jsonld_scripts: lds.length,
    jsonld_types: [...new Set(types.map(String))],
    jsonld_products: products.length,
    jsonld_product_fields: products.length
      ? [...new Set(products.flatMap(p => Object.keys(p)))].sort()
      : [],
    has_offers: products.some(p => p.offers),
    offer_price: products.map(p => {
      const o = [].concat(p.offers || [])[0];
      return o ? (o.price ?? (o.priceSpecification && o.priceSpecification.price) ?? null) : null;
    }).filter(x => x != null)[0] ?? null,
    microdata_product: /itemtype=["']https?:\/\/schema\.org\/Product["']/i.test(html),
    microdata: microdataInventory(html),
    next_data: !!(next && next.json),
    og_image: !!htmlLib.metaContent(html, 'og:image'),
    canonical: !!htmlLib.canonicalUrl(html),
  };
}

/**
 * rungAViable — does this page carry a usable product record, in ANY encoding?
 * JSON-LD Product+offers, or microdata Product+priced Offer. Returns
 * {viable, via, code} so the failure reason stays a closed vocabulary.
 */
function rungAViable(inv) {
  if (!inv) return { viable: false, via: null, code: 'no-inventory' };
  if (inv.jsonld_products > 0 && inv.has_offers) return { viable: true, via: 'jsonld', code: null };
  const md = inv.microdata || {};
  if (md.product && md.price != null) return { viable: true, via: 'microdata', code: null };
  if (inv.jsonld_products > 0) return { viable: false, via: null, code: 'jsonld-product-without-offers' };
  if (md.product) return { viable: false, via: null, code: 'microdata-product-without-price' };
  return { viable: false, via: null, code: 'no-structured-product-in-static-html' };
}

/**
 * classifyProductUrls — split a sitemap's <loc> list into product-URL candidates.
 *
 * Two tiers, because they answer two different questions and only one of them is
 * allowed to produce a number we publish:
 *
 *   strict — the URL carries an explicit product path segment (/products/,
 *            /product/, /shop/, /collections/x/products/). High precision. This
 *            is the ONLY tier permitted to feed a yield estimate, because a
 *            listings_est is a claim and a claim needs evidence.
 *
 *   loose  — plausible leaf pages for a storefront that does not use a product
 *            segment at all. Magpul is the measured case: Magento serves flat
 *            `.html` leaves at root, so all 594 URLs in its sitemap score zero
 *            under `strict`, the probe found no sample PDP, and a brand that
 *            answers fine on rung A was reported as having no viable rung.
 *
 * `loose` is used ONLY to pick sample PDPs to try, never to count anything. That
 * is safe because the sample is self-validating: rung A only reports viable if
 * the page actually contains a JSON-LD Product with offers, so a category page
 * that sneaks into `loose` fails the check instead of becoming a fake product.
 */
const NON_PRODUCT = /\/(blog|news|press|about|contact|support|help|faq|search|account|login|cart|checkout|policies|pages?|category|categories|collections)(\/|\.|$)/i;

// Segments that follow /products/ on a LISTING page rather than a product page.
// bellroy.com/products/category/backpacks matched the naive /products/ test, so
// the probe sampled a category page, rung A found no Product on it (correctly),
// and rung C then rendered that same category page in a browser and also found
// nothing — reporting "no viable rung" for a brand whose PDPs were three entries
// further down the same sitemap.
const LISTING_SEG = /^(category|categories|collection|collections|all|index|browse|shop|search|filter|page)$/i;

function isStrictProductUrl(u) {
  let segs;
  try { segs = new URL(u).pathname.replace(/\/$/, '').split('/').filter(Boolean); }
  catch { return false; }
  const i = segs.findIndex(s => /^(products?|shop)$/i.test(s));
  if (i < 0) return false;
  const rest = segs.slice(i + 1);
  if (!rest.length) return false;                 // /products alone is the index
  if (LISTING_SEG.test(rest[0])) {
    // Shopify's /collections/<x>/products/<slug> is still a PDP; a bare
    // /products/category/<x> is not. Only accept if a later products/ segment
    // introduces an actual slug.
    const j = rest.findIndex(s => /^products?$/i.test(s));
    return j >= 0 && !!rest[j + 1] && !LISTING_SEG.test(rest[j + 1]);
  }
  return !LISTING_SEG.test(rest[rest.length - 1]);
}

function classifyProductUrls(urls, origin) {
  const same = urls.filter(u => { try { return new URL(u).host === new URL(origin).host; } catch { return false; } });
  const strict = same.filter(isStrictProductUrl);
  const loose = same.filter(u => {
    if (strict.includes(u)) return true;
    let p;
    try { p = new URL(u).pathname; } catch { return false; }
    if (p === '/' || NON_PRODUCT.test(p)) return false;
    const segs = p.replace(/\/$/, '').split('/').filter(Boolean);
    // a flat leaf (`/pmag-30-ar-m4-gen-m3.html`) or a shallow slug, with a
    // hyphenated multi-word name — the shape a product slug actually has
    if (segs.length > 2) return false;
    const leaf = segs[segs.length - 1] || '';
    return /-/.test(leaf) && leaf.split('-').length >= 2;
  });
  return { strict: [...new Set(strict)], loose: [...new Set(loose)], total: same.length };
}

/** G1b — structural hash of what extraction depends on. A mismatch halts before extracting. */
function structureFingerprint(kind, payload) {
  let material;
  if (kind === 'shopify-catalog') {
    const p = (payload.products || [])[0] || {};
    material = JSON.stringify({
      product_keys: Object.keys(p).sort(),
      variant_keys: Object.keys((p.variants || [])[0] || {}).sort(),
      image_keys: Object.keys((p.images || [])[0] || {}).sort(),
    });
  } else if (kind === 'jsonld') {
    material = JSON.stringify(payload);
  } else {
    material = JSON.stringify(payload);
  }
  return { kind, sha256: crypto.createHash('sha256').update(material).digest('hex'), material: JSON.parse(material) };
}

module.exports = { assertShape, fingerprint, structuredInventory, structureFingerprint,
                   classifyProductUrls, microdataInventory, rungAViable };
