#!/usr/bin/env node
'use strict';

/**
 * validate-bags.js — the pre-merge gate for bags.json
 *
 * Usage:
 *   node scripts/validate-bags.js            # human-readable grouped report
 *   node scripts/validate-bags.js --quiet    # summary line only
 *   node scripts/validate-bags.js --json     # machine-readable output
 *   node scripts/validate-bags.js --file path/to/bags.json
 *
 * Exit code 0 = no ERRORS (warnings may still be present).
 * Exit code 1 = at least one ERROR. Never merge a branch that exits 1.
 * Exit code 2 = the validator itself could not run (bad path, unparsable JSON).
 *
 * Zero dependencies. CommonJS. Node >= 14.
 */

const fs = require('fs');
const path = require('path');

/* ==========================================================================
 * CANONICAL VOCABULARIES — THE SINGLE PLACE TO EDIT THEM
 * ==========================================================================
 * These two maps are the project's taxonomy of record. Both this validator
 * and scripts/normalize-taxonomy.js read them from here; do not duplicate
 * them anywhere else.
 *
 * Format: "raw value as it appears in bags.json" -> "canonical value".
 * A raw value that maps to itself is already canonical.
 *
 * To add a new type or material:
 *   1. Add the raw -> canonical entry below.
 *   2. Re-run this validator (the unknown-type / unknown-material warning
 *      is what tells you an entry is missing).
 *   3. Run `node scripts/normalize-taxonomy.js` (dry run) to see the effect
 *      before applying it.
 *
 * Both maps were derived from a full audit of all 611 records and are TOTAL
 * over the values currently present in bags.json — the validator reporting
 * 0 unknown types and 0 unknown materials is the proof of that.
 * ========================================================================== */

const TYPE_MAP = {
  'Backpack': 'Backpack',
  'Hydration Pack': 'Backpack',
  'Bag': 'Unclassified',
  'Sling': 'Sling',
  'Tote': 'Tote',
  'Totepack': 'Tote',
  'Duffel': 'Duffel',
  'Duffle': 'Duffel',
  'Pouch': 'Pouch',
  'Shoulder Pocket': 'Pouch',
  'Messenger': 'Messenger',
  'Messenger Bag': 'Messenger',
  'Packing Cube': 'Packing Cube',
  'Crossbody': 'Shoulder Bag',
  'Satchel': 'Shoulder Bag',
  'Shoulder': 'Shoulder Bag',
  'Shoulder Bag': 'Shoulder Bag',
  'Toiletry': 'Toiletry Kit',
  'Toiletry Bag': 'Toiletry Kit',
  'Laptop Sleeve': 'Case',
  'Case': 'Case',
  'Tech Case': 'Case',
  'Camera Bag': 'Camera Bag',
  'Camera Insert': 'Camera Bag',
  'Brief': 'Briefcase',
  'Briefcase': 'Briefcase',
  'Document Bag': 'Specialty',
  'Response Bag': 'Specialty',
  'Oxygen Bag': 'Specialty',
  'Accessory': 'Specialty',
  'Roller': 'Specialty',
};

