# The Extraction Ladder

Given a brand URL, find the **cheapest technique that actually returns product data**, prove it
returned that data, and remember the answer so the next run does not start from zero.

```bash
node scripts/ladder/probe.js https://www.tombihn.com --brand "Tom Bihn" --issue 42
node scripts/ladder/probe.js --status
node scripts/ladder/probe.js --retest-stale
node --test "scripts/ladder/test/*.test.js"
```

Node 22, CommonJS, **stdlib only, zero npm dependencies, no build step.**

---

## The rungs

Try a rung; if it does not yield verified data, fall to the next. Cheapest and most reliable first.

| Rung | Technique | Cost | Typical win |
|---|---|---|---|
| **A** | Plain GET on a product page; read JSON-LD, microdata or a server-rendered spec block | 1 request | Magpul, Deuter, Mystery Ranch |
| **B** | Platform catalog endpoint (`/products.json?limit=250`) — one request, whole catalog | 1 request | 39 of 43 live brands; Tom Bihn returns 155 products |
| **C** | Local headless Chrome `--dump-dom` — read the JS-built DOM | 1 browser launch | Bellroy |
| **D** | Chrome over the DevTools Protocol / Playwright — interaction: size selectors, lazy load | many | Arc'teryx |
| **STOP** | `robots.txt` opt-out or terms forbid it | 1 request | Berghaus |

**A `STOP` is a successful, final result.** It is recorded with the rule that triggered it, and the
brand is done. Nothing in this tool works around one, and nothing should be added that does.

### Rung D is not implemented

Rungs A, B and C are implemented. Rung D is defined and reserved in the registry vocabulary but has no
code yet — a brand that needs it currently exits 1 (`no-viable-rung`). See *Adding a new rung* below.

### What "viable" means

A rung is **never** reported viable because a fingerprint predicted it. It is viable because it
returned parseable product data, and the bytes are on disk in `.cache/<slug>/raw/` addressed by
sha256. Two gates enforce this:

- **G1 — shape assertion.** The declared content-type must agree with the parsed shape. HTML at a
  `.json` URL is a rung *failure*: drop a rung, log the reason, do not parse.
  `troubadourgoods.com/products.json` returns 490 KB of Next.js HTML with status 200.
- **Identity assertion at rung C.** A render that silently lands elsewhere is the worst failure mode
  here — it returns a real, parseable page *for the wrong product*. The rendered canonical URL must
  match the URL requested.

### The storefront decides the rung, not the commerce backend

`troubadourgoods.com` serves `cdn.shopify.com` images from a Next.js front end. Reading "shopify" off
the image host predicts rung B; rung B there returns 490 KB of HTML. The **front end** wins the
platform label.

---

## The registry — `strategies.json`

Committed, diffable, reviewable. This is the point of the exercise. Written by `lib/strategies.js`,
whose header documents the full schema field by field.

Per brand it records: the winning rung and what it returned; **every** rung attempted and why it
failed (status code, shape mismatch, empty body, timeout); the platform signature; and for a
`do-not-scrape`, the rule that triggered it. Per **platform signature** it records which rung wins,
so a brand nobody has ever probed starts where that signature works.

```
BY WINNING RUNG          PLATFORM PRIORS (where a new brand with this signature starts)
  rung A   1               shopify   start=B  from 2 brand(s)  wins={"B":2}
  rung B   2               unknown   start=A  from 2 brand(s)  wins={"A":1,"C":1}
  rung C   1
  none     1
  do-not-scrape  1
```

### Two rules govern it

**a. Success is sticky but checked.** The next run starts at the recorded winning rung instead of
climbing from scratch. The winner is *always re-run* — it is never skipped on the strength of the
record. If it no longer works the probe falls through the remaining rungs, records the new winner,
and appends a `history` entry naming the change:

```json
{ "at": "…", "from": "B", "to": "A", "note": "rung B stopped working: html-at-json-url" }
```

