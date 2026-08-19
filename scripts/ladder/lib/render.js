'use strict';
/**
 * render.js — rung C. Local headless Chrome, --dump-dom.
 *
 * This is the technique that defeated Bellroy after BLOCKED-BRANDS.md had
 * recorded it as unscrapeable: plain curl returned template placeholders, so the
 * page was rendered locally and read from the DOM.
 *
 * Rendered DOM goes into the SAME content-addressed store as a curl response,
 * under the key "chrome-dom:<url>", for one reason: Invariant V requires that a
 * quote be checkable against bytes on disk. A rendered quote with no stored
 * render is not evidence.
 *
 * It also takes a turn in the same per-host politeness queue. A browser that
 * ignores the rate limit is not more polite because it is a browser.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { UA, throttle } = require('./http.js');

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function chromeAvailable() { return fs.existsSync(CHROME); }

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(CHROME, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => resolve({ err, stdout: stdout || '', stderr: stderr || '' }));
  });
}

/**
 * dumpDom — render `url` and store the resulting DOM.
 * Returns the same shape as http.fetchUrl: {url, status, ctype, bytes, sha256, body, cached}
 */
async function dumpDom(store, url, opts = {}) {
  const key = 'chrome-dom:' + url;
  if (!opts.force) {
    const hit = store.get(key);
    if (hit) { store.cacheHits++; return { ...hit, url: key, source_url: url, cached: true }; }
  }
  if (!chromeAvailable()) return { url: key, error: 'chrome-not-found: ' + CHROME };

  const release = await throttle(new URL(url).host);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-chrome-'));
  try {
    const args = [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-background-networking', '--mute-audio',
      '--user-data-dir=' + profile,
      '--user-agent=' + UA,
      '--virtual-time-budget=' + (opts.budgetMs || 12000),
      '--dump-dom', url,
    ];
    const r = await run(args, opts.timeoutMs || 60000);
    const body = Buffer.from(r.stdout, 'utf8');
    if (!body.length) return { url: key, error: 'empty-dom', stderr: r.stderr.slice(0, 300) };
    store.newRequests++;
    const stored = store.put(key, {
      status: 200, final_url: url, ctype: 'text/html; charset=utf-8',
      at: new Date().toISOString(), via: 'chrome --dump-dom',
    }, body);
    return { ...stored, url: key, source_url: url, cached: false };
  } finally {
    release();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { dumpDom, chromeAvailable, CHROME };
