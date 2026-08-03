# SPECIFICATION

## 0. このドキュメントについて

- 目的: `src/WorkLog.jsx` の実装を根拠に「現在の仕様」を記録する。セットアップ・ビルド・デプロイ手順などは重複記載せず、[README.md](../README.md) を参照する。
- バージョン: **Ver.1.0**（2026-08-03時点の実装内容）。
- 優先順位: **コード > README.md**。両者に差異がある場合、無断でどちらかを書き換えず、差異として記録する。
- 区分: 本書は「現在の仕様」「未実装・検討中・将来予定」「要確認事項」を明確に分けて記載する。「現在の仕様」はコードから断定できる内容のみを記載する。
- 実装が変わった場合は本書も合わせて更新すること。

## 1. 概要

- アプリ名: `Masato Taxi AI`（コード上の定数 `APP_NAME`）
- バージョン: コード上の定数 `APP_VERSION = "1.0"`（バックアップJSONに記録される）
- データ保存先: ブラウザの `localStorage`（記録本体のキー: `STORAGE_KEY = "workLogEntries"`、最終バックアップ日時: `LAST_BACKUP_KEY = "workLogLastBackupAt"`）。サーバー送信なし。
- 対象デバイス: スマホ縦画面を優先したレイアウト

## 2. データモデル（現在の仕様）

- 1件の記録（entry）の主なフィールド: `date`, `dayStatus`, `holidayType`, `holidayFraction`, `holidayOrigin`, `holidayTransfer`, `dutyTags`, `notes`, `sales`, `salesExtra`, `tip`, `count`, `handRaisedCount`, `appRideCount`, `totalDistance`, `occupiedDistance`, `condition`, `weather`, `workStart`, `workEnd`, `breakTime`, `workHours`, `hoursOverride`, `recordFormat`, `id`
  （根拠: `emptyForm`、`hasMonthlyLogContents`、`ensureRecordFormat`、`getComparableFormData`）
- `dayStatus` は `workday` / `dayoff` / `holiday` の3値（根拠: `DAY_STATUS` 定数）
- レコード形式の区分 `legacy` / `current`: 日付が `2024-12-21`〜`2026-07-20` の範囲なら `legacy`、それ以外は `current`（根拠: `getRecordFormatFromDate`）。
  - **画面表示モード**（`isLegacyMode`/`isCurrentMode`）は、保存済み`entry.recordFormat`の値に関係なく、常にこの日付判定だけで決まる（根拠: `activeRecordFormat = getRecordFormatFromDate(selectedDate)`）。
  - **保存データそのものの`recordFormat`**は、既に値が入っていればそれを優先し（`inferRecordFormat`）、新規保存時のみ日付から補完する。両者は独立した仕組みであり、保存済みデータのrecordFormatを画面表示のために書き換えることはない。
- 保存・読込: `loadEntries` / `persistEntries` が `localStorage` に対してJSONで読み書きする。`loadEntries` は読込時に `ensureRecordFormat` で正規化し、内容が変わった場合はその場で書き戻す。

## 3. 画面構成（現在の仕様）

`src/WorkLog.jsx` 内のセクションコメント・実装を根拠に、以下の構成要素が確認できる（上から表示順）。

- ヘッダー（Header。マスコットロゴ＋ DAILY LOG／アプリ名／ブランドメッセージ）
- 日付ナビゲーション（Date nav。前後の日付ボタン・今日へ戻る・日付input）
- DATE STATUSカード（勤務日／公休日の状態表示・手動変更。legacy/current共通で表示）
- DUTY STAMP（current期間のみ表示。legacy期間では非表示）
- 入力フォーム（SALESカード・営業記録など。legacy/currentで表示項目が異なる。「4. 勤務・公休ルール」参照）
- MONTHLY TOTALカード（月次合計・今月ノルマ・達成＋−）
- MONTHLY LOG（当該月度の日次一覧）
- MONTHLY JUMP（年度別に折りたたんだ月度ジャンプ一覧）
- データ管理（CSV書き出し・バックアップ・復元）
- 削除確認ダイアログ／復元確認ダイアログ（Restore confirm）
- トースト通知（Toast）