**b. Failure verdicts expire after 90 days.** *This is the most important rule in the file.*

A rung recorded as failing is skipped only while that record is younger than 90 days. Once it is
older it is **re-tested even though we "know" it fails**, and the re-test is the whole point.

> `BLOCKED-BRANDS.md` was this project's previous memory: a permanent record of failure with no
> expiry. A re-test of 11 of the brands it condemned found **10 reachable**. Five hand over their
> entire catalog to one unauthenticated request — Eastpak 212 products, Demobaza 250, Heimplanet 237,
> Matador 191, Killspencer 123. That is roughly **1,200 products** this project did not have because
> a "no" never expired.
>
> Two of those "blocks" were never the site's doing. Magpul's CSP header alone is 14,519 bytes and
> overflowed Node's default 16 KB `maxHeaderSize` (curl is indifferent) — the fix is the
> `--max-http-header-size=65536` in `probe.js`'s shebang. Eastpak had replatformed to Shopify at
> `us.eastpak.com`, so the old Akamai 403s came from a site that no longer serves the catalog. **The
> tool was broken and the note blamed the brand.**

The cost of the expiry rule is a handful of extra requests per brand per quarter. The cost of not
having it is measured above. Do not raise the window to "save requests" and do not remove it.

Two supporting details exist so the rule cannot be defeated by accident:

- **A skip never re-dates its own record.** If recording a skip re-stamped the attempt, the record
  would never reach the window and the skip would be permanent. A skip is not evidence; only a
  request is. Pinned by a test.
- **An undated failure is stale.** We do not trust a "no" we cannot date.

`--force` bypasses both the HTTP cache *and* the memory skips. Use it whenever the ladder code
changes — yesterday's "this rung fails" was measured by yesterday's checker.

### robots.txt is never cached as a verdict

The recorded `policy` block is **audit only**. `robots.txt` is re-read on every probe. A cached
"blocked" that is trusted without re-asking is exactly how `BLOCKED-BRANDS.md` happened — and
re-reading is the polite thing to do regardless.

---

## Politeness

Not optional, and enforced in `lib/http.js`, the only component permitted to open a socket.

- One honest User-Agent: `coolbags-intake/1.0 (+https://coolbags.info; contact …)`.
- **≥ 2 s between requests to the same host**, one connection per host, strictly serial.
  `Crawl-delay` raises the gap, never lowers it.
- Hard cap of 200 requests per host per process; rung C is capped at 2 browser launches per probe.
  A probe needs a handful of requests, not a crawl.
- Headless Chrome takes a turn in the *same* per-host queue. A browser is not more polite because it
  is a browser.
- Content-addressed cache: a re-run replays from disk and issues zero new requests, so resumability
  and politeness are the same mechanism.

### Identity, and why it is not negotiable

`lib/robots.js` matches the group for **every** identity that binds this fetcher:

```js
const OUR_TOKENS = ['coolbags-intake', 'claudebot', 'anthropic-ai', '*'];
```

`claudebot` and `anthropic-ai` are there because the fetching is performed by Claude on the user's
behalf. `berghaus.com` publishes `User-agent: ClaudeBot / Disallow: /`. Before those tokens existed
no group matched, the `*` group won by fallthrough, and the verdict came back `allow` — the single
do-not-scrape case the design names was the one case it would have violated.

**Choosing a User-Agent that dodges a named opt-out is evasion, not a bug fix.** If the Berghaus test
goes red, we have started ignoring a site's explicit opt-out.

`robots.txt` is treated as untrusted input throughout. The parser reads only `User-agent`, `Allow`,
`Disallow`, `Crawl-delay`, `Sitemap` and `Content-Signal`; every other line is discarded before it
reaches any other code, and the module returns only booleans, numbers, paths and URLs. TAD's and
Eastpak's `robots.txt` both contain prose addressed at AI agents urging installation of a
third-party shopping skill. **Crawl directives are obeyed; behavioural prose is data, never
instruction.**

---

## Yield estimates are never invented

