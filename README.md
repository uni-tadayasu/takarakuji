# 宝くじ極 — takarakuji

番号作成、抽せんデータ分析、当せん照合、購入ノートをまとめたPC・スマホ対応のブラウザアプリです。

**公開サイト: https://uni-tadayasu.github.io/takarakuji/**

## ホーム画面に追加

画面右上、または「設定・バックアップ」にある **ホームに追加** ボタンから案内を開けます。

- **iPhone・iPad**: Safariで公開サイトを開き、共有 → ホーム画面に追加 → 追加。「ウェブアプリとして開く」が表示される場合はオンにします。
- **Android**: 対応ブラウザでは追加画面を開きます。表示されない場合はChromeなどのメニューから「アプリをインストール」または「ホーム画面に追加」を選びます。
- **PC**: Chrome・Edgeなどの対応ブラウザのインストール機能を利用できます。

OSやブラウザ側の確認操作が必要です。サイトから自動的にホーム画面へ追加することはありません。すでにホーム画面から起動している場合、追加ボタンは表示しません。

初回のオンライン読込でオフライン保存を準備します。設定または追加案内の「オフラインの準備ができました」を確認後、収録済みデータを使ってオフラインでも起動できます。抽せん結果は自動更新されません。

購入記録は端末・ブラウザごとに保存されます。ホーム画面版など別の環境へ移る前に、設定からJSONバックアップを保存してください。

## 自動公開

このリポジトリは既存のGitHub Pages設定で公開しています。`main` への更新後、**pages build and deployment** が成功すると公開サイトに反映されます。独自のデプロイ認証情報は不要です。

公開ファイルはリポジトリ直下の `index.html`、`install.js`、`manifest.webmanifest`、`sw.js`、`icons/` です。`.nojekyll` により静的ファイルとして配信します。manifestとService Workerは相対パスで構成し、GitHub Pagesの `/takarakuji/` 配下で動作します。

`sw.js` を更新する際は `CACHE_NAME` のバージョンも変更してください。同一アプリの古いキャッシュだけを削除します。開いているページは強制再読み込みしません。

## ダウンロード・ローカル利用

GitHubの **Code → Download ZIP** で一式をダウンロードできます。展開した `index.html` をPCのブラウザで開くと基本機能を使えます。ホーム画面への追加は公開HTTPSサイトをご利用ください。

ローカル開発例（Python 3）:

```sh
python3 -m http.server 3000
```

`http://localhost:3000/` を開きます。ビルドや外部JavaScriptライブラリは不要です。

## 検証

Node.js 18以降で実行します。追加依存はありません。

```sh
node --test tests/*.test.mjs
```

ホーム追加イベントのライフサイクル、GitHub Pagesのサブパス、アイコン、Service Workerのキャッシュ分離、オフラインfallbackを検証します。実機のインストール操作は端末・ブラウザに依存します。

## データと注意点

ロト7・ロト6・ミニロト・ナンバーズ3・ナンバーズ4・ビンゴ5に対応。初期収録データは2026年11月20日に確認した公式結果を各40回、計240回です。追加の結果はCSVで取り込めます。

本アプリは非公式の作成・分析・記録ツールです。未来の当せん番号を確実に予知したり、当せんを保証したりするものではありません。詳細な使い方・公式出典は [README-JA.txt](README-JA.txt) とアプリ内の「設定・バックアップ」に掲載しています。

### ホーム画面追加の仕様資料

- [Apple: iPhoneのSafariでWebサイトをアプリに変える](https://support.apple.com/ja-jp/guide/iphone/iphea86e5236/ios)
- [MDN: beforeinstallprompt](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event)
- [GitHub Pages: 公開元の設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