## 4. 勤務・公休ルール（現在の仕様）

### 4.1 隔日勤務の扱い
`isWorkDay(iso)` は `FIRST_WORKDAY = "2024-12-22"` を起点とし、その日からの日数差が2で割り切れる日を「勤務日」と判定する（隔日パターン）。

### 4.2 明け休みの扱い
`getEffectiveDayStatus` において、休日情報が無く隔日判定上の勤務日でもない日は `DAY_STATUS.DAYOFF` となり、`getStatusLabel` により「明け休み」と表示される。MONTHLY LOGの一覧には表示されない（「7. MONTHLY LOG」参照）が、データ自体は削除されずカレンダー（DATE STATUS）上には表示される。

### 4.3 勤務日と休日ステータス
`DAY_STATUS` は `workday` / `dayoff` / `holiday` の3値。`getEffectiveDayStatus` はおおよそ次の優先順で実効ステータスを決定する: 手動入力の実休日(`isActual`) → 手動オーバーライド(`isOverride`、記録の`dayStatus`か隔日判定) → 自動算出の休日予定(`isScheduled`) → 記録の`dayStatus`が`holiday` → 隔日判定。

### 4.4 黒字公休・赤字公休・黒字半日公休・赤字半日公休・有給
`holidayType` の主な値（根拠: UI選択肢定義、`getHolidayLabel`）:
- `black`（黒字公休日）
- `red`（赤字公休日。`dayStatus`により「出勤」「休み」の2状態がありうる）
- `black-half`（黒字半日公休日）
- `red-half`（赤字半日公休日）
- `paid`（有給休暇）

半日タイプは `inferHolidayFraction` により `holidayFraction = 0.5` として扱われる。`calculateWorkSchedule` 内では `blackHalfDays` が0.5日分として `plannedWorkDays` の減算に使われている。**`red-half`（赤字半日公休）が集計上どう扱われるかはコード上明確に確認できず「12. 要確認事項」とする。**

### 4.5 公休日でも通常勤務と同じ入力項目を利用できる仕様
`canShowWorkForm` は次の場合のみ通常勤務フォーム（7項目/詳細項目の入力欄）を表示する:
- `dayStatus` が `workday` の場合（`holidayType`が`red`でも`dayStatus`が`workday`なら該当。「赤字公休日（出勤）」選択がこれにあたる）
- `holidayType` が `black-half` または `red-half` の場合

したがって「黒字公休日」「赤字公休日（休み）」「有給休暇」では通常勤務フォームは**表示されない**（DATE STATUS・日付・コメント・保存ボタンのみのシンプル表示になる。legacy/current共通）。黒字公休日・赤字公休日（休み）についても通常勤務フォームを使えるようにする変更は「10.1」で未実装として管理する。

### 4.6 半日公休の午前・午後の記入方法
コード上、午前・午後を区別する専用フィールドは存在しない。`notes`（コメント）は自由入力のテキストフィールドのみ。運用ルールを強制するバリデーションや専用UIはないため**要確認**とする。

### 4.7 公休予定区分と実際の勤務の分離
`getHolidayInfo` は手動入力（manual entry）があればそれを優先し、無ければ `getScheduledHolidayType` による自動算出（`isScheduled: true`）を用いる。実際に勤務したかどうかは `isWorkedEntry`（売上 > 0 かつ当日以前）で独立に判定される。

### 4.8 14日周期の黒・赤交互算出（過去方向にも適用）
`getScheduledHolidayType` で確認できる範囲:
- 基準日 `HOLIDAY_AUTO_CYCLE_START = "2026-07-21"` からの日数差が14で割り切れる日のみ対象。
- 14日ごとのインデックスが偶数なら `black`、奇数なら `red`。
- **この周期計算は未来方向だけでなく過去方向（legacy期間を含む）にも同じ式でそのまま適用される。** 例: 2026-07-21=黒、2026-07-07=赤、2026-06-23=黒、2026-06-09=赤。
- 手動で公休日が保存されている日は、この自動算出より常に優先される（`findManualEntry` が `getScheduledHolidayType` より先に評価される）。

この基準日がなぜ `2026-07-21` なのか、黒→赤の順序の意図はコードから断定できないため**要確認**とする。