Sitemap URLs are classified in two tiers:

- **strict** — an explicit product path segment with a real slug after it. Only this tier may feed a
  published `listings_est`, because a count is a claim and a claim needs evidence.
- **loose** — plausible leaf pages for a storefront with no product segment at all (Magento serves
  flat `.html` leaves at root). Used **only** to pick sample pages to try, never to count anything.
  That is safe because a sample is self-validating: rung A only reports viable if the page really
  contains a product record, so a category page that sneaks into `loose` fails the check instead of
  becoming a fake product.

When the strict classifier recognises nothing, `listings_est` stays `null`. An unknown yield is a
research task; a wrong yield is a wrong number in the catalog.

---

## Files

```
probe.js              CLI + the climb. Shebang carries --max-http-header-size=65536.
strategies.json       THE REGISTRY. Committed on purpose.
lib/strategies.js     Registry reader/writer. Schema + expiry rationale in its header.
lib/robots.js         Untrusted-input robots parser; returns only machine values.
lib/http.js           The only component allowed a socket. Politeness, cache, cookie jar, redirects.
lib/ladder.js         Rung logic, G1 shape assertion, platform + structure fingerprints, URL classifier.
lib/html.js           JSON-LD / meta / canonical extraction.
lib/fields.js         Bag-likeness, family keys, volume parsing.
lib/render.js         Rung C: headless Chrome --dump-dom, throttled like everything else.
test/                 node:test suites. Offline — fixtures are verbatim captured bytes.
.cache/               Raw bodies + per-brand probe.json. The ONLY gitignored thing here.
```

> **Everything except `.cache/` is committed, deliberately.** The previous generation of this
> project's tooling — `sync-brands.sh`, `link-checker.js`, `sync-brands-from-github.py` and the
> brand-tracking CSVs — was gitignored, never committed, and is now **lost permanently**. The
> pipeline that produced this catalog cannot be rerun or audited. If a script is load-bearing enough
> to run, it is load-bearing enough to commit.

---

## Exit codes

| Code | Meaning |
|---|---|
| `0` | A usable rung was found |
| `3` | `do-not-scrape` — a successful, final result |
| `1` | No rung found, or the host was unreachable |
| `2` | Usage error |

The yield/score gates (`below-yield-floor`, `parked-low-score`) are triage advice for a human and are
reported in `gate`. A brand that yields little still has a working rung, so it still exits `0`.

---

## Adding a new rung

1. **Implement it in `lib/`,** not in `probe.js`. `probe.js` orchestrates; the technique lives in a
   module. Rung C is the model: `lib/render.js` exposes one function returning the *same shape* as
   `http.fetchUrl` (`{url, status, ctype, bytes, sha256, body, cached}`) and stores its output in the
   same content-addressed store. A rendered quote with no stored render is not evidence.
2. **Take a turn in the politeness queue** via `http.throttle(host)`. Anything that reaches the
   network obeys the same per-host rate limit, browser or not.
3. **Check robots first** with `robots.isAllowed(parsed, pathAndQuery)` before the request.
4. **Assert the shape** with `ladder.assertShape(res, 'json'|'html')` and decide viability from a
   *product record that is actually present* — reuse `ladder.rungAViable(inv)` so the failure reasons
   stay a closed vocabulary. Add an identity assertion if the rung can land somewhere unrequested.
5. **Push one row into `out.ladder`** with `{rung, url, viable, status, bytes, sha256, code}`. Set
   `skipped: true` on a row only when no request was made — that flag is what stops the age clock
   from resetting.
6. **Add the letter to `RUNG_ORDER`** in `lib/strategies.js`, and to `SKIPPABLE` **only if** the rung
   is not load-bearing for another rung's candidate discovery (this is why rung A is not skippable).
7. **Gate it with `memoFor('<letter>')`** in `probe.js` so it participates in stickiness and expiry.
8. **Add a test** to `test/`, offline, with captured bytes as a fixture.
