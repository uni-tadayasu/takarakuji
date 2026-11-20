import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const source = await fs.readFile(new URL('sw.js', root), 'utf8');
const manifest = JSON.parse(await fs.readFile(new URL('manifest.webmanifest', root), 'utf8'));

function responseFor(request, label = 'initial') {
  const url = new URL(typeof request === 'string' ? request : request.url);
  let type, body;
  if (url.pathname.endsWith('.js')) { type = 'application/javascript'; body = `/* ${label} script */`; }
  else if (url.pathname.endsWith('.webmanifest')) { type = 'application/manifest+json'; body = JSON.stringify(manifest); }
  else if (url.pathname.endsWith('.png')) { type = 'image/png'; body = new Uint8Array([1, 2, 3]); }
  else { type = 'text/html'; body = `<html lang="ja">${label} home</html>`; }
  return new Response(body, { status: 200, headers: { 'content-type': type } });
}
function harness(path = '/takarakuji/', options = {}) {
  const appRoot = `https://uni-tadayasu.github.io${path}`;
  const handlers = new Map();
  const stores = new Map();
  const calls = [];
  const deleted = [];
  let skipped = 0, claimed = 0, rejectWrites = false, rejectOpens = false, rejectMatches = false;
  let network = async request => responseFor(request);
  const key = request => new URL(typeof request === 'string' ? request : request.url, appRoot).href;
  const caches = {
    async open(name) {
      if (rejectOpens) throw new Error('CacheStorage unavailable');
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(request, response) {
          if (rejectWrites) throw new Error('QuotaExceededError');
          store.set(key(request), response.clone());
        },
        async match(request) {
          if (rejectMatches) throw new Error('Cache read failed');
          return store.get(key(request))?.clone();
        }
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { deleted.push(name); return stores.delete(name); }
  };
  const context = vm.createContext({
    URL, Request, Response, AbortController, Set, Promise, Error,
    setTimeout: options.fastTimeout ? fn => setTimeout(fn, 10) : setTimeout,
    clearTimeout,
    caches,
    fetch: async (request, init) => { calls.push(key(request)); return network(request, init); },
    self: {
      location: { href: new URL('sw.js', appRoot).href },
      addEventListener: (name, handler) => handlers.set(name, handler),
      skipWaiting: async () => { skipped++; },
      clients: { claim: async () => { claimed++; } }
    }
  });
  vm.runInContext(source, context);
  return {
    appRoot, stores, calls, deleted, caches,
    get skipped() { return skipped; }, get claimed() { return claimed; },
    set network(fn) { network = fn; },
    set rejectWrites(value) { rejectWrites = value; },
    set rejectOpens(value) { rejectOpens = value; },
    set rejectMatches(value) { rejectMatches = value; },
    async lifecycle(name) {
      const pending = [];
      handlers.get(name)({ waitUntil: promise => pending.push(promise) });
      await Promise.all(pending);
    },
    async request(pathname, { mode = 'navigate', method = 'GET' } = {}) {
      let responsePromise;
      handlers.get('fetch')({
        request: { url: new URL(pathname, appRoot).href, mode, method },
        respondWith: promise => { responsePromise = promise; }
      });
      return responsePromise === undefined ? null : await responsePromise;
    }
  };
}

test('manifest resolves correctly at a GitHub project path and at a custom-domain root', async () => {
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'ja');
  for (const scope of ['https://uni-tadayasu.github.io/takarakuji/', 'https://lottery.example/']) {
    for (const field of ['id', 'start_url', 'scope']) assert.equal(new URL(manifest[field], scope).href, scope);
    for (const item of [...manifest.icons, ...manifest.shortcuts]) {
      const resolved = new URL(item.src || item.url, scope);
      assert.equal(resolved.origin, new URL(scope).origin);
      assert.ok(resolved.pathname.startsWith(new URL(scope).pathname));
    }
  }
  for (const icon of manifest.icons) {
    const bytes = await fs.readFile(new URL(icon.src, root));
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  assert.ok(manifest.icons.some(icon => icon.sizes === '192x192'));
  assert.ok(manifest.icons.some(icon => icon.sizes === '512x512' && icon.purpose === 'maskable'));
});

test('installation fetches and stores the complete shell inside its own project directory', async () => {
  const h = harness();
  await h.lifecycle('install');
  assert.equal(h.skipped, 1);
  assert.equal(h.calls.length, 8);
  assert.ok(h.calls.every(url => url.startsWith(h.appRoot)));
  const entries = [...h.stores.values()][0];
  assert.equal(entries.size, 8);
  assert.ok(entries.has(`${h.appRoot}install.js`));
  assert.ok(entries.has(`${h.appRoot}icons/apple-touch-icon180.png`));
});

test('an HTML response pretending to be install.js prevents new-worker activation', async () => {
  const h = harness();
  h.stores.set('previous-working-cache', new Map());
  h.network = async request => request.url.endsWith('install.js')
    ? new Response('<html>wrong page</html>', { headers: { 'content-type': 'text/html' } })
    : responseFor(request);
  await assert.rejects(h.lifecycle('install'), /App asset unavailable/);
  assert.equal(h.skipped, 0);
  assert.ok(h.stores.has('previous-working-cache'));
  assert.equal(h.stores.size, 1);
});

test('activation deletes only older caches for this exact application scope', async () => {
  const h = harness();
  await h.lifecycle('install');
  const current = [...h.stores.keys()][0];
  const ownOld = `${current.slice(0, current.lastIndexOf(':') + 1)}previous`;
  const other = 'takarakuji-pwa:%2Fother-game%2F:previous';
  const originRoot = 'takarakuji-pwa:%2F:previous';
  for (const name of [ownOld, other, originRoot, 'unrelated-app']) h.stores.set(name, new Map());
  await h.lifecycle('activate');
  assert.deepEqual(h.deleted, [ownOld]);
  assert.ok(h.stores.has(current));
  assert.ok(h.stores.has(other));
  assert.ok(h.stores.has(originRoot));
  assert.ok(h.stores.has('unrelated-app'));
  assert.equal(h.claimed, 1);
});

test('offline launch handles the project root, index, and query strings', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.network = async () => { throw new Error('offline'); };
  for (const pathname of ['./', './index.html', './?source=homescreen']) {
    const response = await h.request(pathname);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /initial home/);
  }
  assert.equal(await h.request('../another-app/'), null);
  assert.equal(await h.request('./missing-page'), null);
  assert.equal(await h.request('https://other.example/'), null);
  assert.equal(await h.request('./', { method: 'POST' }), null);
});

