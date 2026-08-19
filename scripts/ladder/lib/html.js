'use strict';
/**
 * html.js — dependency-free HTML scoping and structured-data reading.
 *
 * DESIGN.md §4.3: "Scope is mandatory, declared before extraction... There is no
 * 'search the page' code path." The Tom Bihn defect (a 30L capacity from a
 * cross-sell block landing on the GE Synik 22) was fixed by scoping to
 * #product_specs--content. This module makes scoping the only expressible intent
 * and enforces the uniqueness assertion: a selector that matches more than one
 * node is an ERROR, never a reason to take [0].
 *
 * It returns byte OFFSETS as well as text, because `locus` has to be
 * re-evaluatable against the cached bytes at assemble time (DESIGN §4.3, cheap
 * locus check).
 *
 * No parser dependency, by project constraint. The structural scan masks
 * <script>/<style> bodies first so a `<` inside JS cannot be read as markup.
 */

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'", '#160': ' ' };
function decodeEntities(s) {
  return String(s).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, k) => {
    const low = k.toLowerCase();
    if (ENT[low] !== undefined) return ENT[low];
    if (low[0] === '#') {
      const n = low[1] === 'x' ? parseInt(low.slice(2), 16) : parseInt(low.slice(1), 10);
      if (Number.isFinite(n)) { try { return String.fromCodePoint(n); } catch { return m; } }
    }
    return m;
  });
}

/** mask <script>/<style> bodies and comments with spaces, preserving offsets */
function maskInert(html) {
  let out = html;
  const blank = (m) => ' '.repeat(m.length);
  out = out.replace(/<!--[\s\S]*?-->/g, blank);
  out = out.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi, (m, a, b, c) => a + blank(b) + c);
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (m, a, b, c) => a + blank(b) + c);
  return out;
}

function parseAttrs(tagText) {
  const attrs = {};
  const re = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tagText))) attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  return attrs;
}

/** compound selector: tag, #id, .class, [attr], [attr=value]; combinations allowed */
function parseSelector(sel) {
  const s = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w:.-]+)|\.([\w-]+)|\[([\w:-]+)(?:([~^]?=)"?([^\]"]*)"?)?\]/g;
  let m, any = false;
  while ((m = re.exec(sel))) {
    any = true;
    if (m[1]) s.tag = m[1].toLowerCase();
    else if (m[2]) s.id = m[2];
    else if (m[3]) s.classes.push(m[3]);
    else if (m[4]) s.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] ?? null });
  }
  if (!any) throw new Error('unparseable selector: ' + sel);
  return s;
}

