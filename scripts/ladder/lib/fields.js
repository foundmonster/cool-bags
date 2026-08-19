'use strict';
/**
 * fields.js — the field extractors. Each one returns {value, quote, ...} or null.
 * There is no third state (Invariant P), which is why none of these functions
 * has a default, a fallback constant or a brand assumption anywhere in it.
 *
 * Every quote returned here is a MINIMAL slice: the shortest span that still
 * contains the value. Minimal quotes are what make Invariant Q sharp — a quote
 * of the whole product title would let value 33 "pass" against
 * "Aviator T33 Chest Bag 1.5l".
 */

const CANON_TYPES = ['Backpack', 'Sling', 'Tote', 'Duffel', 'Pouch', 'Messenger', 'Packing Cube',
  'Shoulder Bag', 'Toiletry Kit', 'Case', 'Camera Bag', 'Briefcase', 'Specialty', 'Unclassified'];

// title token -> canonical type. Ordered: first match wins, longest phrases first.
const TYPE_LEXICON = [
  ['packing cube', 'Packing Cube'], ['toiletry kit', 'Toiletry Kit'], ['dopp kit', 'Toiletry Kit'],
  ['wash bag', 'Toiletry Kit'], ['camera bag', 'Camera Bag'], ['camera cube', 'Camera Bag'],
  ['shoulder bag', 'Shoulder Bag'], ['messenger', 'Messenger'], ['briefcase', 'Briefcase'],
  ['backpack', 'Backpack'], ['rucksack', 'Backpack'], ['daypack', 'Backpack'], ['knapsack', 'Backpack'],
  ['sling', 'Sling'], ['tote', 'Tote'], ['duffel', 'Duffel'], ['duffle', 'Duffel'],
  ['weekender', 'Duffel'], ['pouch', 'Pouch'], ['case', 'Case'], ['pack', 'Backpack'],
];

// A product is bag-like if its title matches one of these. Used only to COUNT and
// FLAG; the decision "is this a bag" is the human's (DESIGN §4.6, strike grid).
const BAGLIKE = /(backpack|rucksack|daypack|day pack|\bpack\b|sling|tote|duffel|duffle|messenger|briefcase|satchel|pouch|dopp|toiletry|wash bag|camera (bag|cube)|shoulder bag|weekender|carry-?all|holdall|\bbag\b|\bcase\b|packing cube|hip pack|fanny|waist pack|crossbody)/i;

const MATERIAL_LEXICON = [
  [/dyneema|dcf\b|cuben ?fib(er|re)/i, 'Dyneema'],
  [/ultra ?(100|200|400|x|weave)/i, 'Ultra'],
  [/ecopak|epx\d{2,3}|ep\s?\d{3}/i, 'ECOPAK'],
  [/x-?pac|vx\s?21|vx\s?42/i, 'X-Pac'],
  [/embertex/i, 'Embertex'],
  [/cordura/i, 'Cordura'],
  [/ballistic nylon|ripstop nylon|\bnylon\b|robic|halcyon/i, 'Nylon'],
  [/vegan leather|pu leather/i, 'Vegan Leather'],
  [/polyester|\bpet\b recycled|rpet/i, 'Polyester'],
  [/\bmesh\b/i, 'Mesh'],
  [/organic cotton|\bcanvas\b|\bcotton\b/i, 'Cotton'],
];
const MATERIAL_PATTERNS = ['dyneema', 'ultra', 'ecopak', 'x-pac', 'cordura', 'nylon', 'polyester',
  'cotton', 'canvas', 'leather', 'mesh', 'embertex', 'ripstop'];

/** minimal window around an index, snapped to word boundaries */
function window(text, start, end, pad = 40) {
  let a = Math.max(0, start - pad), b = Math.min(text.length, end + pad);
  while (a > 0 && /\S/.test(text[a - 1])) a--;
  while (b < text.length && /\S/.test(text[b])) b++;
  return text.slice(a, b).trim();
}

