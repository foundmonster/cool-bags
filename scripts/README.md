# scripts/

Pipeline tooling for the Cool Bags catalog. Node, **zero dependencies**, plain
CommonJS. Run everything from the repo root.

```
node scripts/validate-bags.js        # the gate — run before every merge
node scripts/normalize-taxonomy.js   # dry run of the type/material collapse
./scripts/add-brand.sh "Brand Name"  # scaffold a new brand's staging folder
```

---

## These scripts are committed. They are never gitignored.

The previous generation of this tooling — `sync-brands.sh`, `link-checker.js`,
`BRAND-SYNC.md`, `WORKFLOW.md`, `DEPLOYMENT.md`, the brand-tracking CSVs — was
listed in `.gitignore`, never committed, and is **gone from every copy of this
project**. Reconstructing it cost a full session. The rule that follows from
that:

> Anything in `scripts/` is version-controlled. Do not add `scripts/`, or any
> file inside it, to `.gitignore`. If a script needs a secret, the secret goes
> in `.env` (already ignored) — the script itself still gets committed.

Before adding any ignore rule, check it does not swallow this directory:

```sh
git check-ignore -v scripts/*        # must print nothing
```

---

## validate-bags.js — the pre-merge gate

Reads `bags.json`, cross-checks it against `images/`, and reports every defect
grouped by severity.

```sh
node scripts/validate-bags.js            # full grouped report
node scripts/validate-bags.js --quiet    # summary line only
node scripts/validate-bags.js --json     # machine-readable
node scripts/validate-bags.js --all      # print every offending id, not the first 15
node scripts/validate-bags.js --file path/to/other-bags.json
```

**Exit codes**

| Code | Meaning |
|------|---------|
| `0`  | No errors. Warnings may still be present. Safe to merge. |
| `1`  | At least one ERROR. **Do not merge.** |
| `2`  | The validator could not run (bad path, unparsable JSON, missing `images/`). |

### What the gate enforces (ERRORS — these block the merge)

| Check | Rule |
|---|---|
| `missing-required-field` | `id`, `brand`, `name`, `type`, `link`, `image` must all be present and non-blank. |
| `duplicate-id` | Every `id` is unique. ids are the pin/share key — never reuse, never renumber. |
| `duplicate-brand-name` | No two records share `brand` + `name` (case-insensitive, trimmed). |
| `image-not-on-disk` | Every referenced image exists in `images/`, matched case-sensitively. |
| `non-https-link` | Every `link` is a clean `https://` URL with no surrounding whitespace. |
| `html-attribute-breaking-character` | No `"` `'` `<` `>` `&` in `brand` or `name`. `index.html` interpolates both into a double-quoted `onclick` attribute; these characters terminate it early and break the card. |
| `price-not-positive-number` | If `price` is present it is a positive **number** — never a string, never `0`. |
| `volume-not-positive-number` | Same for `volume`. `"~35"` sorts as `NaN` in `index.html`; store `35` plus `volumeApprox: true`. |

### What it flags but tolerates (WARNINGS — merge, then work the queue)

`null-price` · `null-volume` · `null-weight` · `null-material` ·
`zero-weight-placeholder` (weight stored as `0`, a sentinel no bag can have) ·
`empty-description` · `type-not-in-canonical-vocabulary` ·
`material-not-in-canonical-vocabulary` · `shared-link-url` (two records pointing
at one product page) · `orphan-image-file` (an image in `images/` no record
references — a lead for a record to **add**, never a file to delete).

Every warning prints the offending ids and a `fix:` line explaining whether the
fix is mechanical or needs a human to open the product page.

### The canonical vocabularies live here

`TYPE_MAP` and `MATERIAL_MAP` are defined as constants at the top of
`validate-bags.js`, under a banner comment marking them as **the single place to
edit them**. `normalize-taxonomy.js` imports them from that file rather than
keeping its own copy, so the two can never drift.

Each map is `"raw value" -> "canonical value"`. To add a type or material:

