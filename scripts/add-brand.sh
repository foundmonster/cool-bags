#!/bin/sh
# add-brand.sh — scaffold a new brand's staging folder and print the pipeline checklist.
#
# Usage:
#   ./scripts/add-brand.sh "Brand Name" [github-issue-number]
#
# Example:
#   ./scripts/add-brand.sh "Peak Design" 142
#
# Creates:
#   <staging>/<brand-slug>/product-data.json   (stub, correct schema, never overwritten)
#   <staging>/<brand-slug>/ISSUE-NOTES.txt     (where blockers get written down)
#
# <staging> defaults to ../processed-brand-photos relative to the repo root — the
# project folder that holds the repo clone. Override with COOL_BAGS_STAGING.
#
# This script NEVER touches bags.json, images/, or any tracker. Merging into
# bags.json is step 6 below and is a deliberate, reviewed act.
#
# POSIX sh, zero dependencies.

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PROJECT_ROOT=$(CDPATH= cd -- "$REPO_ROOT/.." && pwd)
STAGING_ROOT=${COOL_BAGS_STAGING:-"$PROJECT_ROOT/processed-brand-photos"}

usage() {
  cat <<'USAGE'
Usage: ./scripts/add-brand.sh "Brand Name" [github-issue-number]

  "Brand Name"          required, exactly as it should appear in bags.json
  github-issue-number   optional, recorded in the stub for traceability

  COOL_BAGS_STAGING     optional env var overriding the staging root
USAGE
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  usage >&2
  exit 2
fi

case "$1" in
  -h|--help) usage; exit 0 ;;
esac

BRAND=$1
ISSUE=${2:-}

if [ -z "$(printf '%s' "$BRAND" | tr -d '[:space:]')" ]; then
  echo "add-brand: brand name cannot be blank" >&2
  exit 2
fi

if [ -n "$ISSUE" ]; then
  case "$ISSUE" in
    *[!0-9]*) echo "add-brand: github-issue-number must be digits only, got '$ISSUE'" >&2; exit 2 ;;
  esac
fi

# brand-slug: lowercase, non-alphanumerics collapsed to single hyphens, trimmed.
SLUG=$(printf '%s' "$BRAND" \
  | tr '[:upper:]' '[:lower:]' \
  | sed -e 's/[^a-z0-9]\{1,\}/-/g' -e 's/^-//' -e 's/-$//')

if [ -z "$SLUG" ]; then
  echo "add-brand: brand name '$BRAND' produced an empty slug" >&2
  exit 2
fi

BRAND_DIR="$STAGING_ROOT/$SLUG"
DATA_FILE="$BRAND_DIR/product-data.json"
NOTES_FILE="$BRAND_DIR/ISSUE-NOTES.txt"

mkdir -p "$BRAND_DIR"

