/* A scope-local offline shell: works at /takarakuji/ and at a custom-domain root. */
'use strict';
const APP_ROOT = new URL('./', self.location.href);
const INDEX_URL = new URL('index.html', APP_ROOT).href;
const CACHE_PREFIX = `takarakuji-pwa:${encodeURIComponent(APP_ROOT.pathname)}:`;
const CACHE_NAME = `${CACHE_PREFIX}20261120-home-v1`;
const TIMEOUT_MS = 4000;
const ASSET_PATHS = [
  './',
  './index.html',
  './install.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/apple-touch-icon180.png'
];
const ASSET_URLS = ASSET_PATHS.map(path => new URL(path, APP_ROOT).href);
const ASSET_SET = new Set(ASSET_URLS);

function canonicalURL(requestURL) {
  const url = new URL(requestURL);
  url.search = '';
  url.hash = '';
  return url.href;
}
function isHome(url) {
  return url === APP_ROOT.href || url === INDEX_URL;
}
function cacheable(url, response) {
  if (!response || response.status !== 200 || !['basic', 'default'].includes(response.type)) return false;
  if (response.url && new URL(response.url).origin !== APP_ROOT.origin) return false;
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (isHome(url)) return type === 'text/html';
  if (url.endsWith('.js')) return ['text/javascript', 'application/javascript', 'application/ecmascript', 'text/ecmascript'].includes(type);
  if (url.endsWith('.webmanifest')) return ['application/manifest+json', 'application/json'].includes(type);
  if (url.endsWith('.png')) return type === 'image/png';
  return false;
}
async function fetchFresh(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(request, { cache: 'no-cache', signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
async function storeResponse(cache, url, response) {
  await cache.put(url, response.clone());
  // Navigation aliases share one fresh document, even when opened with a query string.
  if (isHome(url)) {
    const alternate = url === INDEX_URL ? APP_ROOT.href : INDEX_URL;
    await cache.put(alternate, response.clone());
  }
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const responses = await Promise.all(ASSET_URLS.map(async url => {
      const response = await fetchFresh(new Request(url, { cache: 'reload' }));
      if (!cacheable(url, response)) throw new Error(`App asset unavailable: ${new URL(url).pathname}`);
      return [url, response];
    }));
    // Only a complete, validated shell becomes active. An earlier working cache survives failure.
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(responses.map(([url, response]) => cache.put(url, response)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME).map(name => caches.delete(name)));
    await self.clients.claim();
    // Never reload open windows: an in-progress number entry or record remains intact.
  })());
});

function offlineDocument() {
  return new Response('<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>宝くじ極</title><body style="font-family:system-ui,sans-serif;padding:32px;background:#f5f7f5;color:#123f35"><h1>通信を確認してください</h1><p>初回はインターネットにつないで宝くじ極を開いてください。読込が完了すると、保存された画面をオフラインでも使えます。</p><button onclick="location.reload()" style="padding:12px 20px;font:inherit">もう一度開く</button></body></html>', {
    status: 503,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}
async function networkFirst(request, url, navigation) {
  // Storage can be disabled or unavailable even while ordinary network requests work.
  let cache = null;
  try { cache = await caches.open(CACHE_NAME); } catch { /* Continue online without storage. */ }
  const previous = async () => {
    if (!cache) return undefined;
    try { return await cache.match(navigation ? INDEX_URL : url); } catch { return undefined; }
  };
  try {
    const response = await fetchFresh(request);
    if (cacheable(url, response)) {
      if (cache) {
        try { await storeResponse(cache, url, response); } catch { /* Serve valid network response. */ }
      }
      return response;
    }
    const saved = await previous();
    if (saved) return saved;
    return navigation ? response : Response.error();
  } catch {
    return (await previous()) || (navigation ? offlineDocument() : Response.error());
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== APP_ROOT.origin) return;
  const canonical = canonicalURL(url.href);
  const navigation = request.mode === 'navigate';
  if (navigation && isHome(canonical)) {
    event.respondWith(networkFirst(request, canonical, true));
    return;
  }
  // Do not intercept other apps, external links, unknown routes, or arbitrary data requests.
  if (!navigation && ASSET_SET.has(canonical) && !isHome(canonical)) {
    event.respondWith(networkFirst(request, canonical, false));
  }
});