function matches(sel, tagName, attrs) {
  if (sel.tag && sel.tag !== tagName) return false;
  if (sel.id && attrs.id !== sel.id) return false;
  if (sel.classes.length) {
    const cls = (attrs.class || '').split(/\s+/);
    if (!sel.classes.every(c => cls.includes(c))) return false;
  }
  for (const a of sel.attrs) {
    const v = attrs[a.name];
    if (v === undefined) return false;
    if (a.value !== null && a.op === '=' && v !== a.value) return false;
    if (a.value !== null && a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
    if (a.value !== null && a.op === '^=' && !v.startsWith(a.value)) return false;
  }
  return true;
}

/**
 * findAll(html, selector) -> [{start,end,innerStart,innerEnd,tag,attrs,html,inner}]
 * `selector` may contain descendant combinators: "#specs table td".
 * Offsets are indexes into the ORIGINAL html string.
 */
function findAll(html, selector, _range) {
  const parts = String(selector).trim().split(/\s+(?![^\[]*\])/);
  let ranges = _range ? [_range] : [{ start: 0, end: html.length }];
  const masked = maskInert(html);
  let results = [];
  for (let pi = 0; pi < parts.length; pi++) {
    const sel = parseSelector(parts[pi]);
    results = [];
    for (const range of ranges) {
      const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
      re.lastIndex = range.start;
      let m;
      while ((m = re.exec(masked)) && m.index < range.end) {
        const tag = m[1].toLowerCase();
        const attrs = parseAttrs(m[2] || '');
        if (!matches(sel, tag, attrs)) continue;
        const openEnd = m.index + m[0].length;
        let end = openEnd, innerEnd = openEnd;
        if (!VOID.has(tag) && !/\/\s*$/.test(m[2] || '')) {
          let depth = 1;
          const re2 = new RegExp(`<(/?)${tag}\\b((?:"[^"]*"|'[^']*'|[^>"'])*)>`, 'gi');
          re2.lastIndex = openEnd;
          let m2;
          while ((m2 = re2.exec(masked))) {
            if (m2[1] === '/') { depth--; if (!depth) { innerEnd = m2.index; end = m2.index + m2[0].length; break; } }
            else if (!/\/\s*$/.test(m2[2] || '')) depth++;
          }
          if (depth) { innerEnd = range.end; end = range.end; }   // unclosed
        }
        results.push({ start: m.index, end, innerStart: openEnd, innerEnd, tag, attrs,
                       html: html.slice(m.index, end), inner: html.slice(openEnd, innerEnd) });
      }
    }
    ranges = results.map(r => ({ start: r.innerStart, end: r.innerEnd }));
  }
  return results;
}

/**
 * findOne — the uniqueness assertion. >1 match is an error, not a [0].
 * Returns {ok:false, code:'scope-not-found'|'scope-not-unique', count}
 */
function findOne(html, selector) {
  const all = findAll(html, selector);
  if (all.length === 0) return { ok: false, code: 'scope-not-found', count: 0, selector };
  if (all.length > 1) return { ok: false, code: 'scope-not-unique', count: all.length, selector };
  return { ok: true, node: all[0], selector };
}

function toText(fragmentHtml) {
  return decodeEntities(
    String(fragmentHtml)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

/** every <script type="application/ld+json"> payload, parsed, with offsets */
function jsonLd(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(m[1] || '');
    if (!/ld\+json/i.test(attrs.type || '')) continue;
    const bodyStart = m.index + m[0].indexOf('>', 0) + 1;
    let raw = m[2];
    try { out.push({ json: JSON.parse(raw), raw, start: bodyStart, end: bodyStart + raw.length }); }
    catch { out.push({ json: null, raw, start: bodyStart, end: bodyStart + raw.length, parse_error: true }); }
  }
  return out;
}

/** a <script> carrying a JSON payload identified by id (Next.js __NEXT_DATA__ etc.) */
function scriptJsonById(html, id) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = parseAttrs(m[1] || '');
    if (attrs.id !== id) continue;
    try { return { json: JSON.parse(m[2]), raw: m[2], start: m.index }; } catch { return { json: null, raw: m[2], parse_error: true }; }
  }
  return null;
}

function metaContent(html, key) {
  const re = /<meta\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = parseAttrs(m[1] || '');
    if ((a.property && a.property.toLowerCase() === key.toLowerCase()) ||
        (a.name && a.name.toLowerCase() === key.toLowerCase())) {
      return { value: a.content || null, start: m.index, raw: m[0] };
    }
  }
  return null;
}

function canonicalUrl(html) {
  const re = /<link\b((?:"[^"]*"|'[^']*'|[^>"'])*)>/gi;
  let m;
  while ((m = re.exec(html))) {
    const a = parseAttrs(m[1] || '');
    if ((a.rel || '').toLowerCase() === 'canonical' && a.href) return { value: a.href, raw: m[0], start: m.index };
  }
  return null;
}

/** walk a JSON-LD graph and return every node whose @type includes `type` */
function ldNodes(doc, type) {
  const out = [];
  const seen = new Set();
  (function walk(n) {
    if (!n || typeof n !== 'object' || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) { n.forEach(walk); return; }
    const t = n['@type'];
    const types = Array.isArray(t) ? t : (t ? [t] : []);
    if (types.some(x => String(x).toLowerCase() === type.toLowerCase())) out.push(n);
    for (const k of Object.keys(n)) walk(n[k]);
  })(doc);
  return out;
}

module.exports = { findAll, findOne, toText, jsonLd, scriptJsonById, metaContent,
                   canonicalUrl, ldNodes, decodeEntities, parseAttrs, maskInert };