# JSON-escape the brand name (backslash and double quote) so an apostrophe or a
# quoted brand name cannot corrupt the stub.
BRAND_JSON=$(printf '%s' "$BRAND" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
if [ -n "$ISSUE" ]; then ISSUE_JSON=$ISSUE; else ISSUE_JSON=null; fi
TODAY=$(date +%Y-%m-%d)

if [ -f "$DATA_FILE" ]; then
  echo "add-brand: $DATA_FILE already exists — left untouched."
else
  cat > "$DATA_FILE" <<JSON
{
  "brand": "$BRAND_JSON",
  "githubIssue": $ISSUE_JSON,
  "sourceUrl": "",
  "extractedAt": "$TODAY",
  "totalProducts": 0,
  "recordTemplate": {
    "brand": "$BRAND_JSON",
    "name": "Exact product name, size in the name if the brand puts it there",
    "price": null,
    "volume": null,
    "weight": null,
    "material": "Primary material, canonical value or a new MATERIAL_MAP entry",
    "type": "Canonical value from TYPE_MAP in scripts/validate-bags.js",
    "description": "",
    "link": "https://brand.com/products/exact-product-page",
    "image": "images/$SLUG-model-name.webp"
  },
  "products": []
}
JSON
  echo "created  $DATA_FILE"
fi

if [ -f "$NOTES_FILE" ]; then
  echo "add-brand: $NOTES_FILE already exists — left untouched."
else
  cat > "$NOTES_FILE" <<NOTES
BRAND:  $BRAND
SLUG:   $SLUG
ISSUE:  ${ISSUE:-none}
OPENED: $TODAY

STATUS: not started

If extraction fails, write down HERE exactly what failed and what was tried:
the URL, the HTTP status, whether the catalog is client-side rendered, whether
a public JSON/API endpoint exists, and what a human would have to do manually.

These notes are the durable output of a failed attempt. Every previous blocked
brand in this project is recoverable only because someone wrote this file.
NOTES
  echo "created  $NOTES_FILE"
fi

echo "staging  $BRAND_DIR"
echo

cat <<STEPS
================================================================================
  PIPELINE — $BRAND  (slug: $SLUG${ISSUE:+, issue #$ISSUE})
================================================================================

  1. Find the brand's product catalog URL. Put it in "sourceUrl" in
     product-data.json. If the site blocks automated access, stop and write
     what happened in ISSUE-NOTES.txt — a documented blocker is a real result.

  2. List every bag model, then apply the Product Selection Rules below to
     decide which listings make the cut. Do this BEFORE downloading anything.

  3. For each selected product, extract the full detail set:
       - exact product name (with size/volume if the brand puts it in the name)
       - base price in USD
       - volume/capacity in liters
       - weight, if published
       - primary material
       - product description
       - product page URL (full URL with domain)
       - main product image URL
     Append each as an object in "products" using "recordTemplate" as the shape.
     Leave a genuinely unknown value null. Never invent one, and never write 0
     as a stand-in for missing — 0 is a lie the filters believe.

  4. Download the main product image per product, build the 800x800 RGBA master,
     then encode to WebP keeping the alpha channel:
       cwebp -q 82 -alpha_q 100 master.png -o $SLUG-<model>.webp
     Name each file $SLUG-<model>.webp — the brand slug prefix is what keeps two
     brands' importers from colliding on the same filename. Encode alpha, never
     a flattened matte: a matte renders as a solid box on the card.

  5. Copy the images into $REPO_ROOT/images/. Every file there is 800x800 WebP
     with an alpha channel.

  6. Merge "products" into bags.json. Assign each new record the next id from
     max(existing id) + 1. NEVER renumber an existing record: ids are the pin
     and share-link key, and renumbering silently breaks every URL a user saved.

  7. node scripts/validate-bags.js
     This is the gate. It must exit 0 before the branch merges.

  8. If validate-bags reports an unknown type or material, add the raw -> canonical
     entry to TYPE_MAP / MATERIAL_MAP at the top of scripts/validate-bags.js, then:
       node scripts/normalize-taxonomy.js            # dry run, read the diff
       node scripts/normalize-taxonomy.js --apply    # only once the diff looks right

  9. Update the brand's row in brands.html so the tracker matches bags.json.
     bags.json is the ground truth; every other status number is a claim.

 10. Commit the data, the images and any script change together, then push.
     Netlify deploys from main.

--------------------------------------------------------------------------------
  PRODUCT SELECTION RULES  (from CLAUDE.md — these decide what gets a listing)
--------------------------------------------------------------------------------

  ONE bag per model/style. Material and color variations of the same model do
  NOT each get their own listing.

    EXCEPTION 1 — Dyneema variants ARE a separate listing.
    EXCEPTION 2 — Different SIZES are different products (e.g. Dopp Kit
                  Small / Large / Utility each get their own record).

  When one model comes in several materials or colors, pick exactly ONE using
  the first option available from this tier list:

    1. Dyneema, any color          - always the first choice
    2. Black Cordura, or the black version of whatever the material is
    3. The darkest available color in the primary material
    4. Any other variant, if none of the above exist

  So GORUCK's GR1 in Cordura / Dyneema / X-Pac / Waxed Canvas yields the Dyneema
  listing plus one non-Dyneema listing chosen by tiers 2-4 — not four records.

--------------------------------------------------------------------------------
  This script did not touch bags.json, images/, or brands.html. Steps 5, 6 and 9
  are yours to do deliberately.
--------------------------------------------------------------------------------
STEPS