## 5. DUTY STAMP（現在の仕様）

- current期間のみ表示（legacy期間では非表示。データとしては保持される）。
- 選択肢は `DUTY_TAGS` 定数で定義されている（複数選択可・トグル式）:

```
当番なし, 日赤, 日赤夜①, 日赤夜②, 寝台①, 寝台②, 横関, 横関夜, 宿直, 研修, 貸切, 赤字（1日）, 赤字（半日）, 黒字（半日）
```

- 「当番なし」は他の選択肢と同じ通常のトグル式タグとして扱われる（`dutyTags` 配列への追加/削除のみで、特別な単一選択ロジックはない）。
- **横関夜①・横関夜②は現在の選択肢に存在しない。** `ensureRecordFormat` により、過去データに残る `"横関夜①"` `"横関夜②"` は読み込み時に `"横関夜"` へ自動変換される（統合済み）。
- 一方 **日赤夜①・日赤夜②は現在も選択肢として存在し**、同様の統合処理は確認できない。扱いが異なる理由は**要確認**。
- レガシー値 `"赤字（出勤）"` も読み込み時に `"赤字（1日）"` へ自動変換される。
- `PRESET_TAGS` は上記 `DUTY_TAGS` とは別の配列で、コメント欄の入力補助タグ。DUTY STAMPの選択肢とは用途が異なる。
- 何も選択していない場合の表示は「未設定」（`dutyStampSummary`）。「当番なし」を選ぶこと自体は明示的な選択として保存され、「未設定」とは区別される。

## 6. 集計ロジック（現在の仕様）

- 月次集計期間: `getPeriodBounds`（21日始まり〜翌月20日締め）。`getPeriodRange` は同関数のエイリアス。
- **WORK SCHEDULE・MONTHLY TOTAL・MONTHLY LOG は、いずれも `monthlyLogRange = getPeriodRange(selectedDate)` を共通の基準として使用し、常に同じ月度を表示する。**
- 暦上日数 `calendarWorkDays`: 期間内で `isWorkDay(iso)` が真となる日数
- 予定勤務日数 `plannedWorkDays`: `calendarWorkDays − blackHolidayDays − paidHolidayDays − redOffDays − blackHalfDays × 0.5`（`calculateWorkSchedule`）
- 勤務済み日数 `completedWorkDays`: 期間内で `isWorkedEntry`（売上 > 0 かつ当日以前）を満たす記録の件数
- 残り勤務日数 `remainingWorkDays`: `max(0, plannedWorkDays − completedWorkDays)`
- MONTHLY TOTALの「達成＋−」: `売上合計 − 今月ノルマ`。超過はプラス表示（緑）、未達はマイナス表示（赤）、ちょうど0は符号なし（通常色）。
- 勤務時間の自動計算: `calcHours`（開始・終了時刻・休憩時間から算出、手入力で上書き可）。表示ラベルはcurrent期間で「実務時間」、legacy期間で「勤務時間」（内部フィールド名は共通で`workHours`）。

## 7. MONTHLY LOG・MONTHLY JUMP（現在の仕様）

### 7.1 MONTHLY LOG
- 表示対象は選択中の月度（`monthlyLogRange`）内の記録のみ。**「明け休み」（`dayoff`）と空データ（`empty`）は一覧から除外される**（`monthlyLogEntries` の生成時点でフィルタ。データは削除されない）。
- 表示順は新しい日付→古い日付の降順。
- 1カードにつき「日付＋曜日」「勤務状態バッジ（勤務前／勤務済み／公休日）」「勤務区分（黒字/赤字/黒字半日/赤字半日/有給の短縮ラベルとDUTY STAMPタグを結合）」「売上（勤務済み以外は「—」）」のみを表示するコンパクト表示。
- カードは「1回目タップで選択 → 同じカードを2回目タップでその日の詳細画面へ遷移」の2ステップ方式。選択状態は日付が変わると自動的に解除される。
- 詳細画面へ遷移する際は既存の `changeDateSafely` を使用する（「8. 自動保存」参照）。遷移後は `window.scrollTo({top:0})` で画面最上部から表示する。

