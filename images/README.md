# Bag Product Images

This folder contains standardized product images for the Cool Bags database.

## Image Standards

**Format:** PNG with transparent background
**Dimensions:** 800x800px (square canvas, centered)
**Style:** Front-facing, isolated product on transparent background
**Quantity:** 1 image per product
**Bag Fill:** Target 60-65% of canvas (480-520px max dimension)

### Standardization Requirements

All product images must be normalized to **800x800px square canvas** with the bag centered and occupying **~60-65% of the canvas space**.

**Why 800x800?**
- Provides consistent whitespace around all bags
- Allows `object-fit: contain` to work uniformly
- Matches Aer's image format (reference standard)
- Prevents bags from appearing disproportionately large/small

**Why 60-65% fill?**
- Matches EVERGOODS visual style (the reference standard we like)
- Provides breathing room around bags
- Prevents bags from hitting card edges
- Consistent visual weight across all products

**Processing Steps:**
1. Remove any background (if needed): `magick input.png -fuzz 20% -transparent white output.png`
2. Resize to target fill (if needed): `magick input.png -resize 60% input.png`
3. Pad to 800x800 square: `magick input.png -gravity center -background none -extent 800x800 output.png`
4. Verify dimensions: `sips -g pixelWidth -g pixelHeight output.png`
5. Verify fill percentage: `magick output.png -fuzz 10% -trim -format '%wx%h' info:`

**Target Measurements:**
- Canvas: 800x800px (always)
- Bag size (after trim): 480-520px max dimension
- Fill percentage: 60-65% of canvas
- Reference: EVERGOODS Panel Loader = 453x534px ✅ Perfect

**Example:**
```bash
# Complete standardization pipeline with fill optimization
magick original.jpg \
  -background white -alpha remove -alpha off \
  -fuzz 20% -transparent white \
  -resize 60% \
  -gravity center -background none -extent 800x800 \
  final-800x800.png

# Check final bag size
magick final-800x800.png -fuzz 10% -trim -format 'Bag: %wx%h\n' info:
# Target output: ~480-520px on largest dimension
```

## Known Issues & Limitations

### Background Removal Challenge

**Issue:** Some brand websites (e.g., Wexley Japan) provide product images with gray/colored backgrounds instead of transparent or white backgrounds. These images display inconsistently compared to brands with clean backgrounds (e.g., EVERGOODS, Aer).

**Impact:**
- Images with backgrounds appear to "fill" the square grid cell
- Images with transparent backgrounds have natural whitespace
- Inconsistent visual presentation across brands

**Solution Applied (November 18, 2025):**
Successfully used ImageMagick to remove gray backgrounds from Wexley images:
```bash
magick input.png -fuzz 15% -transparent "#D3D3D3" output.png
```

**Process:**
1. Installed ImageMagick: `brew install imagemagick`
2. Identified gray background color: `#D3D3D3`
3. Applied transparency with 15% fuzz tolerance
4. All 5 Wexley images converted from JPEG-in-PNG to true RGBA PNG with transparency

**Previous Attempted Solutions:**
1. **CSS `object-fit: contain`** - Preserves aspect ratio but doesn't remove backgrounds
2. **sips conversion** - macOS tool can convert formats but cannot remove backgrounds
3. **Automated background removal** - Requires tools:
   - `rembg` (Python) - Blocked by pip proxy restrictions (requires ML models)
   - `ImageMagick` - ✅ Successfully installed and used
   - Online APIs (remove.bg) - Requires API keys or manual upload

**Ghostscript Note:**
- ImageMagick works fine without Ghostscript for background removal
- Ghostscript only needed for PDF/PostScript operations
- If Ghostscript installation is blocked (proxy/security), can skip it

**Future Automation:**
When processing images from brands with backgrounds:
```bash
# Detect and remove gray backgrounds
magick input.jpg -fuzz 15% -transparent gray output.png

# Or for specific gray shades
magick input.jpg -fuzz 15% -transparent "#D3D3D3" output.png
```

**Recommendation for automation workflow:**
- When extracting images via Claude API or bookmarklet, check background color
- If not transparent/white, apply ImageMagick background removal
- Test with various `-fuzz` percentages (10-20%) for best results
- Can automate: `for file in *.png; do magick "$file" -fuzz 15% -transparent gray "${file%.png}-clean.png"; done`

---

## Naming Convention

Images follow this naming pattern:
```
{brand}-{model}-{size}.png
```

### Examples:
- `evergoods-civic-panel-loader-24l.png`
- `wexley-stem-20l-daypack.png`
- `aer-travel-pack-3.png`

### Rules:
1. **Brand**: Lowercase, hyphenated (e.g., `evergoods`, `wexley`, `aer`)
2. **Model**: Lowercase, hyphenated, descriptive (e.g., `civic-panel-loader`, `travel-pack-3`)
3. **Size**: Include capacity if available (e.g., `24l`, `30l`)
4. **Extension**: Always `.png`

### Special Cases:
- If no size is specified: Use version number or omit (e.g., `aer-go-pack-2.png`)
- Multi-word brand names: Hyphenate (e.g., `mystery-ranch`)
- Numbers in model names: Keep as-is (e.g., `travel-pack-3`)

## Current Inventory

### Evergoods (6 images)
- civic-bookbag-22l.png
- civic-half-zip-22l.png
- civic-panel-loader-24l.png
- civic-travel-bag-35l.png
- element-weathershed-22l.png
- mountain-panel-loader-22l.png

### Wexley Japan (5 images)
- ace-32l-travel-pack.png
- active-25l-pro-pack.png
- classic-22l-daypack.png
- stem-20l-daypack.png
- vernon-30l-travel-pack.png

### Aer (5 images)
- city-pack-pro-2.png
- day-pack-3.png
- go-pack-2.png
- pro-pack-20l.png
- travel-pack-3.png

**Total Images:** 16

## Processing Pipeline

1. **Download**: Fetch original product image from brand website
2. **Convert**: Convert to PNG format (if needed)
3. **Resize**: Scale to max 800x800px (preserving aspect ratio)
4. **Rename**: Apply naming convention
5. **Cleanup**: Remove original files

### Tools Used:
- `curl` - Download images from URLs
- `sips` - macOS image processing (resize, convert)
- Bash scripts - Batch processing

## Future Considerations

- Add image quality checks (resolution, background color)
- Implement automatic background removal for non-white backgrounds
- Create thumbnail versions (e.g., 200x200px for grid views)
- Add image metadata (dimensions, file size, source URL)
