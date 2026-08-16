'use strict';
/**
 * http.js — the ONLY component permitted to open a socket.
 *
 * DESIGN.md §4.2:
 *   - one honest User-Agent
 *   - per-host token bucket, >= 2s between requests, 1 concurrent connection per host
 *   - hard cap on requests per host per run
 *   - content-addressed on-disk cache: a re-run replays from cache and issues
 *     zero new requests, so resumability and politeness are the same mechanism
 *   - --max-http-header-size=65536 (Magpul's headers measure 15,747 bytes against
 *     Node's 16 KB default; that was the entire "Magpul is blocked" story)
 *
 * Every response is stored verbatim as raw/<sha256>.body and indexed in
 * raw/manifest.json. Nothing downstream is allowed to hold a response in memory
 * that is not also on disk, because a quote must be checkable against bytes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UA = 'coolbags-intake/1.0 (+https://coolbags.info; contact hey@coolbags.info)';
const MIN_GAP_MS = 2000;      // floor; robots Crawl-delay raises it, never lowers it
const MAX_PER_HOST = 200;     // hard cap per process

const hostState = new Map(); // host -> {last:number, count:number, chain:Promise, delayMs:number}

function stateFor(host) {
  if (!hostState.has(host)) {
    hostState.set(host, { last: 0, count: 0, chain: Promise.resolve(), delayMs: MIN_GAP_MS });
  }
  return hostState.get(host);
}
function setCrawlDelay(host, seconds) {
  const s = stateFor(host);
  const ms = Math.round(Number(seconds) * 1000);
  if (Number.isFinite(ms) && ms > s.delayMs) s.delayMs = ms;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp' + process.pid;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

/**
 * Cookie jar. NOT authentication — this pipeline never logs in, never fills a
 * form, never POSTs. It stores cookies the server itself asked us to store,
 * which is ordinary HTTP client behaviour, and without it a normal site can be
 * unreachable: troubadourgoods.com 302-loops forever to /undefined/products/...
 * until `selectedCountry`/`selectedLanguage` come back on the second hop.
 * Node's built-in fetch follows redirects internally and carries no jar, so it
 * reports only "redirect count exceeded" — which reads exactly like a block.
 */
const jars = new Map(); // host -> Map(name -> value)
function jarFor(host) { if (!jars.has(host)) jars.set(host, new Map()); return jars.get(host); }
function absorbCookies(host, res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const jar = jarFor(host);
  for (const c of raw) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  return raw.length;
}
function cookieHeader(host) {
  const jar = jarFor(host);
  if (!jar.size) return null;
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}

