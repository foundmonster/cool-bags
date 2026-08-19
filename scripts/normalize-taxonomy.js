#!/usr/bin/env node
'use strict';

/**
 * normalize-taxonomy.js — collapse the type and material vocabularies in
 * bags.json down to the canonical sets, losslessly.
 *
 * Usage:
 *   node scripts/normalize-taxonomy.js            # DRY RUN (default) — prints the diff, writes nothing
 *   node scripts/normalize-taxonomy.js --apply    # writes bags.json in place
 *   node scripts/normalize-taxonomy.js --verbose  # dry run + sample ids per mapping
 *   node scripts/normalize-taxonomy.js --file path/to/bags.json
 *
 * The vocabularies live in scripts/validate-bags.js (TYPE_MAP / MATERIAL_MAP)
 * and are imported from there — that file is the single place to edit them.
 *
 * WHAT IT CHANGES, AND WHY IT IS LOSSLESS
 * ---------------------------------------
 *   type      -> canonical value. The original string is preserved in `typeRaw`
 *                whenever it differs, so the merge is fully reversible.
 *   material  -> canonical primary. When the original string carried detail
 *                beyond the canonical name (e.g. "Axoflux 600D / X-Pac RX36"
 *                -> "X-Pac"), the original is preserved verbatim in
 *                `materialDetail`. 24 of the 34 material values in the file
 *                carry such detail; none of it is discarded.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 * -----------------------------------
 *   - null material. Turning null into "Unspecified" would disguise missing
 *     data as a real value. The card rendering "null" is a bug in index.html's
 *     unguarded template, and it belongs fixed there, not papered over here.
 *   - Anything other than type/material. Deduping, price research, volume
 *     re-scrapes and link fixes are separate jobs with separate judgement.
 *
 * Writing preserves key order and 2-space JSON formatting so the git diff shows
 * only the lines that actually changed. New keys are inserted directly after the
 * field they annotate (typeRaw after type, materialDetail after material).
 *
 * Re-running after an --apply is a no-op: canonical values map to themselves and
 * an existing typeRaw / materialDetail is never overwritten.
 *
 * Zero dependencies. CommonJS. Node >= 14.
 */

const fs = require('fs');
const path = require('path');

const { TYPE_MAP, MATERIAL_MAP } = require('./validate-bags.js');

/* ========================================================================== */

function parseArgs(argv) {
  const opts = { apply: false, verbose: false, file: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opts.apply = true;
    else if (a === '--verbose' || a === '-v') opts.verbose = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    // --file must carry a path. A bare trailing `--file`, or `--file=`, used to
    // leave opts.file falsy and fall back to the repo's own bags.json — so
    // `--apply --file` with a forgotten path rewrote PRODUCTION data silently.
    else if (a === '--file') {
      opts.file = argv[++i];
      if (opts.file === undefined || opts.file === '') fail('--file requires a path');
    }
    else if (a.startsWith('--file=')) {
      opts.file = a.slice(7);
      if (opts.file === '') fail('--file requires a path');
    }
    else {
      process.stderr.write('normalize-taxonomy: unknown option ' + a + '\n');
      process.exit(2);
    }
  }
  return opts;
}

function fail(msg) {
  process.stderr.write('normalize-taxonomy: ' + msg + '\n');
  process.exit(2);
}

/**
 * Rebuild a record with `newKey` inserted immediately after `afterKey`,
 * every other key left in its original position. Keeping key order stable is
 * what keeps the git diff to the changed lines only.
 */
function withKeyAfter(rec, afterKey, newKey, value) {
  const out = {};
  Object.keys(rec).forEach(function (k) {
    if (k === newKey) return; // re-inserted in position below
    out[k] = rec[k];
    if (k === afterKey) out[newKey] = value;
  });
  if (!(newKey in out)) out[newKey] = value; // afterKey absent — append
  return out;
}