/**
 * rawQuote — re-locate a text-derived quote inside the ORIGINAL html bytes, so
 * the envelope's quote satisfies Invariant V. Allows tags and whitespace between
 * characters; allows nothing else.
 */
function rawQuote(raw, textQuote) {
  if (!raw) return null;
  if (raw.includes(textQuote)) return textQuote;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pat = textQuote.split(/\s+/).map(esc).join('(?:\\s|<[^>]*>|&nbsp;)+');
  const m = raw.match(new RegExp(pat, 'i'));
  return m ? m[0] : null;
}

/* ------------------------------------------------------------------ volume */

// Decimal-aware. "1.5L" -> 1.5, never 5. "24L" -> 24. "1,5 l" -> 1.5.
const LITRE_RE = /(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:-|–)?\s*(?:l|ltr|lt|liters?|litres?)\b(?!\w)/i;
const CUIN_RE = /(\d{2,5}(?:\.\d+)?)\s*(?:cu(?:bic)?\.?\s*(?:in(?:ch(?:es)?)?)|in(?:ch)?(?:\^?3|³))\b/i;

function volumeFrom(text) {
  if (!text) return null;
  const m = text.match(LITRE_RE);
  if (m) {
    const v = parseFloat(m[1].replace(',', '.'));
    if (Number.isFinite(v) && v > 0) {
      return { value: v, unit: 'L', quote: m[0].trim(), confidence: 'exact', method: 'litre-token' };
    }
  }
  const c = text.match(CUIN_RE);
  if (c) {
    const ci = parseFloat(c[1]);
    if (Number.isFinite(ci) && ci > 0) {
      return { value: Math.round(ci * 0.0163871 * 10) / 10, unit: 'L', quote: c[0].trim(),
               confidence: 'derived', method: 'cubic-inch', transform: 'cubicInToL' };
    }
  }
  return null;
}

/**
 * Tier 2 (DESIGN §4.3): a BARE trailing number in a model name — "Mariposa 60",
 * "Synik 25". Emitted as confidence:"inferred", requiring human confirmation.
 * This is what the old extractor was reaching for and got wrong by demanding an L.
 */