const MATERIAL_MAP = {
  'Nylon': 'Nylon',
  'Ballistic Nylon': 'Nylon',
  'Micro ripstop nylon': 'Nylon',
  'Axoflux 210D': 'Nylon',
  'Axoflux 300D': 'Nylon',
  'Axoflux 400D Ripstop Nylon': 'Nylon',
  'Axoflux 400D Washed Nylon': 'Nylon',
  'Cordura': 'Cordura',
  'Cordura RN66 Velocity': 'Cordura',
  'X-Pac': 'X-Pac',
  'VX21': 'X-Pac',
  'UX10': 'X-Pac',
  'Axogrid 300D / X-Pac VX42': 'X-Pac',
  'Axoflux 210D / X-Pac VX42': 'X-Pac',
  'Axoflux 300D / X-Pac VX42': 'X-Pac',
  'Axoflux 600D / X-Pac VX21': 'X-Pac',
  'Axoflux 600D / X-Pac VX42': 'X-Pac',
  'Axoflux 600D / X-Pac RX36': 'X-Pac',
  'X-Pac VX21 / X-Pac VX25': 'X-Pac',
  'Coated polyester': 'Polyester',
  'Recycled polyester': 'Polyester',
  'Polyester': 'Polyester',
  'Dyneema': 'Dyneema',
  'ECOPAK': 'ECOPAK',
  'EPX 200': 'ECOPAK',
  'Ultra': 'Ultra',
  'Embertex PFAS Free': 'Embertex',
  'Vegan Leather': 'Vegan Leather',
  // Real leather, added 2026-08-30 for Troubadour's calfskin line. Before this
  // the only leather value was `Vegan Leather`, so a calfskin bag had to be
  // filed as `Unspecified` — a lie by omission, and one that would recur with
  // every leather brand. Keep the two distinct: they are different materials
  // and a shopper filtering for one does not want the other.
  'Leather': 'Leather',
  'Full-grain leather': 'Leather',
  'Calfskin': 'Leather',
  'Cotton': 'Cotton',
  'Cotton canvas': 'Cotton',
  'Mesh': 'Mesh',
  // Not materials at all — properties recorded in the material field.
  // They pass validation but need real fabric research.
  'Technical': 'Unspecified',
  'Weatherproof': 'Unspecified',
  'Waterproof': 'Unspecified',
};

/* ========================================================================== */

const REQUIRED_FIELDS = ['id', 'brand', 'name', 'type', 'link', 'image'];

// Characters that terminate or corrupt a value interpolated into an inline
// HTML attribute, e.g. onclick="fn('${bag.name}')" in index.html.
const ATTR_BREAKING = /["'<>&]/;

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|svg|avif)$/i;

const MAX_IDS_SHOWN = 15;

/* ========================================================================== */

function parseArgs(argv) {
  const opts = { json: false, quiet: false, file: null, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--all') opts.all = true;
    // --file must carry a path. A bare trailing `--file`, or `--file=`, used to
    // leave opts.file falsy and silently fall back to the repo's own bags.json —
    // the opposite of what the operator asked for.
    else if (a === '--file') {
      opts.file = argv[++i];
      if (opts.file === undefined || opts.file === '') {
        process.stderr.write('validate-bags: --file requires a path\n');
        process.exit(2);
      }
    }
    else if (a.startsWith('--file=')) {
      opts.file = a.slice(7);
      if (opts.file === '') {
        process.stderr.write('validate-bags: --file requires a path\n');
        process.exit(2);
      }
    }
    else if (a === '--help' || a === '-h') opts.help = true;
    else {
      process.stderr.write('validate-bags: unknown option ' + a + '\n');
      process.exit(2);
    }
  }
  return opts;
}

function fail(msg) {
  process.stderr.write('validate-bags: ' + msg + '\n');
  process.exit(2);
}