test('script requests never fall back to the application HTML', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.network = async () => new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } });
  const cachedScript = await h.request('./install.js', { mode: 'cors' });
  assert.match(await cachedScript.text(), /initial script/);
  for (const store of h.stores.values()) store.delete(`${h.appRoot}install.js`);
  const missingScript = await h.request('./install.js', { mode: 'cors' });
  assert.equal(missingScript.type, 'error');
  assert.equal(await missingScript.text(), '');
  assert.equal(await h.request('./unknown.js', { mode: 'cors' }), null);
});

test('a fresh navigation updates both home aliases for the next offline launch', async () => {
  const h = harness('/');
  await h.lifecycle('install');
  h.network = async request => responseFor(request, 'updated');
  assert.match(await (await h.request('./?source=homescreen')).text(), /updated home/);
  h.network = async () => { throw new Error('offline'); };
  assert.match(await (await h.request('./')).text(), /updated home/);
  assert.match(await (await h.request('./index.html')).text(), /updated home/);
});

test('a cache quota failure does not hide a successful network page', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.rejectWrites = true;
  h.network = async request => responseFor(request, 'network');
  assert.match(await (await h.request('./')).text(), /network home/);
});

test('a stalled request is aborted and falls back to the cached page', async () => {
  const h = harness('/takarakuji/', { fastTimeout: true });
  await h.lifecycle('install');
  h.network = (request, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  assert.match(await (await h.request('./')).text(), /initial home/);
});


test('CacheStorage.open rejection still serves fresh network pages and scripts', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.rejectOpens = true;
  h.network = async request => responseFor(request, 'fresh network');
  const before = h.calls.length;
  const page = await h.request('./');
  const script = await h.request('./install.js', { mode: 'cors' });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /fresh network home/);
  assert.equal(script.status, 200);
  assert.match(await script.text(), /fresh network script/);
  assert.equal(h.calls.length, before + 2, 'storage failure must not prevent network attempts');
});

test('unavailable CacheStorage plus offline returns a defined page or asset error', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.rejectOpens = true;
  h.network = async () => { throw new Error('offline'); };
  const page = await h.request('./index.html');
  assert.equal(page.status, 503);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  assert.match(await page.text(), /通信を確認してください/);
  const script = await h.request('./install.js', { mode: 'cors' });
  assert.equal(script.type, 'error');
  assert.equal(await script.text(), '');
});

test('cache.match rejection does not reject navigation or turn an asset into HTML', async () => {
  const h = harness();
  await h.lifecycle('install');
  h.rejectMatches = true;
  h.network = async () => { throw new Error('offline'); };
  const offlinePage = await h.request('./');
  assert.equal(offlinePage.status, 503);
  assert.match(await offlinePage.text(), /通信を確認してください/);
  assert.equal((await h.request('./install.js', { mode: 'cors' })).type, 'error');

  h.network = async () => new Response('<html>upstream unavailable</html>', {
    status: 502, headers: { 'content-type': 'text/html' }
  });
  const networkError = await h.request('./');
  assert.equal(networkError.status, 502);
  assert.match(await networkError.text(), /upstream unavailable/);
  assert.equal((await h.request('./install.js', { mode: 'cors' })).type, 'error');
});