1. Add the entry to the map in `validate-bags.js`.
2. Re-run `validate-bags.js` — the `*-not-in-canonical-vocabulary` warning is
   what tells you an entry is missing.
3. Run `normalize-taxonomy.js` (dry run first) to fold the new value in.

---

## normalize-taxonomy.js — collapse the vocabularies, losslessly

```sh
node scripts/normalize-taxonomy.js            # DRY RUN (default) — prints the diff, writes nothing
node scripts/normalize-taxonomy.js --verbose  # dry run + every affected id
node scripts/normalize-taxonomy.js --apply    # writes bags.json in place
```

**It is a dry run unless you pass `--apply`.** The dry run prints a before/after
table — `FROM -> TO`, record count, affected ids — plus the distinct-value count
on each side, so you can see the whole change before any byte is written.

### Lossless by construction

| Field | Becomes | Original preserved in |
|---|---|---|
| `type` | the canonical type | `typeRaw` (only when it changed) |
| `material` | the canonical primary material | `materialDetail` (only when the raw string carried detail beyond the canonical name) |

So `"Axoflux 600D / X-Pac RX36"` becomes `material: "X-Pac"` with
`materialDetail: "Axoflux 600D / X-Pac RX36"`. Most material strings in the file
carry detail like this, and none of it is discarded — the mapping is fully
reversible.

### Clean git diffs

Output is `JSON.stringify(records, null, 2)`, byte-identical in formatting to the
existing `bags.json`. Key order is preserved, and each new key is inserted
directly after the field it annotates (`typeRaw` after `type`,
`materialDetail` after `material`), so the diff shows only the lines that
actually changed.

Re-running after an `--apply` is a no-op: canonical values map to themselves, and
an existing `typeRaw` / `materialDetail` is never overwritten.

### What it deliberately leaves alone

- **`material: null`.** Mapping null to `"Unspecified"` would disguise missing
  data as a real value. The literal `null` showing on a card is an unguarded
  template in `index.html` and belongs fixed there.
- **Everything that is not `type` or `material`.** Deduping, price research,
  volume re-scrapes and wrong-link fixes each need judgement and stay manual.

Always run `validate-bags.js` after an `--apply`.

---

## add-brand.sh — scaffold a new brand

```sh
./scripts/add-brand.sh "Brand Name" [github-issue-number]
./scripts/add-brand.sh "Peak Design" 142
```

Creates `<staging>/<brand-slug>/` containing:

- `product-data.json` — stub with the correct schema: brand, issue number,
  source URL, and a `recordTemplate` showing every field a `bags.json` record
  needs, with an empty `products` array to fill.
- `ISSUE-NOTES.txt` — where a blocked scrape gets documented. Every blocked brand
  in this project is recoverable only because someone wrote this file.

Then it prints the numbered pipeline steps and a summary of the **Product
Selection Rules** from `CLAUDE.md` (one bag per model; Dyneema variants are a
separate listing; size variants are separate products; and the material/color
tier priority Dyneema → black Cordura → darkest color → any).

`<staging>` defaults to `../processed-brand-photos` relative to the repo root.
Override it with `COOL_BAGS_STAGING`.

**It never touches `bags.json`, `images/`, or `brands.html`.** Merging into
`bags.json` is a deliberate, reviewed step. Neither existing file is ever
overwritten — re-running on an existing brand reports and leaves both in place.

Exit `2` on bad usage (missing brand name, non-numeric issue number).

---

## The loop

```
./scripts/add-brand.sh "Brand"     →  research, extract, download images
                                   →  merge into bags.json at max(id)+1
node scripts/normalize-taxonomy.js →  dry run, read the diff, then --apply
node scripts/validate-bags.js      →  must exit 0
                                   →  update brands.html, commit, push
```

`bags.json` is the ground truth for how many bags and brands exist. Every other
number in this project — in `brands.html`, `todo.md`, any `README` — is a claim,
and claims drift. When a tracker disagrees with `bags.json`, the tracker is
wrong.
