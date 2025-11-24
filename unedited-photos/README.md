# Unedited Photos - Complete Brand Collection

**Total Brands:** 98
**Estimated Total Bags:** 350+
**Current Database:** 25 brands, 226 bags

## Folder Structure

98 brand subfolders containing original, unprocessed product images downloaded from brand websites.

## Brand Categories

### Tier 1: High-Impact Brands (90+ bags)
- **bellroy** (20 bags) - Premium leather goods
- **tomtoc** (17 bags) - Tech/sling bags
- **chrome-industries** (15 bags) - Urban cycling
- **tom-bihn** (13 bags) - Quality bags, cult following
- **goruck** (13 bags) - Tactical/EDC
- **cotopaxi** (10 bags) - Sustainable outdoor

### Tier 2: Complete Existing Brands (17+ bags)
- **able-carry** (need 7 more)
- **aer** (need ~6 more)
- **evergoods** (need ~4 more)
- **black-ember** (need 1 more)
- **boundary-supply** (need 1 more)
- **ile-equipment** (need 5 more)
- **minaal** (need 2 more)
- **pakt** (verify completeness)

### Tier 3: Outdoor Specialists (30+ bags)
- **osprey**, **mystery-ranch**, **gregory**, **fjallraven**
- **arcteryx**, **berghaus**, **deuter**, **mountain-hardwear**
- **gossamer-gear**, **ula-equipment**, **zpacks**

### Tier 4: Urban/EDC Brands (50+ bags)
- **alpaka**, **arktype**, **heimplanet**, **matador**
- **nomatic**, **timbuk2**, **topo-designs**, **wandrd**

### Tier 5: Niche/Specialty Brands (150+ bags)
All remaining brands from Notion database

## Processing Workflow

**Phase 1: Download** (current folder)
- Download images from brand websites
- Save to brand-specific folders
- Preserve original filenames and formats
- Target: 350+ bag images

**Phase 2: Isolation**
- Remove backgrounds
- Trim to bag edges
- Convert to PNG with transparency

**Phase 3: Website Format**
- Scale to ~520px max dimension
- Center on 800x800 canvas
- Output to ../images/ folder

## Progress Tracking

Current Status:
- [X] 98 brand folders created
- [ ] Phase 1: Download all images
- [ ] Phase 2: Process to isolate bags
- [ ] Phase 3: Format for website

## Usage

To start downloads for a brand:
```bash
cd <brand-folder>
# Use WebFetch to get image URLs, then:
curl -o <brand>-<product>.jpg "https://image-url"
```

See download-plan.md for detailed extraction workflow.