### 7.2 MONTHLY JUMP
- 年度ごとに折りたたみ表示。開ける年度は同時に1つのみ（`expandedJumpYear`）。
- 初期状態はすべて閉じている。ユーザーが開いた/閉じた状態は、日付が変わっても自動では変化しない。
- 表示年度の範囲: 2024年度から「今日の年」または「選択中の日付の年」の遅い方 + 1年先まで（`jumpYearOptions`。今日の日付から動的に算出するため、年をまたいでも自動で更新される）。
- 各年度内は1月度〜12月度を3列グリッドで表示。月度ボタン押下で `changeDateSafely(getPeriodStartForYearMonth(year, month))` を呼び、その月度の開始日（前月21日）へ移動する。
- 現在選択中の月度に対応するボタンはアクセント色で強調表示される。

## 8. 自動保存（現在の仕様）

- 共通保存関数 `saveCurrentForm({ source })` に、手動保存（`manual`）・自動保存（`auto`）・日付移動前の即時保存（`flush`）のすべてのロジックを集約している。検証・正規化・`entries`/`localStorage`の更新はこの1関数のみに存在する。
- 自動保存は入力が止まってから800ms後に1回だけ実行される（`autoSaveTimerRef`によるdebounce）。
- 同一内容かどうかの判定は `getComparableFormData` / `isFormUnchanged` で行う。id・recordFormat・holidayTransfer（保存日時を含む）やUI専用stateは比較対象から除外し、意味のある入力項目のみキー順固定で比較する。同一内容なら再保存しない。
- 日付変更・entries更新（自身の保存やバックアップ復元を含む）によるフォーム再読込は、`skipNextAutoSaveRef` により直後の自動保存監視を1回だけ無視させ、ユーザー入力と誤認しない。
- 日付を変える処理（前後の日付ボタン、日付input、今日へ戻る、MONTHLY LOGのジャンプ、MONTHLY JUMP、公休日移動・移動解除を含む全経路）は共通関数 `changeDateSafely` / `flushPendingSave` を必ず経由する。保留中の変更があれば先にflushし、保存成功（または変更なし）の場合のみ日付を移動する。保存に失敗した場合は移動しない。
- 保存状態は `autoSaveStatus`（"saving"/"saved"/"error"）として画面下部に小さく表示される。手動保存ボタン自体のラベル（"この日を保存"/"保存しました"/"保存に失敗しました"）は独立した `saveState` で制御される。
- 保存処理は常に `formRef.current`（直近のformの値）を参照するため、debounce待機中に入力が変わっても最新内容が保存される。
- 削除時（`handleDelete`）は保留中の自動保存タイマーを解除し、削除直後に古い内容が復活しないようにしている。

## 9. データ入出力（現在の仕様）

### 9.1 CSV書き出し
- `handleExportCsv`。列は「日付, 曜日, 売上, 追加売上, チップ, 回数, 勤務開始, 勤務終了, 休憩時間, 勤務時間, 備考」（列構成・エスケープ方法・UTF-8 BOMは変更なし）。
- 書き出し対象は `csvStartDate`〜`csvEndDate` で指定した期間の記録のみ（`entry.date >= start && entry.date <= end`）。日付順は昇順（古い→新しい）。
- 期間プリセット: 「現在の月度」（`monthlyLogRange`）／「今年」（今日の年の1/1〜12/31）／「全期間」（保存されている最古〜最新の日付）。
- 入力チェック: 開始日・終了日の未入力、開始日が終了日より後、対象データ0件のいずれかに該当する場合は書き出さずエラー表示。
- 書き出し前に `flushPendingSave()` を実行し、保存に失敗した場合は書き出しを中止する。
- ファイル名は `M's_Taxi_AI_<開始日>_<終了日>.csv` の形式（`sanitizeFilenamePart` でファイル名に使えない文字を`_`へ置換）。

### 9.2 バックアップ
- `performBackup` / `buildBackupPayload` により、以下の構造でJSON書き出しする:
  ```json
  {
    "app": "Masato Taxi AI",
    "version": "1.0",
    "createdAt": "ISO日時",
    "recordCount": 0,
    "legacyCount": 0,
    "currentCount": 0,
    "entries": [ ... ]
  }
  ```
  `entries` 自体の構造は従来と同じ。