class Store {
  constructor(rawDir) {
    this.dir = rawDir;
    this.manifestPath = path.join(rawDir, 'manifest.json');
    fs.mkdirSync(rawDir, { recursive: true });
    try { this.manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')); }
    catch { this.manifest = {}; }
    this.newRequests = 0;
    this.cacheHits = 0;
  }
  bodyPath(sha) { return path.join(this.dir, sha + '.body'); }
  get(url) {
    const e = this.manifest[url];
    if (!e) return null;
    try { return { ...e, body: fs.readFileSync(this.bodyPath(e.sha256)) }; }
    catch { return null; }
  }
  /**
   * putDerived — store a reassembled payload (e.g. a Next.js flight stream
   * rebuilt from many self.__next_f.push() chunks) as a first-class artifact.
   * Invariant V requires a quote to be checkable against bytes on disk; a quote
   * taken from a decoded stream is only evidence if the decoded stream is itself
   * on disk and names the response it came from.
   */
  putDerived(key, buf, derivedFrom, how) {
    return this.put(key, { status: 200, ctype: 'application/x-derived',
                           at: new Date().toISOString(), derived_from: derivedFrom, derived_by: how }, buf);
  }
  put(url, entry, buf) {
    const sha = sha256(buf);
    if (!fs.existsSync(this.bodyPath(sha))) writeAtomic(this.bodyPath(sha), buf);
    this.manifest[url] = { ...entry, sha256: sha, bytes: buf.length };
    writeAtomic(this.manifestPath, JSON.stringify(this.manifest, null, 2));
    return { ...this.manifest[url], body: buf };
  }
}

/**
 * fetchUrl — polite, cached, serial-per-host.
 * Returns {url, final_url, status, ctype, bytes, sha256, at, body:Buffer, cached:boolean}
 * or {error} on transport failure. Never throws for a network problem.
 */
/**
 * Cache freshness. The response cache is content-addressed and was previously
 * UNTIMED, which quietly defeated the whole point of the registry's expiry rule:
 * a "re-test" of a 200-day-old verdict replayed 200-day-old bytes, made zero
 * requests, and then re-dated the record as freshly measured. That is
 * BLOCKED-BRANDS.md rebuilt with extra steps — a permanent record of a failure
 * that nobody ever actually re-checks.
 *
 * A cached response older than this is not served. Callers that specifically
 * want a re-measurement (--retest-stale) pass force:true and bypass it entirely.
 */
const MAX_CACHE_AGE_MS = 7 * 864e5; // 7 days

function cacheAgeMs(entry) {
  const t = entry && entry.at ? Date.parse(entry.at) : NaN;
  return Number.isFinite(t) ? Date.now() - t : Infinity;
}

async function fetchUrl(store, url, opts = {}) {
  let cached = opts.force ? null : store.get(url);
  if (cached) {
    const age = cacheAgeMs(cached);
    const maxAge = opts.maxAgeMs != null ? opts.maxAgeMs : MAX_CACHE_AGE_MS;
    if (age > maxAge) {
      store.cacheStale = (store.cacheStale || 0) + 1;
      cached = null; // too old to stand in for a measurement
    }
  }
  if (cached) { store.cacheHits++; return { ...cached, url, cached: true }; }

  const host = new URL(url).host;
  const s = stateFor(host);
  if (s.count >= MAX_PER_HOST) return { url, error: `per-host cap ${MAX_PER_HOST} reached`, cached: false };

  // one connection per host, strictly serial, >= delayMs apart
  const run = s.chain.then(async () => {
    // +2ms margin: setTimeout may fire a millisecond early, and a gap measured
    // at 1999ms against a 2000ms floor is a violation, not a rounding detail.
    const wait = s.last + s.delayMs - Date.now();
    if (wait > 0) await sleep(wait + 2);
    s.last = Date.now();
    s.count++;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 30000);
    try {
      // manual redirect following, so the jar is applied on EVERY hop and a loop
      // is reported as a loop with its hop list, not as an opaque failure
      let cur = url, hops = [], res = null;
      for (let i = 0; i < 10; i++) {
        const h = new URL(cur).host;
        // A redirect hop is a real request to a real host, and hosts have
        // SEPARATE queues here. Without this, robots.txt at the apex that 302s to
        // www lands on www without ever stamping www's clock -- so the very next
        // request (the homepage, on the www origin) fires with last=0 and no wait.
        // Measured on the cached probe run: 38 pairs of same-site requests landed
        // under 2s apart that way, the closest 35 ms (osprey.com). Stamp every
        // host a hop actually touches, and wait out its gap before touching it.
        if (h !== host) {
          const sh = stateFor(h);
          const w = sh.last + sh.delayMs - Date.now();
          if (w > 0) await sleep(w);
          sh.last = Date.now();
          sh.count++;
        }
        const ck = cookieHeader(h);
        res = await fetch(cur, {
          headers: {
            'User-Agent': UA, 'Accept': opts.accept || '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            ...(ck ? { Cookie: ck } : {}),
          },
          redirect: 'manual',
          signal: ctrl.signal,
        });
        absorbCookies(h, res);
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
          const next = new URL(loc, cur).toString();
          hops.push({ from: cur, status: res.status, to: next });
          if (hops.filter(x => x.to === next).length > 2) {
            return { error: `redirect-loop after ${hops.length} hops -> ${next}`, hops };
          }
          cur = next;
          continue;
        }
        break;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        status: res.status,
        final_url: cur,
        ctype: res.headers.get('content-type') || '',
        at: new Date().toISOString(),
        hops: hops.length,
        buf,
      };
    } catch (e) {
      return { error: String(e && e.message || e) + (e && e.cause ? ' / ' + e.cause.message : '') };
    } finally { clearTimeout(t); }
  });
  s.chain = run.then(() => {}, () => {});
  const r = await run;
  if (r.error) return { url, error: r.error, cached: false };
  store.newRequests++;
  const stored = store.put(url, {
    status: r.status, final_url: r.final_url, ctype: r.ctype, at: r.at, redirect_hops: r.hops || 0,
  }, r.buf);
  return { ...stored, url, cached: false };
}

/**
 * throttle — take a turn in a host's queue without opening a socket here.
 * Used by render.js (headless Chrome) so a browser fetch obeys exactly the same
 * per-host politeness as a curl-equivalent one.
 */
async function throttle(host) {
  const s = stateFor(host);
  if (s.count >= MAX_PER_HOST) throw new Error(`per-host cap ${MAX_PER_HOST} reached for ${host}`);
  let release;
  const gate = new Promise(r => { release = r; });
  const mine = s.chain.then(async () => {
    // +2ms margin: setTimeout may fire a millisecond early, and a gap measured
    // at 1999ms against a 2000ms floor is a violation, not a rounding detail.
    const wait = s.last + s.delayMs - Date.now();
    if (wait > 0) await sleep(wait + 2);
    s.last = Date.now();
    s.count++;
  });
  s.chain = mine.then(() => gate, () => gate);
  await mine;
  return () => { s.last = Date.now(); release(); };
}

module.exports = { UA, fetchUrl, Store, setCrawlDelay, sha256, writeAtomic, sleep, throttle, MIN_GAP_MS };