function isBlank(v) {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function isPositiveNumber(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function label(rec) {
  return (rec.brand || '?') + ' — ' + (rec.name || '?');
}

/* ========================================================================== */

function validate(bags, ctx) {
  const issues = [];

  function add(severity, code, title, items, fix, unit) {
    if (!items.length) return;
    issues.push({
      severity: severity,
      code: code,
      title: title,
      count: items.length,
      unit: unit || 'record',
      items: items,
      fix: fix || null,
    });
  }

  /* ---------- ERRORS ---------- */

  // E1 — missing or blank required field
  const missingRequired = [];
  bags.forEach(function (rec, i) {
    const missing = REQUIRED_FIELDS.filter(function (f) { return isBlank(rec[f]); });
    if (missing.length) {
      missingRequired.push({
        id: rec.id === undefined ? null : rec.id,
        label: label(rec),
        detail: 'index ' + i + ': blank ' + missing.join(', '),
      });
    }
  });
  add('error', 'missing-required-field',
    'Missing or blank required field (' + REQUIRED_FIELDS.join(', ') + ')',
    missingRequired, 'Fill the field in bags.json, or drop the record.');

  // E2 — duplicate id
  const byId = new Map();
  bags.forEach(function (rec) {
    const k = String(rec.id);
    if (!byId.has(k)) byId.set(k, []);
    byId.get(k).push(rec);
  });
  const dupIds = [];
  byId.forEach(function (recs, k) {
    if (recs.length > 1) {
      dupIds.push({ id: recs[0].id, label: 'id ' + k + ' used by ' + recs.length + ' records',
        detail: recs.map(label).join(' | ') });
    }
  });
  add('error', 'duplicate-id', 'Duplicate id', dupIds,
    'ids are the pin/share key. Never renumber existing records — give the newcomer max(id)+1.');

  // E3 — duplicate brand + name (case-insensitive, trimmed)
  const byName = new Map();
  bags.forEach(function (rec) {
    const k = String(rec.brand || '').trim().toLowerCase() + '\u0000' +
              String(rec.name || '').trim().toLowerCase();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(rec);
  });
  const dupNames = [];
  byName.forEach(function (recs) {
    if (recs.length > 1) {
      recs.forEach(function (rec) {
        dupNames.push({ id: rec.id, label: label(rec),
          detail: 'shares brand+name with ids ' +
            recs.filter(function (r) { return r !== rec; }).map(function (r) { return r.id; }).join(', ') });
      });
    }
  });
  add('error', 'duplicate-brand-name', 'Duplicate brand + name', dupNames,
    'Either a bad re-import (keep the record with more non-null fields) or genuine size ' +
    'variants that need the size in the name — size variants are separate products.');

  // E4 — referenced image not present on disk
  const missingImages = [];
  bags.forEach(function (rec) {
    if (isBlank(rec.image)) return; // already reported by E1
    if (!ctx.imageExists(rec.image)) {
      missingImages.push({ id: rec.id, label: label(rec), detail: rec.image });
    }
  });
  add('error', 'image-not-on-disk', 'Referenced image file is not present in images/', missingImages,
    'Add the file to images/ (do not delete the record). Convention: brand-slug-model.webp');

  // E5 — non-https link
  const badScheme = [];
  bags.forEach(function (rec) {
    if (isBlank(rec.link)) return;
    if (!/^https:\/\//.test(String(rec.link).trim()) || String(rec.link) !== String(rec.link).trim()) {
      badScheme.push({ id: rec.id, label: label(rec), detail: JSON.stringify(rec.link) });
    }
  });
  add('error', 'non-https-link', 'Link is not a clean https:// URL', badScheme,
    'Rewrite to the canonical https product URL with no surrounding whitespace.');

  // E6 — character that breaks an inline HTML attribute
  const attrBreaking = [];
  bags.forEach(function (rec) {
    ['brand', 'name'].forEach(function (f) {
      const v = rec[f];
      if (typeof v === 'string' && ATTR_BREAKING.test(v)) {
        attrBreaking.push({ id: rec.id, label: label(rec),
          detail: f + ' = ' + JSON.stringify(v) });
      }
    });
  });
  add('warning', 'html-attribute-breaking-character',
    'brand/name contains a character that breaks an inline HTML attribute (" \' < > &)',
    attrBreaking,
    'Downgraded from error to warning 2026-08-14: index.html now escapes every interpolated value ' +
    'at the render site (escapeHtmlAttr/escapeJsAttr), so these are safe to render today and the ' +
    'values themselves are correct — the brands really do name these bags 13". Kept as a warning ' +
    'because the safety depends on that escaping staying in place; if the render path is ever ' +
    'rewritten, check these records first. Never "fix" this by mangling a correct product name.');

  // E7/E8 — price / volume present but not a positive number
  const badPrice = [];
  const badVolume = [];
  bags.forEach(function (rec) {
    if (rec.price !== null && rec.price !== undefined && !isPositiveNumber(rec.price)) {
      badPrice.push({ id: rec.id, label: label(rec),
        detail: 'price = ' + JSON.stringify(rec.price) + ' (' + typeof rec.price + ')' });
    }
    if (rec.volume !== null && rec.volume !== undefined && !isPositiveNumber(rec.volume)) {
      badVolume.push({ id: rec.id, label: label(rec),
        detail: 'volume = ' + JSON.stringify(rec.volume) + ' (' + typeof rec.volume + ')' });
    }
  });
  add('error', 'price-not-positive-number', 'price is present but not a positive number', badPrice,
    'Store price as a number or null. Never a string, never 0.');
  add('error', 'volume-not-positive-number', 'volume is present but not a positive number', badVolume,
    'Approximations like "~35" must be stored as the number 35 plus volumeApprox: true — ' +
    'index.html sorts with (a.volume - b.volume), which is NaN for a string.');

  /* ---------- WARNINGS ---------- */

  function nullField(field, code, title, fix) {
    const items = [];
    bags.forEach(function (rec) {
      if (rec[field] === null || rec[field] === undefined) {
        items.push({ id: rec.id, label: label(rec), detail: field + ' is null' });
      }
    });
    add('warning', code, title, items, fix);
  }

  nullField('price', 'null-price', 'price is null',
    'index.html interpolates `$${bag.price}` unguarded, so these render the literal "$null". ' +
    'Guard the template AND re-scrape the real price.');
  nullField('volume', 'null-volume', 'volume is null',
    'index.html interpolates `${bag.volume}L`, so these render "nullL". ' +
    'Suppress the stat when volume is null AND re-scrape the value.');
  nullField('weight', 'null-weight', 'weight is null',
    'weight is not rendered anywhere in index.html today, so this is invisible on the live site — ' +
    'but the field is unusable for filtering until it is populated.');
  nullField('material', 'null-material', 'material is null',
    'index.html interpolates `${bag.material}` unguarded, so these render the literal word "null".');

  // W — weight stored as 0 (a sentinel, not a measurement)
  const zeroWeight = [];
  bags.forEach(function (rec) {
    if (rec.weight === 0) zeroWeight.push({ id: rec.id, label: label(rec), detail: 'weight = 0' });
  });
  add('warning', 'zero-weight-placeholder', 'weight stored as 0 rather than null', zeroWeight,
    'No bag weighs 0. Rewrite to null so the missing-data count is honest and a future ' +
    'min/max weight filter is not anchored at 0.');

  // W — empty description
  const emptyDesc = [];
  bags.forEach(function (rec) {
    if (typeof rec.description === 'string' && rec.description.trim() === '') {
      emptyDesc.push({ id: rec.id, label: label(rec), detail: 'description is ""' });
    } else if (rec.description === null || rec.description === undefined) {
      emptyDesc.push({ id: rec.id, label: label(rec), detail: 'description is null' });
    }
  });
  add('warning', 'empty-description', 'description is empty', emptyDesc,
    'Note description is not rendered anywhere in index.html today — decide whether the field ' +
    'is being surfaced at all before spending research time here.');

  // W — type / material outside the canonical vocabulary
  const unknownTypes = [];
  const canonicalTypes = new Set(Object.keys(TYPE_MAP).concat(Object.values(TYPE_MAP)));
  bags.forEach(function (rec) {
    if (isBlank(rec.type)) return; // E1 covers it
    if (!canonicalTypes.has(rec.type)) {
      unknownTypes.push({ id: rec.id, label: label(rec), detail: 'type = ' + JSON.stringify(rec.type) });
    }
  });
  add('warning', 'type-not-in-canonical-vocabulary',
    'type is not in the canonical vocabulary', unknownTypes,
    'Add the raw -> canonical entry to TYPE_MAP at the top of scripts/validate-bags.js, ' +
    'then re-run normalize-taxonomy.js.');

  const unknownMaterials = [];
  const canonicalMaterials = new Set(
    Object.keys(MATERIAL_MAP).concat(Object.values(MATERIAL_MAP)).concat(['Unspecified']));
  bags.forEach(function (rec) {
    if (rec.material === null || rec.material === undefined) return; // null-material warning covers it
    if (!canonicalMaterials.has(rec.material)) {
      unknownMaterials.push({ id: rec.id, label: label(rec),
        detail: 'material = ' + JSON.stringify(rec.material) });
    }
  });
  add('warning', 'material-not-in-canonical-vocabulary',
    'material is not in the canonical vocabulary', unknownMaterials,
    'Add the raw -> canonical entry to MATERIAL_MAP at the top of scripts/validate-bags.js. ' +
    'The raw string is preserved on normalize, so proprietary fabric codes are safe to add.');

  // W — two or more records sharing a link
  const byLink = new Map();
  bags.forEach(function (rec) {
    const k = String(rec.link || '');
    if (!byLink.has(k)) byLink.set(k, []);
    byLink.get(k).push(rec);
  });
  const sharedLinks = [];
  let sharedLinkUrlCount = 0;
  byLink.forEach(function (recs, url) {
    if (recs.length > 1) {
      sharedLinkUrlCount++;
      recs.forEach(function (rec) {
        sharedLinks.push({ id: rec.id, label: label(rec),
          detail: url + '  (shared by ids ' + recs.map(function (r) { return r.id; }).join(', ') + ')' });
      });
    }
  });
  add('warning', 'shared-link-url',
    'Two or more records point at the same URL (' + sharedLinkUrlCount + ' distinct URLs)',
    sharedLinks,
    'Three causes, three treatments: legitimate size/colorway variants under one product page ' +
    '(KEEP), duplicate re-imports (dedupe), and genuinely wrong links (research the real URL).');

  // W — orphan image files on disk
  const orphans = ctx.orphanImages().map(function (f) {
    return { id: null, label: 'images/' + f, detail: 'no record references this file' };
  });
  add('warning', 'orphan-image-file', 'Image file on disk referenced by no record', orphans,
    'These are leads for records to ADD, not junk to delete. A whole brand of orphans means ' +
    'images were staged but the records never shipped.', 'file');

  return issues;
}

/* ========================================================================== */

function render(result, opts) {
  const lines = [];
  const errors = result.issues.filter(function (i) { return i.severity === 'error'; });
  const warnings = result.issues.filter(function (i) { return i.severity === 'warning'; });

  function block(title, list) {
    if (!list.length) return;
    lines.push('');
    lines.push(title);
    lines.push('='.repeat(title.length));
    list.forEach(function (issue) {
      lines.push('');
      lines.push('  [' + issue.code + ']  ' + issue.count + ' ' + issue.unit +
        (issue.count === 1 ? '' : 's'));
      lines.push('  ' + issue.title);
      const withIds = issue.items.filter(function (it) { return it.id !== null; });
      if (withIds.length) {
        const ids = withIds.map(function (it) { return it.id; });
        const shown = opts.all ? ids : ids.slice(0, MAX_IDS_SHOWN);
        lines.push('    ids: ' + shown.join(', ') +
          (ids.length > shown.length ? '  … +' + (ids.length - shown.length) + ' more (--all, --json)' : ''));
      }
      const examples = issue.items.slice(0, 3);
      examples.forEach(function (it) {
        lines.push('    · ' + (it.id !== null ? '#' + it.id + ' ' : '') + it.label +
          (it.detail ? '  —  ' + it.detail : ''));
      });
      if (issue.items.length > examples.length) {
        lines.push('    · … ' + (issue.items.length - examples.length) + ' more');
      }
      if (issue.fix) lines.push('    fix: ' + issue.fix);
    });
  }

  lines.push('validate-bags — ' + result.file);
  lines.push(result.totalRecords + ' records, ' + result.totalBrands + ' brands, ' +
    result.imageFilesOnDisk + ' image files on disk');

  block('ERRORS (block the merge)', errors);
  block('WARNINGS (data quality, do not block)', warnings);

  if (!errors.length && !warnings.length) {
    lines.push('');
    lines.push('  Clean — no errors, no warnings.');
  }
  lines.push('');
  return lines.join('\n');
}

function summaryLine(result) {
  const errors = result.issues.filter(function (i) { return i.severity === 'error'; });
  const warnings = result.issues.filter(function (i) { return i.severity === 'warning'; });
  const errRecords = errors.reduce(function (n, i) { return n + i.count; }, 0);
  const warnRecords = warnings.reduce(function (n, i) { return n + i.count; }, 0);
  return 'SUMMARY: ' + result.totalRecords + ' records / ' + result.totalBrands + ' brands | ' +
    errRecords + ' error findings across ' + errors.length + ' failing checks | ' +
    warnRecords + ' warning findings across ' + warnings.length + ' checks | ' +
    (errRecords ? 'FAIL' : 'PASS');
}

/* ========================================================================== */

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.help) {
    process.stdout.write([
      'Usage: node scripts/validate-bags.js [--json] [--quiet] [--all] [--file PATH]',
      '',
      '  --json    machine-readable output',
      '  --quiet   print only the summary line',
      '  --all     print every offending id instead of the first ' + MAX_IDS_SHOWN,
      '  --file    validate a different bags.json',
      '',
      'Exit 1 when any ERROR is found. Exit 2 when the validator cannot run.',
      '',
    ].join('\n'));
    return;
  }

  const root = path.resolve(__dirname, '..');
  const bagsPath = opts.file ? path.resolve(process.cwd(), opts.file) : path.join(root, 'bags.json');
  const imagesDir = path.join(root, 'images');

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

  // Image index — built once, case-sensitive, independent of the filesystem's
  // own case folding (macOS would otherwise mask a casing typo that breaks Netlify).
  let dirEntries = [];
  try {
    dirEntries = fs.readdirSync(imagesDir);
  } catch (e) {
    fail('cannot read ' + imagesDir + ' (' + e.message + ')');
  }
  const imageFiles = dirEntries.filter(function (f) { return IMAGE_EXT.test(f); });
  const imageSet = new Set(imageFiles);
  const referenced = new Set();

  const ctx = {
    imageExists: function (rel) {
      const p = String(rel);
      referenced.add(p);
      const parts = p.split('/');
      if (parts.length === 2 && parts[0] === 'images') return imageSet.has(parts[1]);
      return fs.existsSync(path.join(root, p));
    },
    orphanImages: function () {
      return imageFiles.filter(function (f) { return !referenced.has('images/' + f); });
    },
  };

  const issues = validate(bags, ctx);

  const result = {
    file: path.relative(root, bagsPath) || bagsPath,
    totalRecords: bags.length,
    totalBrands: new Set(bags.map(function (b) { return b.brand; })).size,
    imageFilesOnDisk: imageFiles.length,
    imagesReferenced: referenced.size,
    issues: issues,
  };
  result.summary = summaryLine(result);
  const hasErrors = issues.some(function (i) { return i.severity === 'error'; });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else if (opts.quiet) {
    process.stdout.write(result.summary + '\n');
  } else {
    process.stdout.write(render(result, opts) + '\n');
    process.stdout.write(result.summary + '\n');
  }

  // Set exitCode rather than calling process.exit() — process.exit() truncates
  // stdout when it is a pipe, which silently corrupts --json output.
  process.exitCode = hasErrors ? 1 : 0;
}

if (require.main === module) main();

module.exports = { TYPE_MAP, MATERIAL_MAP, REQUIRED_FIELDS, validate };
