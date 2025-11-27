# Database Maintenance: Dead Link Detection and Monitoring

## Summary
10 bags in the database (4.6%) have broken product links pointing to discontinued items.

## Current Status
- **Total bags:** 216
- **Working links:** 206 (95.4%)
- **Broken links:** 10 (4.6%)
- **Visual indicator:** ✅ Implemented (red "LINK ISSUE" badge)

## Affected Products

### Black Mile (1)
- Covert Laptop Case

### DSPTCH (2)
- Unit Sling Bag (RND Edition)
- Cinch Tote

### Tortuga (1)
- Travel Backpack Pro 40L

### Boundary Supply (2)
- Rennen Pro X-Pac
- Prima System X-Pac

### Black Ember (3)
- Citadel R3 20L
- Forge 30
- Grip-Sling 9L

### Meret (1)
- DELTA24

## Recent Fixes (Nov 27, 2025)
Fixed 12 of 22 originally broken links (55% recovery):
- **Wexley (5):** URL structure change
- **EVERGOODS (1):** Simplified URLs
- **Pakt (3):** URL simplification
- **DSPTCH (1):** Collection path update
- **Meret (1):** Product page update

## Design Decision
Keeping discontinued products in database with visual warning because:
- Provides historical reference
- Enables product comparison
- Users can still see specs/pricing
- Badge clearly indicates link won't work

## Maintenance Tasks
- [ ] Periodic link health checks (quarterly?)
- [ ] Add `lastVerified` date field to JSON schema
- [ ] Consider reaching out to brands about discontinued products
- [ ] Track URL pattern changes for future fixes

## Technical Details
- Visual indicator: CSS + JS implementation with random rotation
- JSON flag: `linkIssue: true` triggers red badge
- Scan method: Python urllib HTTP status checks

---

**Labels:** `maintenance`, `database`
**Status:** Move to "In Progress" column