function tally(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

/* ========================================================================== */

function normalize(bags) {
  const typeChanges = new Map();     // "from -> to" => { from, to, ids: [] }
  const materialChanges = new Map();
  const unmappedTypes = new Map();
  const unmappedMaterials = new Map();
  const skipped = { typeRawPresent: 0, materialDetailPresent: 0, nullMaterial: 0 };

  const typeCanonical = new Set(Object.values(TYPE_MAP));
  const materialCanonical = new Set(Object.values(MATERIAL_MAP));

  const before = { type: new Map(), material: new Map() };
  const after = { type: new Map(), material: new Map() };

  const out = bags.map(function (original) {
    let rec = original;
    let changed = false;

    /* ---- type ---- */
    const rawType = rec.type;
    if (typeof rawType === 'string' && rawType !== '') {
      tally(before.type, rawType);
      const canon = Object.prototype.hasOwnProperty.call(TYPE_MAP, rawType)
        ? TYPE_MAP[rawType]
        : (typeCanonical.has(rawType) ? rawType : null);

      if (canon === null) {
        tally(unmappedTypes, rawType);
        tally(after.type, rawType);
      } else if (canon !== rawType) {
        if ('typeRaw' in rec && rec.typeRaw !== null && rec.typeRaw !== undefined) {
          skipped.typeRawPresent++;
          rec = Object.assign({}, rec, { type: canon });
        } else {
          rec = withKeyAfter(Object.assign({}, rec, { type: canon }), 'type', 'typeRaw', rawType);
        }
        changed = true;
        const key = rawType + ' -> ' + canon;
        if (!typeChanges.has(key)) typeChanges.set(key, { from: rawType, to: canon, ids: [] });
        typeChanges.get(key).ids.push(rec.id);
        tally(after.type, canon);
      } else {
        tally(after.type, rawType);
      }
    }

    /* ---- material ---- */
    const rawMaterial = rec.material;
    if (rawMaterial === null || rawMaterial === undefined) {
      skipped.nullMaterial++;
    } else if (typeof rawMaterial === 'string' && rawMaterial !== '') {
      tally(before.material, rawMaterial);
      const canon = Object.prototype.hasOwnProperty.call(MATERIAL_MAP, rawMaterial)
        ? MATERIAL_MAP[rawMaterial]
        : (materialCanonical.has(rawMaterial) ? rawMaterial : null);

      if (canon === null) {
        tally(unmappedMaterials, rawMaterial);
        tally(after.material, rawMaterial);
      } else if (canon !== rawMaterial) {
        if ('materialDetail' in rec && rec.materialDetail !== null && rec.materialDetail !== undefined) {
          skipped.materialDetailPresent++;
          rec = Object.assign({}, rec, { material: canon });
        } else {
          rec = withKeyAfter(
            Object.assign({}, rec, { material: canon }), 'material', 'materialDetail', rawMaterial);
        }
        changed = true;
        const key = rawMaterial + ' -> ' + canon;
        if (!materialChanges.has(key)) {
          materialChanges.set(key, { from: rawMaterial, to: canon, ids: [] });
        }
        materialChanges.get(key).ids.push(rec.id);
        tally(after.material, canon);
      } else {
        tally(after.material, rawMaterial);
      }
    }

    return changed ? rec : original;
  });

  const changedRecords = out.filter(function (r, i) { return r !== bags[i]; }).length;

  return {
    records: out,
    changedRecords: changedRecords,
    typeChanges: Array.from(typeChanges.values()).sort(function (a, b) { return b.ids.length - a.ids.length; }),
    materialChanges: Array.from(materialChanges.values()).sort(function (a, b) { return b.ids.length - a.ids.length; }),
    unmappedTypes: unmappedTypes,
    unmappedMaterials: unmappedMaterials,
    skipped: skipped,
    before: before,
    after: after,
  };
}

/* ========================================================================== */

function table(rows, headers) {
  const all = [headers].concat(rows);
  const widths = headers.map(function (_, c) {
    return all.reduce(function (w, r) { return Math.max(w, String(r[c]).length); }, 0);
  });
  const line = function (r, padChar) {
    return '  ' + r.map(function (cell, c) {
      return String(cell).padEnd(widths[c], padChar || ' ');
    }).join('  ').replace(/\s+$/, '');
  };
  const out = [line(headers)];
  // The last column ("ids") is free-form and unbounded — under --verbose it can
  // run to hundreds of characters. Nothing is aligned after it, so its rule is
  // drawn at header width instead of content width.
  const last = widths.length - 1;
  out.push('  ' + widths.map(function (w, c) {
    return '-'.repeat(c === last ? headers[c].length : w);
  }).join('  '));
  rows.forEach(function (r) { out.push(line(r)); });
  return out;
}

function report(result, opts, meta) {
  const L = [];
  L.push('normalize-taxonomy — ' + meta.file);
  L.push(opts.apply ? 'MODE: APPLY (bags.json will be rewritten)'
                    : 'MODE: DRY RUN (nothing is written — pass --apply to write)');
  L.push(meta.total + ' records');

  L.push('');
  L.push('TYPE  ' + result.before.type.size + ' distinct values in  ->  ' +
    result.after.type.size + ' distinct values out');
  if (result.typeChanges.length) {
    const rows = result.typeChanges.map(function (c) {
      return [c.from, '->', c.to, String(c.ids.length),
        opts.verbose ? c.ids.join(', ') : c.ids.slice(0, 6).join(', ') +
          (c.ids.length > 6 ? ', …' : '')];
    });
    table(rows, ['FROM', '', 'TO', 'RECORDS', 'ids']).forEach(function (l) { L.push(l); });
  } else {
    L.push('  (no type changes)');
  }

  L.push('');
  L.push('MATERIAL  ' + result.before.material.size + ' distinct values in  ->  ' +
    result.after.material.size + ' distinct values out');
  if (result.materialChanges.length) {
    const rows = result.materialChanges.map(function (c) {
      return [c.from, '->', c.to, String(c.ids.length),
        opts.verbose ? c.ids.join(', ') : c.ids.slice(0, 6).join(', ') +
          (c.ids.length > 6 ? ', …' : '')];
    });
    table(rows, ['FROM', '', 'TO', 'RECORDS', 'ids']).forEach(function (l) { L.push(l); });
  } else {
    L.push('  (no material changes)');
  }

  const unmappedT = Array.from(result.unmappedTypes.entries());
  const unmappedM = Array.from(result.unmappedMaterials.entries());
  if (unmappedT.length || unmappedM.length) {
    L.push('');
    L.push('UNMAPPED — left untouched. Add these to TYPE_MAP / MATERIAL_MAP in');
    L.push('scripts/validate-bags.js, then re-run.');
    unmappedT.forEach(function (e) { L.push('  type      ' + JSON.stringify(e[0]) + '  x' + e[1]); });
    unmappedM.forEach(function (e) { L.push('  material  ' + JSON.stringify(e[0]) + '  x' + e[1]); });
  }

  L.push('');
  L.push('NOT TOUCHED BY DESIGN');
  L.push('  ' + result.skipped.nullMaterial + ' records with material null — left null on purpose. ' +
    'A null is honest missing data;');
  L.push('    "Unspecified" would disguise it. The literal "null" on the card is an unguarded ' +
    'template in index.html.');
  if (result.skipped.typeRawPresent) {
    L.push('  ' + result.skipped.typeRawPresent + ' records already had typeRaw — original kept, not overwritten.');
  }
  if (result.skipped.materialDetailPresent) {
    L.push('  ' + result.skipped.materialDetailPresent +
      ' records already had materialDetail — original kept, not overwritten.');
  }

  L.push('');
  L.push('SUMMARY: ' + result.changedRecords + ' of ' + meta.total + ' records would change | ' +
    'type ' + result.before.type.size + '->' + result.after.type.size + ' values, ' +
    'material ' + result.before.material.size + '->' + result.after.material.size + ' values | ' +
    (opts.apply ? 'WRITTEN' : 'DRY RUN — no file written'));
  return L.join('\n');
}

/* ========================================================================== */

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write([
      'Usage: node scripts/normalize-taxonomy.js [--apply] [--verbose] [--file PATH]',
      '',
      '  (no flags)  DRY RUN — print the before/after diff table, write nothing',
      '  --apply     rewrite bags.json in place (2-space JSON, key order preserved)',
      '  --verbose   print every affected id instead of the first 6',
      '  --file      operate on a different bags.json',
      '',
      'Always run the dry run first, and run scripts/validate-bags.js after applying.',
      '',
    ].join('\n'));
    return;
  }

  const root = path.resolve(__dirname, '..');
  const bagsPath = opts.file ? path.resolve(process.cwd(), opts.file) : path.join(root, 'bags.json');

  let raw;
  try {
    raw = fs.readFileSync(bagsPath, 'utf8');
  } catch (e) {
    fail('cannot read ' + bagsPath + ' (' + e.message + ')');
  }

  let bags;
  try {
    bags = JSON.parse(raw);
  } catch (e) {
    fail(bagsPath + ' is not valid JSON: ' + e.message);
  }
  if (!Array.isArray(bags)) fail(bagsPath + ' must be a JSON array of bag records.');

  const result = normalize(bags);
  const meta = { file: path.relative(root, bagsPath) || bagsPath, total: bags.length };

  process.stdout.write(report(result, opts, meta) + '\n');

  if (!opts.apply) return;

  if (!result.changedRecords) {
    process.stdout.write('\nNothing to write — bags.json is already normalized.\n');
    return;
  }

  // 2-space JSON with no trailing newline: byte-identical formatting to the
  // existing bags.json, so the diff contains only the changed lines.
  const serialized = JSON.stringify(result.records, null, 2);
  const trailer = /\n$/.test(raw) ? '\n' : '';
  fs.writeFileSync(bagsPath, serialized + trailer, 'utf8');
  process.stdout.write('\nWrote ' + meta.file + ' (' + result.changedRecords + ' records changed).\n');
  process.stdout.write('Next: node scripts/validate-bags.js\n');
}

if (require.main === module) main();

module.exports = { normalize };
