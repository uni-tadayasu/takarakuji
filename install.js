/* Home-screen installation is optional; the lottery app also works in a normal tab. */
(() => {
  'use strict';
  const base = new URL('./', document.currentScript?.src || document.baseURI);
  const displayMode = window.matchMedia('(display-mode: standalone)');
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let platform = isIOS ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'desktop';
  let pendingPrompt = null;
  let prompting = false;
  let installed = false;
  let returnFocus = null;
  let offlineState = 'preparing';
  let notice = '';
  const standalone = () => displayMode.matches || navigator.standalone === true;

  const dialog = document.createElement('dialog');
  dialog.id = 'install-dialog';
  dialog.className = 'install-dialog';
  dialog.setAttribute('aria-labelledby', 'install-title');
  dialog.setAttribute('aria-describedby', 'install-intro');
  dialog.innerHTML = `
    <div class="install-dialog-head">
      <div class="install-app-identity"><img width="52" height="52" alt="" data-install-icon><div><span class="install-kicker">いつもの画面へ、ワンタップ。</span><h2 id="install-title">ホーム画面に追加</h2></div></div>
      <button type="button" class="install-close" data-install-action="close" aria-label="追加の案内を閉じる">×</button>
    </div>
    <div class="install-dialog-body">
      <p id="install-intro">宝くじ極をホーム画面からすぐに起動できます。端末の操作で追加してください。</p>
      <div class="install-platforms" role="tablist" aria-label="端末ごとの追加方法">
        <button type="button" role="tab" id="install-tab-ios" data-install-platform="ios" aria-controls="install-guide">iPhone・iPad</button>
        <button type="button" role="tab" id="install-tab-android" data-install-platform="android" aria-controls="install-guide">Android</button>
        <button type="button" role="tab" id="install-tab-desktop" data-install-platform="desktop" aria-controls="install-guide">PC</button>
      </div>
      <div id="install-guide" role="tabpanel" tabindex="0"></div>
      <button class="primary-button install-native" type="button" data-install-action="prompt" hidden>追加画面を開く <span aria-hidden="true">↗</span></button>
      <p class="install-notice" data-install-notice role="status" aria-live="polite"></p>
      <p class="install-small-note">追加の項目が見つからないときは、アプリ内ブラウザではなくSafariやChromeでこのページを開いてください。</p>
      <p class="install-offline" data-install-offline></p>
      <p class="install-small-note">購入記録は端末・ブラウザごとの保存です。移行前に「設定」からJSONバックアップを保存すると安心です。</p>
      <button class="secondary-button install-dismiss" type="button" data-install-action="close">閉じる</button>
    </div>`;
  dialog.querySelector('[data-install-icon]').src = new URL('icons/icon-192.png', base).href;
  document.body.appendChild(dialog);

  const guides = {
    ios: `<ol class="install-steps"><li><span>1</span><div><strong>Safariでこのページを開く</strong><p>iPhone・iPadのSafariを使います。</p></div></li><li><span>2</span><div><strong>共有ボタンをタップ</strong><p>四角から上向きの矢印が出ているボタンです。見つからない場合はメニューから「共有」を開きます。</p></div></li><li><span>3</span><div><strong>「ホーム画面に追加」を選ぶ</strong><p>一覧を下へスクロールすると表示されます。</p></div></li><li><span>4</span><div><strong>「追加」をタップ</strong><p>「ウェブアプリとして開く」が表示される場合はオンにします。</p></div></li></ol>`,
    android: `<ol class="install-steps"><li><span>1</span><div><strong>Chromeなどの対応ブラウザで開く</strong><p>このページをブラウザで表示します。</p></div></li><li><span>2</span><div><strong>メニュー「⋮」をタップ</strong><p>「アプリをインストール」または「ホーム画面に追加」を選びます。</p></div></li><li><span>3</span><div><strong>端末の確認画面で追加する</strong><p>下に「追加画面を開く」が表示されていれば、そのボタンからも進めます。項目の名前はブラウザで異なります。</p></div></li></ol>`,
    desktop: `<ol class="install-steps"><li><span>1</span><div><strong>Chrome・Edgeなどで開く</strong><p>対応しているブラウザではアプリとして追加できます。</p></div></li><li><span>2</span><div><strong>アドレスバーのインストールを選ぶ</strong><p>ブラウザのメニュー内に「アプリをインストール」などと表示される場合もあります。</p></div></li><li><span>3</span><div><strong>確認画面でインストールする</strong><p>追加機能がないブラウザでは、ブックマークからご利用いただけます。</p></div></li></ol>`
  };

  function offlineMessage() {
    if (offlineState === 'ready') return 'オフラインの準備ができました。保存されたデータで起動できます。抽せん結果は自動更新されません。';
    if (offlineState === 'unavailable') return 'オフライン保存は現在利用できません。オンラインで引き続きご利用いただけます。';
    if (offlineState === 'file') return 'ホーム画面への追加は公開サイトをブラウザで開いて行ってください。';
    return '初回のオンライン読込で、オフライン起動の準備をしています。';
  }

  function renderGuide() {
    dialog.querySelectorAll('[data-install-platform]').forEach(button => {
      const active = button.dataset.installPlatform === platform;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    const guide = dialog.querySelector('#install-guide');
    guide.innerHTML = guides[platform];
    guide.setAttribute('aria-labelledby', `install-tab-${platform}`);
  }

  function update() {
    const running = standalone();
    document.querySelectorAll('[data-install-action="open"]').forEach(button => {
      const header = button.dataset.installPlacement === 'header';
      button.hidden = header && (running || installed);
      button.disabled = running || installed || prompting;
      const label = running ? 'ホーム画面から起動中' : installed ? '追加済み' : header ? 'ホームに追加' : 'ホーム画面に追加';
      const span = button.querySelector('[data-install-label]');
      if (span) span.textContent = label;
      button.setAttribute('aria-label', label);
    });
    const status = running ? 'ホーム画面から起動しています。' : installed ? 'この端末への追加が完了しました。' : '端末に合わせた追加手順をご案内します。対応ブラウザでは追加画面を開けます。';
    document.querySelectorAll('[data-install-status]').forEach(node => { node.textContent = `${status} ${offlineMessage()}`; });
    const nativeButton = dialog.querySelector('[data-install-action="prompt"]');
    nativeButton.hidden = !pendingPrompt || installed || running;
    nativeButton.disabled = prompting;
    dialog.querySelector('[data-install-notice]').textContent = notice;
    dialog.querySelector('[data-install-offline]').textContent = offlineMessage();
  }

  function openDialog(trigger) {
    returnFocus = trigger;
    renderGuide();
    update();
    if (!dialog.open) dialog.showModal();
  }

  async function promptInstallation() {
    if (!pendingPrompt || prompting || standalone() || installed) return;
    // A captured event can be used only once. Consume it synchronously, in the click gesture.
    const event = pendingPrompt;
    pendingPrompt = null;
    prompting = true;
    notice = 'ブラウザの確認画面で操作を続けてください。';
    update();
    try {
      const promptResult = await event.prompt();
      const choice = event.userChoice ? await event.userChoice : promptResult;
      if (!installed) notice = choice?.outcome === 'accepted'
        ? '追加の操作を受け付けました。端末の案内を完了して、ホーム画面をご確認ください。'
        : '追加を見送りました。あとからブラウザのメニューで追加できます。';
    } catch {
      notice = '追加画面を開けませんでした。上の手順でブラウザのメニューから追加してください。';
    } finally {
      prompting = false;
      update();
    }
  }

  document.addEventListener('click', event => {
    const target = event.target.closest?.('[data-install-action]');
    if (!target || target.disabled) return;
    const action = target.dataset.installAction;
    if (action === 'open') {
      openDialog(target);
      if (pendingPrompt) void promptInstallation();
    } else if (action === 'prompt') {
      void promptInstallation();
    } else if (action === 'close') {
      dialog.close();
    }
  });
  dialog.addEventListener('click', event => {
    const tab = event.target.closest?.('[data-install-platform]');
    if (tab) { platform = tab.dataset.installPlatform; renderGuide(); }
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
  dialog.addEventListener('keydown', event => {
    const current = event.target.closest?.('[data-install-platform]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const platforms = ['ios', 'android', 'desktop'];
    const index = platforms.indexOf(platform);
    platform = event.key === 'Home' ? platforms[0] : event.key === 'End' ? platforms[2] : platforms[(index + (event.key === 'ArrowRight' ? 1 : 2)) % 3];
    renderGuide();
    dialog.querySelector(`[data-install-platform="${platform}"]`).focus();
  });
  dialog.addEventListener('close', () => {
    if (returnFocus?.isConnected && !returnFocus.hidden && !returnFocus.disabled) returnFocus.focus();
  });
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    if (standalone() || installed) return;
    pendingPrompt = event;
    notice = 'このブラウザでは、ボタンから追加画面を開けます。';
    update();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    pendingPrompt = null;
    notice = '追加が完了しました。ホーム画面の「宝くじ極」から起動できます。';
    update();
  });
  if (displayMode.addEventListener) displayMode.addEventListener('change', update);
  else if (displayMode.addListener) displayMode.addListener(update);
  window.addEventListener('pageshow', update);
  // The main app replaces its view. Refresh only install controls after navigation.
  const main = document.getElementById('main');
  if (main) new MutationObserver(update).observe(main, { childList: true });

  async function prepareOffline() {
    if (location.protocol === 'file:') { offlineState = 'file'; update(); return; }
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      offlineState = 'unavailable'; update(); return;
    }
    try {
      const registration = await navigator.serviceWorker.register(new URL('sw.js', base).href, {
        scope: base.pathname,
        updateViaCache: 'none'
      });
      const worker = registration.installing;
      if (worker) worker.addEventListener('statechange', () => {
        if (worker.state === 'redundant' && !registration.active) {
          offlineState = 'unavailable';
          update();
        }
      });
      await navigator.serviceWorker.ready;
      offlineState = 'ready';
    } catch {
      offlineState = 'unavailable';
    }
    update();
  }
  renderGuide();
  update();
  void prepareOffline();
})();