function volumeFromBareName(title) {
  if (!title) return null;
  if (LITRE_RE.test(title)) return null;                 // tier 1 already handles it
  const m = title.match(/(?:^|\s)(\d{1,3})(?:\.\d)?\s*$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  if (!Number.isFinite(v) || v < 3 || v > 120) return null;
  return { value: v, unit: 'L', quote: m[0].trim(), confidence: 'inferred', method: 'bare-trailing-number' };
}

/* ------------------------------------------------------------------ weight */

const WEIGHT_RES = [
  [/(\d{1,4}(?:\.\d+)?)\s*(?:kg|kilograms?)\b/i, (n) => n, null],
  [/(\d{2,5}(?:\.\d+)?)\s*(?:g|grams?|gr)\b(?!\w)/i, (n) => n / 1000, 'gramsToKg'],
  [/(\d{1,3}(?:\.\d+)?)\s*(?:lbs?|pounds?)\b/i, (n) => n * 0.45359237, 'lbToKg'],
  [/(\d{1,4}(?:\.\d+)?)\s*(?:oz|ounces?)\b/i, (n) => n * 0.0283495231, 'ozToKg'],
];
function weightFrom(text) {
  if (!text) return null;
  for (const [re, conv, transform] of WEIGHT_RES) {
    const m = text.match(re);
    if (!m) continue;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    const kg = Math.round(conv(n) * 1000) / 1000;
    if (kg < 0.02 || kg > 8) continue;                   // implausible-weight, dropped not guessed
    return { value: kg, unit: 'kg', quote: m[0].trim(),
             confidence: transform ? 'derived' : 'exact', method: 'weight-token', transform };
  }
  return null;
}

/* ---------------------------------------------------------------- material */

function materialFrom(text) {
  if (!text) return null;
  for (const [re, canon] of MATERIAL_LEXICON) {
    const m = text.match(re);
    if (!m) continue;
    const q = window(text, m.index, m.index + m[0].length, 30);
    // Invariant Q for strings needs norm(value) inside norm(quote). The canonical
    // label must therefore literally appear; "Cordura" from "CORDURA(R)" is fine,
    // "Nylon" from "Robic" is NOT, so those map back to their own matched token.
    const value = new RegExp(canon.replace(/[-]/g, '.?'), 'i').test(m[0]) ? canon : null;
    if (!value) return { value: null, rejected: canon, matched: m[0], quote: q, method: 'material-lexicon-unquotable' };
    return { value, quote: q, confidence: 'derived', method: 'material-lexicon' };
  }
  return null;
}

/* -------------------------------------------------------------------- type */

function typeFrom(title) {
  if (!title) return null;
  const low = title.toLowerCase();
  for (const [tok, canon] of TYPE_LEXICON) {
    const i = low.indexOf(tok);
    if (i < 0) continue;
    // Q (string): norm(value) must be a substring of norm(quote). "Backpack" is a
    // substring of "Backpack"; "Backpack" is NOT a substring of "Daypack", so a
    // synonym hit quotes the synonym and drops to derived-with-caveat.
    const quote = title.slice(i, i + tok.length);
    const quotable = quote.toLowerCase().includes(canon.toLowerCase());
    return { value: canon, quote, confidence: quotable ? 'derived' : 'inferred',
             method: 'type-lexicon', synonym: quotable ? null : tok, quotable };
  }
  return null;
}

function isBagLike(title) { return !!(title && BAGLIKE.test(title)); }

/**
 * TYPE_TRANSFORM — `type` is a CLASSIFICATION, not a transcription, so Invariant
 * Q is satisfied in the FORWARD direction: applying this declared, deterministic
 * lexicon to the quote reproduces the value. "24L Adventure Pack" quotes the
 * token "Pack" and the lexicon turns it into "Backpack"; the envelope records
 * both, at confidence "inferred", so a reviewer sees the mapping that was used.
 *
 * The same latitude is deliberately NOT given to `material`. A lexicon that
 * turns "Robic" into "Nylon" is exactly the move that produced 445 fabricated
 * Nylons; material ships only when the canonical label is literally in the quote.
 */
const TYPE_TRANSFORM = { name: 'type-lexicon', derive: (q) => { const t = typeFrom(q); return t ? t.value : null; } };

/* ---------------------------------------------------- family key (estimate) */

const COLOR_TOKENS = ['black', 'blk', 'jet', 'obsidian', 'charcoal', 'graphite', 'grey', 'gray',
  'white', 'ivory', 'bone', 'sand', 'tan', 'khaki', 'coyote', 'olive', 'ranger green', 'green',
  'navy', 'blue', 'teal', 'red', 'burgundy', 'maroon', 'orange', 'yellow', 'purple', 'pink',
  'brown', 'natural', 'clear', 'multicam', 'camo', 'stone', 'slate', 'silver', 'gold'];

/**
 * familyKey — a COUNTING aid only. DESIGN §4.4 puts the real colourway collapse
 * in collapse.js with a recorded rule per decision; this is used to produce
 * listings_est during triage, where an approximate number is honest as long as
 * it is labelled an estimate.
 */
function familyKey(title) {
  let t = String(title || '').toLowerCase()
    .replace(/[™®©]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s*[-–|]\s*/g, ' ')
    .replace(/[^\w\s.]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  for (const c of COLOR_TOKENS) {
    t = t.replace(new RegExp('(^|\\s)' + c + '(\\s|$)', 'g'), ' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

module.exports = {
  volumeFrom, volumeFromBareName, weightFrom, materialFrom, typeFrom, isBagLike,
  rawQuote, window, familyKey, TYPE_TRANSFORM, CANON_TYPES, MATERIAL_PATTERNS, COLOR_TOKENS, LITRE_RE,
};
