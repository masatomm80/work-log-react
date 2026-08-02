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

### 記録・入力
- 日付ごとの記録・保存（`localStorage` に自動保存、更新・再読込しても保持）
- 過去の日報一覧表示、タップで編集、削除

### 集計
- 21日始まり〜翌月20日締めの月次合算（売上・チップ・回数・出勤日数・勤務時間）
- 勤務時間の自動計算（開始・終了時刻から算出、手入力で上書き可）
- WORK SCHEDULEカードでの残り勤務日数・予定/勤務済み日数・公休日数の集計

### データ管理
- CSV書き出し（Excel対応のUTF-8 BOM付き）
- データのバックアップ（JSON書き出し）と復元（JSON読み込み）

### PWA / UI
- PWA対応（ホーム画面に追加してアプリのように起動、`sw.js` によるService Worker登録）
- スマホ縦画面向けレイアウト、横スクロールなし

## 今後の実装予定

> **注記**: 下記のうち「出勤日数のカウント条件（売上 > 0 かつ当日以前）」は、
> `src/WorkLog.jsx` の `isWorkedEntry` / `calculateWorkSchedule` に既に実装されている
> ことをコード確認済みです。以下のリストは元の記載をそのまま残していますが、
> 実装済み／未着手の区分は docs/SPECIFICATION.md 作成時に改めて棚卸しが必要です。

- 出勤日数の集計ルールを見直す
  - 出勤日数としてカウントするのは「売上が入力され、保存済みのデータ」の日だけ
  - 売上 > 0 AND 保存済みデータ の2条件を満たす日を出勤日数に加算
- 以下のケースは出勤日数に含めない
  - 先の日付の予定入力
  - DUTY STAMP のみ入力
  - コメントのみ入力
  - 勤務時間のみ入力
  - 明け休み
  - 黒字公休日
  - 赤字公休日（休み）
  - 売上未入力の日
- 将来的には赤字公休日でも実際に出勤し売上を入力した日は通常勤務と同様に出勤日数に含める
- この仕様を前提に、勤務日数計算・残り勤務日数・月度集計を実装する

## docs/SPECIFICATION.md に今後まとめる予定の内容（下書きメモ）

このセクションは仕様書作成の準備用の一覧です。docs/SPECIFICATION.md 自体はまだ作成していません。

- 月次集計期間（21日始まり〜翌月20日締め）の判定ロジック（`getPeriodBounds`）
- 出勤日数・公休日数のカウント条件（`isWorkedEntry`、`calculateWorkSchedule`、`getHolidayInfo`）と、
  上記「今後の実装予定」との整合性の棚卸し
- 勤務時間の自動計算ロジック（`calcHours`、手入力上書きの優先順位）
- CSV出力のフォーマット（列構成、UTF-8 BOM、エンコーディング詳細）（`handleExportCsv`、`csvEscape`）
- バックアップ／復元のデータ構造（JSONスキーマ、復元時の日付重複の扱い）（`handleBackup`、`handleRestoreFile`）
- `localStorage` のデータ構造・保存キー設計（`loadEntries`、`persistEntries`）
- PWAの動作仕様（`sw.js` のキャッシュ戦略、オフライン時の挙動）
- 画面ごとのUI仕様（入力項目、バリデーション、表示条件、WORK SCHEDULE / MONTHLY LOG などのカード構成）
- カスタマイズ可能な項目の一覧（`PRESET_TAGS`、締め日の `21` など、「## カスタマイズ」節との対応）

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
