# M's Taxi AI（React版）

Vite + React + Tailwind CSS で構成された、実行可能なReactプロジェクト一式です。
デザイン・機能は既存の運行日報アプリと同じで、データは端末の `localStorage` に保存されます。

## 構成

```
work-log-react/
├── package.json
├── vite.config.js
├── tailwind.config.js
├── postcss.config.js
├── vercel.json
├── index.html
├── public/
│   ├── manifest.json     PWAマニフェスト
│   ├── sw.js              サービスワーカー
│   └── icons/             PWA用アイコン
└── src/
    ├── main.jsx           エントリーポイント（Service Worker登録も含む）
    ├── App.jsx            ルートコンポーネント
    ├── WorkLog.jsx         アプリ本体（画面・状態管理・保存・集計・CSV・バックアップ）
    └── index.css           Tailwindディレクティブ＋フォント設定
```

## 機能

- 日付ごとの記録・保存（`localStorage` に自動保存、更新・再読込しても保持）
- 過去の日報一覧表示、タップで編集、削除
- 21日始まり〜翌月20日締めの月次合算（売上・チップ・回数・出勤日数・勤務時間）
- 勤務時間の自動計算（開始・終了時刻から算出、手入力で上書き可）
- CSV書き出し（Excel対応のUTF-8 BOM付き）
- データのバックアップ（JSON書き出し）と復元（JSON読み込み）
- PWA対応（ホーム画面に追加してアプリのように起動）
- スマホ縦画面向けレイアウト、横スクロールなし

## Macでのセットアップ（Claude Code）

Node.js 18以上が入っていることを確認してください（`node -v`）。

```bash
cd work-log-react
npm install
npm run dev
```

ターミナルに表示される `http://localhost:5173` をブラウザで開くと確認できます。
同じWi-Fi内のAndroidスマホから確認する場合は、`vite.config.js` で `host: true` を
設定済みなので、`http://<MacのIPアドレス>:5173` でアクセスできます。

## ビルド

```bash
npm run build      # dist/ に本番用ファイルを出力
npm run preview     # ビルド結果をローカルで確認
```

## Vercelへの公開

### 方法A：Vercel CLI

```bash
npm install -g vercel   # 初回のみ
cd work-log-react
vercel                  # 質問に答えて初回デプロイ（プレビューURL発行）
vercel --prod            # 本番公開
```

Vite製プロジェクトなので、Vercelはビルドコマンド・出力ディレクトリを自動検出します
（`vercel.json` にも明記済みです）。

### 方法B：GitHub経由

1. プロジェクト一式をGitHubリポジトリにpush（`node_modules` は `.gitignore` 済みなので含まれません）
2. [vercel.com](https://vercel.com) で「Add New... → Project」からリポジトリをインポート
3. Framework Presetは自動的に「Vite」が選ばれます。そのまま「Deploy」

## スマホのホーム画面にアプリとして追加する

公開後のURLをAndroidのChromeで開き、「⋮」メニュー →「アプリをインストール」
または「ホーム画面に追加」でアイコンを追加できます。

## データについて（重要）

- データはこの端末・このブラウザ内にのみ保存されます（サーバーには送信されません）。
- 機種変更やブラウザの初期化前には、「データ管理」から**バックアップ（JSON）**を
  必ず実行し、ファイルを安全な場所に保管してください。
- 復元時、同じ日付のデータは上書きされます。

## カスタマイズ

- 配色は `src/WorkLog.jsx` 内の Tailwind の任意値クラス（`bg-[#12151A]` など）を編集してください。
- 備考のタグ候補は `src/WorkLog.jsx` 冒頭の `PRESET_TAGS` 配列を編集してください。
- 月次集計の締め日を変えたい場合は `getPeriodBounds` 関数内の `21` を変更してください。
