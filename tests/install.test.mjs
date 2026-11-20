import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile(new URL('../install.js', import.meta.url), 'utf8');

// A deliberately small DOM: enough browser semantics to exercise installation
// events, delegated controls, relative URLs, and replacement of the app's view.
// Native install surfaces and real browser layout remain browser QA concerns.
class EventHub {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    event.currentTarget = this;
    event.preventDefault ||= function () { this.defaultPrevented = true; };
    for (const handler of this.listeners.get(event.type) || []) handler(event);
    if (event.bubbles && this.parentNode) this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }
}

function matches(node, selector) {
  if (selector.startsWith('#')) return node.id === selector.slice(1);
  const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
  if (attribute) return node.attributes.has(attribute[1]) &&
    (attribute[2] === undefined || node.getAttribute(attribute[1]) === attribute[2]);
  return node.tagName === selector.toLowerCase();
}

class Element extends EventHub {
  constructor(tagName, ownerDocument) {
    super();
    this.tagName = tagName.toLowerCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.open = false;
    this.value = '';
    this.tabIndex = 0;
    this._text = '';
    this._html = '';
  }
  set id(value) { this.setAttribute('id', value); }
  get id() { return this.getAttribute('id') || ''; }
  setAttribute(name, value) {
    const text = String(value);
    this.attributes.set(name, text);
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = text;
    if (name === 'hidden') this.hidden = true;
    if (name === 'disabled') this.disabled = true;
    if (name === 'tabindex') this.tabIndex = Number(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument;
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
    this.children.push(child);
    child.parentNode = this;
    this.ownerDocument.changed(this);
    return child;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    for (const child of children) { this.children.push(child); child.parentNode = this; }
    this.ownerDocument.changed(this);
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this._html = html;
    this._text = '';
    this.replaceChildren();
    const stack = [this];
    const tags = /<\/?([a-z][\w-]*)([^>]*)>/gi;
    for (const match of html.matchAll(tags)) {
      const [raw, tag, attributes] = match;
      if (raw.startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
      const child = new Element(tag, this.ownerDocument);
      const attrPattern = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
      for (const attr of attributes.matchAll(attrPattern)) child.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
      stack.at(-1).children.push(child);
      child.parentNode = stack.at(-1);
      if (!['img', 'input', 'br', 'hr', 'meta', 'link'].includes(tag.toLowerCase()) && !raw.endsWith('/>')) stack.push(child);
    }
    this.ownerDocument.changed(this);
  }
  querySelectorAll(selector) {
    const result = [];
    const visit = node => {
      for (const child of node.children) { if (matches(child, selector)) result.push(child); visit(child); }
    };
    visit(this);
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    for (let node = this; node instanceof Element; node = node.parentNode) if (matches(node, selector)) return node;
    return null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatchEvent({ type: 'close' }); }
  getBoundingClientRect() { return { left: 20, right: 320, top: 20, bottom: 600 }; }
}

class Document extends EventHub {
  constructor(baseURI, scriptURL) {
    super();
    this.baseURI = baseURI;
    this.currentScript = scriptURL === null ? null : { src: scriptURL };
    this.observers = [];
    this.body = new Element('body', this);
    this.body.parentNode = this;
  }
  createElement(tag) { return new Element(tag, this); }
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
  querySelector(selector) { return this.body.querySelector(selector); }
  getElementById(id) { return this.querySelector(`#${id}`); }
  changed(target) {
    for (const observer of this.observers) {
      if (observer.target === target && observer.options.childList) observer.callback([{ type: 'childList', target }]);
    }
  }
}

const settle = () => new Promise(resolve => setImmediate(resolve));

function harness(options = {}) {
  const pageURL = options.pageURL || 'https://uni-tadayasu.github.io/takarakuji/index.html';
  const scriptURL = Object.hasOwn(options, 'scriptURL') ? options.scriptURL : new URL('install.js', pageURL).href;
  const document = new Document(options.baseURI || pageURL, scriptURL);
  const window = new EventHub();
  const displayMode = new EventHub();
  displayMode.matches = options.standalone || false;
  displayMode.addListener = handler => displayMode.addEventListener('change', handler);
  window.matchMedia = query => { assert.equal(query, '(display-mode: standalone)'); return displayMode; };
  window.isSecureContext = options.secure !== false;
  const registrationCalls = [];
  const navigator = {
    userAgent: options.userAgent || 'Mozilla/5.0 (Linux; Android 15) Chrome/134',
    platform: options.platform || 'Linux armv8l',
    maxTouchPoints: options.maxTouchPoints ?? 1,
    standalone: options.iosStandalone || false
  };
  if (options.serviceWorker !== false) navigator.serviceWorker = {
    register: async (url, init) => {
      registrationCalls.push({ url, scope: init.scope, updateViaCache: init.updateViaCache });
      if (options.registerError) throw new Error('Registration blocked');
      return options.registration || {};
    },
    ready: options.ready || Promise.resolve({})
  };
  const main = document.createElement('main');
  main.id = 'main';
  const control = placement => {
    const button = document.createElement('button');
    button.setAttribute('data-install-action', 'open');
    button.setAttribute('data-install-placement', placement);
    const label = document.createElement('span');
    label.setAttribute('data-install-label', '');
    button.appendChild(label);
    return button;
  };
  const header = control('header');
  let settings = control('settings');
  let status = document.createElement('p');
  status.setAttribute('data-install-status', '');
  const input = document.createElement('input');
  input.value = '01 07 12 21 32 40';
  const record = document.createElement('textarea');
  record.value = '買い目メモを編集中';
  main.appendChild(settings);
  main.appendChild(status);
  main.appendChild(input);
  main.appendChild(record);
  document.body.appendChild(header);
  document.body.appendChild(main);
  let gesture = false;
  const context = vm.createContext({
    URL, Promise, Error, window, document, navigator, location: new URL(pageURL),
    MutationObserver: class {
      constructor(callback) { this.callback = callback; }
      observe(target, observerOptions) { document.observers.push({ callback: this.callback, target, options: observerOptions }); }
    }
  });
  vm.runInContext(source, context, { filename: 'install.js' });
  const dialog = document.getElementById('install-dialog');
  return {
    window, document, displayMode, main, header, dialog, input, record, registrationCalls,
    get settings() { return settings; }, get status() { return status; },
    get nativeButton() { return dialog.querySelector('[data-install-action="prompt"]'); },
    get notice() { return dialog.querySelector('[data-install-notice]').textContent; },
    get offline() { return dialog.querySelector('[data-install-offline]').textContent; },
    get gesture() { return gesture; },
    click(target = header) {
      if (target.disabled) return;
      gesture = true;
      try { target.dispatchEvent({ type: 'click', bubbles: true, clientX: 100, clientY: 100 }); }
      finally { gesture = false; }
    },
    promptEvent({ outcome = 'accepted', promise, throws = false } = {}) {
      let calls = 0;
      const event = {
        type: 'beforeinstallprompt', defaultPrevented: false,
        userChoice: promise || Promise.resolve({ outcome }),
        prompt() {
          calls++;
          assert.equal(gesture, true, 'native prompt must be called synchronously inside the click gesture');
          if (throws) throw new Error('Prompt unavailable');
          return Promise.resolve();
        }
      };
      window.dispatchEvent(event);
      return { event, get calls() { return calls; } };
    },
    replaceView() {
      settings = control('settings');
      status = document.createElement('p');
      status.setAttribute('data-install-status', '');
      main.replaceChildren(settings, status, input, record);
    }
  };
}

test('beforeinstallprompt is deferred and consumed once, synchronously within a click', async () => {
  const h = harness();
  let finish;
  const prompt = h.promptEvent({ promise: new Promise(resolve => { finish = resolve; }) });
  assert.equal(prompt.event.defaultPrevented, true);
  assert.equal(prompt.calls, 0);
  assert.equal(h.nativeButton.hidden, false);
  h.click(h.header.querySelector('[data-install-label]'));
  assert.equal(h.dialog.open, true);
  assert.equal(prompt.calls, 1);
  assert.equal(h.header.disabled, true);
  h.click(h.header);
  h.click(h.nativeButton);
  assert.equal(prompt.calls, 1);
  finish({ outcome: 'accepted' });
  await settle();
  h.click(h.header);
  assert.equal(prompt.calls, 1);
});

test('accepted userChoice alone does not falsely mark the app installed', async () => {
  const h = harness();
  h.promptEvent();
  h.click();
  await settle();
  assert.equal(h.header.hidden, false);
  assert.equal(h.header.disabled, false);
  assert.equal(h.header.getAttribute('aria-label'), 'ホームに追加');
  assert.equal(h.nativeButton.hidden, true);
  assert.match(h.notice, /追加の操作を受け付けました/);
  assert.doesNotMatch(h.status.textContent, /追加が完了しました/);
});

test('dismissal consumes the event and a later event can be used again', async () => {
  const h = harness();
  const first = h.promptEvent({ outcome: 'dismissed' });
  h.click();
  await settle();
  assert.equal(h.header.disabled, false);
  assert.equal(h.nativeButton.hidden, true);
  assert.match(h.notice, /追加を見送りました/);
  h.click();
  assert.equal(first.calls, 1);
  const later = h.promptEvent();
  assert.equal(h.nativeButton.hidden, false);
  h.click(h.nativeButton);
  await settle();
  assert.equal(later.calls, 1);
  assert.equal(first.calls, 1);
});

test('a failed native prompt leaves usable controls and can recover with a fresh event', async () => {
  const h = harness();
  const failed = h.promptEvent({ throws: true });
  h.click();
  await settle();
  assert.equal(failed.calls, 1);
  assert.equal(h.header.disabled, false);
  assert.equal(h.nativeButton.hidden, true);
  assert.match(h.notice, /追加画面を開けませんでした/);
  const next = h.promptEvent();
  h.click(h.nativeButton);
  await settle();
  assert.equal(next.calls, 1);
  assert.match(h.notice, /追加の操作を受け付けました/);
});

test('a rejected userChoice promise also releases the pending state', async () => {
  const h = harness();
  let reject;
  h.promptEvent({ promise: new Promise((resolve, rejectChoice) => { reject = rejectChoice; }) });
  h.click();
  reject(new Error('User choice interrupted'));
  await settle();
  assert.equal(h.header.disabled, false);
  assert.equal(h.nativeButton.hidden, true);
  assert.match(h.notice, /追加画面を開けませんでした/);
});

test('appinstalled clears the prompt and marks all install controls installed', async () => {
  const h = harness();
  const prompt = h.promptEvent();
  h.window.dispatchEvent({ type: 'appinstalled' });
  assert.equal(h.header.hidden, true);
  assert.equal(h.header.disabled, true);
  assert.equal(h.settings.hidden, false);
  assert.equal(h.settings.disabled, true);
  assert.equal(h.settings.getAttribute('aria-label'), '追加済み');
  assert.equal(h.nativeButton.hidden, true);
  assert.match(h.status.textContent, /この端末への追加が完了しました/);
  h.click(h.nativeButton);
  assert.equal(prompt.calls, 0);
  const later = h.promptEvent();
  assert.equal(later.event.defaultPrevented, true);
  assert.equal(h.nativeButton.hidden, true);
});

test('standalone display mode and iOS standalone suppress duplicate installation', async () => {
  for (const options of [{ standalone: true }, { iosStandalone: true }]) {
    const h = harness(options);
    assert.equal(h.header.hidden, true);
    assert.equal(h.settings.disabled, true);
    assert.equal(h.settings.getAttribute('aria-label'), 'ホーム画面から起動中');
    const prompt = h.promptEvent();
    assert.equal(prompt.event.defaultPrevented, true);
    h.click(h.nativeButton);
    assert.equal(prompt.calls, 0);
    assert.equal(h.nativeButton.hidden, true);
  }
  const h = harness();
  h.displayMode.matches = true;
  h.displayMode.dispatchEvent({ type: 'change' });
  assert.equal(h.header.hidden, true);
  h.displayMode.matches = false;
  h.window.dispatchEvent({ type: 'pageshow' });
  assert.equal(h.header.hidden, false);
  assert.equal(h.header.disabled, false);
});

test('service worker URL and scope follow install.js at project paths and domain roots', async () => {
  for (const base of ['https://uni-tadayasu.github.io/takarakuji/', 'https://lottery.example/']) {
    const h = harness({ pageURL: `${base}index.html?source=home`, scriptURL: `${base}install.js`, baseURI: 'https://irrelevant.example/elsewhere/' });
    await settle();
    assert.deepEqual(h.registrationCalls, [{ url: `${base}sw.js`, scope: new URL(base).pathname, updateViaCache: 'none' }]);
    assert.equal(h.dialog.querySelector('[data-install-icon]').src, `${base}icons/icon-192.png`);
    assert.match(h.offline, /オフラインの準備ができました/);
  }
  const fallback = harness({ scriptURL: null });
  await settle();
  assert.equal(fallback.registrationCalls[0].url, 'https://uni-tadayasu.github.io/takarakuji/sw.js');
});

test('downloaded file context never attempts service worker registration', async () => {
  const h = harness({ pageURL: 'file:///Downloads/takarakuji/index.html' });
  await settle();
  assert.equal(h.registrationCalls.length, 0);
  assert.match(h.offline, /公開サイトをブラウザで開いて/);
  h.click();
  assert.equal(h.dialog.open, true);
});

test('unsupported, insecure, and rejected worker contexts still provide manual install help', async () => {
  for (const options of [{ serviceWorker: false }, { secure: false }, { registerError: true }]) {
    const h = harness(options);
    await settle();
    assert.equal(h.registrationCalls.length, options.registerError ? 1 : 0);
    assert.match(h.offline, /オンラインで引き続き/);
    h.click();
    assert.equal(h.dialog.open, true);
    assert.equal(h.nativeButton.hidden, true);
    assert.match(h.dialog.querySelector('#install-guide').innerHTML, /ホーム画面に追加/);
  }
});

test('view replacement refreshes only install controls and preserves existing input nodes', async () => {
  const h = harness();
  const originalInput = h.input;
  const originalRecord = h.record;
  h.input.value = '03 10 19 22 36 41';
  h.record.value = '保存前の購入記録';
  h.input.focus();
  h.window.dispatchEvent({ type: 'appinstalled' });
  h.replaceView();
  await settle();
  assert.equal(h.document.querySelector('input'), originalInput);
  assert.equal(h.document.querySelector('textarea'), originalRecord);
  assert.equal(h.input.value, '03 10 19 22 36 41');
  assert.equal(h.record.value, '保存前の購入記録');
  assert.equal(h.document.activeElement, originalInput);
  assert.equal(h.settings.disabled, true);
  assert.equal(h.settings.getAttribute('aria-label'), '追加済み');
  assert.match(h.status.textContent, /追加が完了しました/);
  assert.equal(h.dialog.isConnected, true);
});

test('iOS help uses the correct platform and closing restores the trigger focus', async () => {
  const h = harness({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', platform: 'iPhone' });
  h.click(h.settings);
  assert.equal(h.dialog.querySelector('[data-install-platform="ios"]').getAttribute('aria-selected'), 'true');
  assert.match(h.dialog.querySelector('#install-guide').innerHTML, /ウェブアプリとして開く/);
  h.click(h.dialog.querySelector('[data-install-action="close"]'));
  assert.equal(h.dialog.open, false);
  assert.equal(h.document.activeElement, h.settings);
});


test('a failed first worker install stops displaying offline preparation indefinitely', async () => {
  const worker = new EventHub();
  worker.state = 'installing';
  const h = harness({ registration: { installing: worker, active: null }, ready: new Promise(() => {}) });
  await settle();
  assert.match(h.offline, /準備をしています/);
  worker.state = 'redundant';
  worker.dispatchEvent({ type: 'statechange' });
  assert.match(h.offline, /オフライン保存は現在利用できません/);
  assert.match(h.status.textContent, /オンラインで引き続き/);
  h.click();
  assert.equal(h.dialog.open, true);
  assert.equal(h.header.disabled, false);
});

test('a failed update does not mark an existing active worker unavailable', async () => {
  const worker = new EventHub();
  worker.state = 'installing';
  const h = harness({ registration: { installing: worker, active: {} } });
  await settle();
  assert.match(h.offline, /オフラインの準備ができました/);
  worker.state = 'redundant';
  worker.dispatchEvent({ type: 'statechange' });
  assert.match(h.offline, /オフラインの準備ができました/);
  assert.doesNotMatch(h.offline, /利用できません/);
});
