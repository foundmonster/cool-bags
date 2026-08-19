# Cool Bags

A searchable database of backpacks, duffels, slings, and accessories from top bag brands.

Live at [coolbags.info](https://coolbags.info) — **596 bags across 43 brands**.

## Features
- Browse the full catalog with product images
- Search by brand, name, material, or type (`/` focuses the search box)
- Filter by brand, material, and type
- Sort by price, size, name, or recency
- Pin favorites to compare, and share a pinned list via URL
- Submit feedback and brand requests (creates a GitHub issue)

## Technology Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript — no framework, no build step
- **Hosting:** Netlify
- **Data:** `bags.json`, a single JSON file serving as the database
- **Images:** WebP, 800×800 with transparency, in `images/`
- **Functions:** Netlify Serverless Functions
- **APIs:** GitHub API (feedback), Mailgun (request confirmations), Buttondown (brand-live emails)

## Local Development

```bash
# Install dependencies
npm install

# Run local Netlify dev server
npm run dev
```

Visit `http://localhost:8888` to preview the site with Netlify Functions support.

For a quick preview without functions, any static server works:
`python3 -m http.server 8000`

## Working on the data

`bags.json` has a validation gate. Run it before merging any change to the catalog:

```bash
node scripts/validate-bags.js          # exits 1 on any error
node scripts/validate-bags.js --quiet  # summary line only
```

See [scripts/README.md](scripts/README.md) for the full tooling: `add-brand.sh` scaffolds a new
brand, and `normalize-taxonomy.js` keeps the `type` and `material` vocabularies canonical.

Brand status is tracked in **GitHub Issues**, not in a file — one issue per brand, closed when it
ships.

## Deployment

Deployed on Netlify with automatic deployments from the `main` branch.

See [DEPLOYMENT.md](DEPLOYMENT.md) for environment variables and setup, and
[WORKFLOW.md](WORKFLOW.md) for the branch and release process.

## Links

- **GitHub:** https://github.com/foundmonster/cool-bags
- **Issues:** https://github.com/foundmonster/cool-bags/issues

---

Built with vanilla HTML, CSS, and JavaScript.