- 最終バックアップ日時は `localStorage`（`LAST_BACKUP_KEY`）に保存し、「データ管理」画面に `YYYY/MM/DD HH:mm` 形式で表示する（未作成時は「未作成」）。

### 9.3 復元
- ファイル選択直後に解析のみ行い（`parseBackupFile`。旧形式＝素の配列／新形式＝`{app, version, entries}`の両方に対応）、即座には復元しない。
- 確認ダイアログ（Restore confirm）を表示し、「復元する」を押した場合のみ処理を進める。
  - `app` が異なる場合（他アプリのバックアップと判定できる場合）は、確認ダイアログを出さずその場で復元不可としトースト表示する。
  - `version` のみ異なる場合は、確認ダイアログ内にバージョン差異の警告を表示した上で、復元の続行は可能（強制中断はしない）。
- 「復元する」押下後、まず現在の `entries` を自動バックアップとして書き出す。自動バックアップに失敗した場合は復元を中止する。
- 自動バックアップ成功後、選択したデータを日付キーでマージして `entries` を更新する（同日付は上書き）。

## 10. PWA（現在の仕様）

- `src/main.jsx` で `navigator.serviceWorker` が利用可能な場合に `/sw.js` を登録する。

## 11. カスタマイズ・デザイン項目（現在の仕様）

- `PRESET_TAGS`: コメント欄のタグ候補
- `DUTY_TAGS`: DUTY STAMPの選択肢（先頭に「当番なし」）
- 締め日: `getPeriodBounds` 内の定数（`21`）
- アクセントカラー: `#FFD54A`（基準）／`#FFE066`（hover/active等の明るいバリアント）で全体を統一
- ヘッダーロゴ: `public/icons/logo-mascot-app-bg.png`（背景をアプリの`#12151A`に合わせて再配色した画像）
- `APP_NAME` / `APP_VERSION`: バックアップJSONに記録されるアプリ名・バージョン文字列

## 12. 未実装・検討中・将来予定

### 12.1 決定済みだが未実装の仕様

- **黒字公休日・赤字公休日（休み）でも通常勤務と同じ入力項目を利用できるようにする。**
  現在の実装（`canShowWorkForm`）では、通常勤務フォームが表示されるのは `workday`・黒字半日公休（`black-half`）・赤字半日公休（`red-half`）のみ（「4.5」参照）。この変更は未実装のまま。

### 12.2 README.mdからの引き継ぎ項目

- 出勤日数の集計ルール（売上 > 0 AND 当日以前）は、コード上（`isWorkedEntry`）**既に実装済み**であることを確認済み（旧README記載との差異は解消済み）。

## 13. 要確認事項

- `red-half`（赤字半日公休）が `calculateWorkSchedule` の集計上どう扱われるか（`black-half` の0.5減算は確認できたが `red-half` の同等処理はコード上未確認）
- 半日公休の午前・午後をコメント欄に記入する運用ルールの強制有無（専用フィールド・バリデーションなし）
- DUTY STAMPで「日赤夜①・②」が「横関夜①・②」と異なり統合されていない理由
- 14日周期の基準日 `"2026-07-21"` の設定意図、黒→赤の順序の意図
- `normalizeFixedDateEntry` が日付 `"2026-08-08"` を固定的に通常勤務日として扱う理由（この日付に対する特別処理の意図はコードから断定できない）

## 14. 既知の軽微な改善余地（Ver.1.1以降の候補・未対応）

コードレビューで確認した内容。安全性を優先し、Ver.1.0では変更していない。

- `getConditionLabel`、`formatDistanceValue`、コンポーネント内の`isActualHolidayEntry`変数は、現在呼び出し箇所が無い（未使用）。
- `getPeriodRange` は `getPeriodBounds` を呼ぶだけのエイリアス関数。
- 保存ボタン＋自動保存ステータス表示のJSXが、通常フォーム側と簡易フォーム側でほぼ同一の内容になっている（共通コンポーネント化の余地）。
- `WorkLog` コンポーネント本体が単一の関数として非常に大きい（約1700行）。将来的にはカード単位でのサブコンポーネント分割を検討する余地がある。
