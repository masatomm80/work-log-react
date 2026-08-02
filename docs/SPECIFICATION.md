# SPECIFICATION

## 0. このドキュメントについて

- 目的: `src/WorkLog.jsx` の実装を根拠に「現在の仕様」を記録する。セットアップ・ビルド・デプロイ手順などは重複記載せず、[README.md](../README.md) を参照する。
- 優先順位: **コード > README.md**。両者に差異がある場合、無断でどちらかを書き換えず「11. README.mdとの差異」に事実として記録する。
- 区分: 本書は「現在の仕様」「未実装・検討中・将来予定」「要確認事項」を明確に分けて記載する。「現在の仕様」はコードから断定できる内容のみを記載する。
- 実装が変わった場合は本書も合わせて更新すること。

## 1. 概要

- アプリ名: Masato Taxi AI（[CLAUDE.md](../CLAUDE.md) 参照）
- データ保存先: ブラウザの `localStorage`（キー: `STORAGE_KEY = "workLogEntries"`）。サーバー送信なし。
- 対象デバイス: スマホ縦画面を優先したレイアウト（README.md参照）

## 2. データモデル（現在の仕様）

- 1件の記録（entry）の主なフィールド: `date`, `dayStatus`, `holidayType`, `holidayFraction`, `holidayOrigin`, `dutyTags`, `notes`, `sales`, `salesExtra`, `tip`, `count`, `handRaisedCount`, `appRideCount`, `totalDistance`, `occupiedDistance`, `condition`, `weather`, `workStart`, `workEnd`, `breakTime`, `workHours`, `recordFormat`
  （根拠: `emptyForm`、`hasMonthlyLogContents`、`ensureRecordFormat`）
- `dayStatus` は `workday` / `dayoff` / `holiday` の3値（根拠: `DAY_STATUS` 定数）
- レコード形式の区分 `legacy` / `current`: 日付が `2024-12-21`〜`2026-07-30` の範囲なら `legacy`、それ以外は `current`（根拠: `getRecordFormatFromDate`）。この区分が画面表示や入力可否に具体的にどう影響するかはコード全体を追い切れておらず「12. 要確認事項」に記載。
- 保存・読込: `loadEntries` / `persistEntries` が `localStorage` に対してJSONで読み書きする。

## 3. 画面構成（現在の仕様）

`src/WorkLog.jsx` 内のセクションコメントを根拠に、以下の構成要素が確認できる。

- ヘッダー（Header）
- 日付ナビゲーション（Date nav）
- 入力フォーム（Form。DUTY STAMPを含む）
- 月間合計（Monthly total）
- WORK SCHEDULEカード
- MONTHLY LOG
- データ管理（Data management。CSV/バックアップ/復元）
- 削除確認ダイアログ（Delete confirm）
- トースト通知（Toast）

## 4. 勤務・公休ルール（現在の仕様）

### 4.1 隔日勤務の扱い
`isWorkDay(iso)` は `FIRST_WORKDAY = "2024-12-22"` を起点とし、その日からの日数差が2で割り切れる日を「勤務日」と判定する（隔日パターン）。

### 4.2 明け休みの扱い
`getEffectiveDayStatus` において、休日情報が無く隔日判定上の勤務日でもない日は `DAY_STATUS.DAYOFF` となり、`getStatusLabel` により「明け休み」と表示される。

### 4.3 勤務日と休日ステータス
`DAY_STATUS` は `workday` / `dayoff` / `holiday` の3値。`getEffectiveDayStatus` はおおよそ次の優先順で実効ステータスを決定する: 手動入力の実休日(`isActual`) → 手動オーバーライド(`isOverride`、記録の`dayStatus`か隔日判定) → 自動算出の休日予定(`isScheduled`) → 記録の`dayStatus`が`holiday` → 隔日判定。

### 4.4 黒字公休・赤字公休・黒字半日公休・赤字半日公休・有給
`holidayType` の主な値（根拠: UI選択肢定義、`getHolidayLabel`）:
- `black`（黒字公休日）
- `red`（赤字公休日。`dayStatus`により「出勤」「休み」の2状態がありうる。根拠: `getHolidayLabel`、`isRedHoliday`）
- `black-half`（黒字半日公休日）
- `red-half`（赤字半日公休日）
- `paid`（有給休暇）

半日タイプは `inferHolidayFraction` により `holidayFraction = 0.5` として扱われる。`calculateWorkSchedule` 内では `blackHalfDays` が0.5日分として `plannedWorkDays` の減算に使われていることをコードで確認済み。**`red-half`（赤字半日公休）が集計上どう扱われるかはコード上明確に確認できず「12. 要確認事項」とする。**

### 4.5 公休日でも通常勤務と同じ入力項目を利用できる仕様
`canShowWorkForm` は次の場合のみ通常勤務フォームを表示する（真偽値を返す関数の実装を根拠とする）:
- `dayStatus` が `workday` の場合（`holidayType`が`red`でも`dayStatus`が`workday`なら該当。UI上の「赤字公休日（出勤）」選択がこれにあたる）
- `holidayType` が `black-half` または `red-half` の場合

したがって「黒字公休日」「赤字公休日（休み）」「有給休暇」では通常勤務フォームは**表示されない**。「公休日でも通常勤務と同じ入力項目が使える」という言い方は、**現在の実装としては** `workday`・黒字半日公休（`black-half`）・赤字半日公休（`red-half`）の3条件に限られる。

黒字公休日（`black`）・赤字公休日（`red`、休みの場合）についても通常勤務と同じ入力項目を使えるようにする変更は、コード上まだ実装されていない。この変更予定については「10. 未実装・検討中・将来予定」を参照。

### 4.6 半日公休の午前・午後の記入方法
コード上、午前・午後を区別する専用フィールドは存在しない。`notes`（コメント）は自由入力のテキストフィールドのみ（placeholder: 「自由に入力」「メモを入力」）。午前・午後の記入をコメント欄で行うという運用ルールを強制するバリデーションや専用UIはコードから確認できないため、**要確認**とする。

### 4.7 公休予定区分と実際の勤務の分離
`getHolidayInfo` は手動入力（manual entry）があればそれを優先し、無ければ `getScheduledHolidayType` による自動算出（`isScheduled: true`）を用いる。一方、実際に勤務したかどうかは `isWorkedEntry`（売上 > 0 かつ当日以前）で独立に判定される。休日の「予定区分」と「実績（勤務したか）」はコード上別ロジックで管理されていることを確認済み。

### 4.8 14日周期の黒・赤交互算出
`getScheduledHolidayType` で確認できる範囲のみ記載する:
- 基準日 `"2026-07-21"` からの日数差が14で割り切れる日のみ対象。
- 14日ごとのインデックスが偶数なら `black`、奇数なら `red`。

この基準日がなぜ `2026-07-21` なのか、以前の基準日からの移行経緯、黒→赤の順序の意図はコードから断定できないため**要確認**とする。

## 5. DUTY STAMP（現在の仕様）

選択肢は `DUTY_TAGS` 定数で定義されている:

```
日赤, 日赤夜①, 日赤夜②, 寝台①, 寝台②, 横関, 横関夜, 宿直, 研修, 貸切, 赤字（1日）, 赤字（半日）, 黒字（半日）
```

- **横関夜①・横関夜②は現在の選択肢に存在しない。** `ensureRecordFormat` により、過去データに残る `"横関夜①"` `"横関夜②"` は読み込み時に `"横関夜"` へ自動変換される。→ 横関夜については**統合済み**と判断できる。
- 一方 **日赤夜①・日赤夜②は現在も選択肢として存在し**、同様の統合処理は確認できない。横関夜とは扱いが異なっており、意図的な差か **要確認**。
- レガシー値 `"赤字（出勤）"` も読み込み時に `"赤字（1日）"` へ自動変換される（根拠: `ensureRecordFormat`）。
- `PRESET_TAGS` は上記 `DUTY_TAGS` とは別の配列で、コメント欄の入力補助タグ（README.mdの「備考のタグ候補」に対応）。DUTY STAMPの選択肢とは用途が異なる点に注意。

## 6. 集計ロジック（現在の仕様）

- 月次集計期間: `getPeriodBounds`（21日始まり〜翌月20日締め。README.mdの記載と一致）
- 暦上日数 `calendarWorkDays`: 期間内で `isWorkDay(iso)` が真となる日数
- 予定勤務日数 `plannedWorkDays`: `calendarWorkDays − blackHolidayDays − paidHolidayDays − redOffDays − blackHalfDays × 0.5`（`calculateWorkSchedule`）
- 勤務済み日数 `completedWorkDays`: 期間内で `isWorkedEntry`（売上 > 0 かつ当日以前）を満たす記録の件数
- 残り勤務日数 `remainingWorkDays`: `max(0, plannedWorkDays − completedWorkDays)`
- 勤務時間の自動計算: `calcHours`（開始・終了時刻・休憩時間から算出、手入力で上書き可）

## 7. データ入出力（現在の仕様）

- CSV書き出し: `handleExportCsv`。列は「日付, 曜日, 売上, 追加売上, チップ, 回数, 勤務開始, 勤務終了, 休憩時間, 勤務時間, 備考」。エスケープは `csvEscape`。
- バックアップ: `handleBackup`。全記録を `JSON.stringify` してJSONファイルとして出力。
- 復元: `handleRestoreFile`。選択したJSONファイルを `JSON.parse` して読み込み。

## 8. PWA（現在の仕様）

- `src/main.jsx` で `navigator.serviceWorker` が利用可能な場合に `/sw.js` を登録する。

## 9. カスタマイズ項目（現在の仕様）

- `PRESET_TAGS`: コメント欄のタグ候補
- 締め日: `getPeriodBounds` 内の定数（`21`）
- 配色: Tailwindの任意値クラス（詳細はREADME.md「カスタマイズ」節を参照）

## 10. 未実装・検討中・将来予定

### 10.1 決定済みだが未実装の仕様

- **黒字公休日・赤字公休日でも通常勤務と同じ入力項目を利用できるようにする。**
  現在の実装（`canShowWorkForm`）では、通常勤務フォームが表示されるのは `workday`・黒字半日公休（`black-half`）・赤字半日公休（`red-half`）のみ（詳細は「4.5 公休日でも通常勤務と同じ入力項目を利用できる仕様」参照）。黒字公休日（`black`）・赤字公休日（`red`、休みの場合）についても同様に通常勤務フォームを利用できるようにする変更が決定済みだが、コード上はまだ未実装。

### 10.2 README.md「今後の実装予定」からの引き継ぎ項目

（原文のまま記載。実装状況の差異は「11. README.mdとの差異」を参照）:

- 出勤日数の集計ルールを見直す（売上 > 0 AND 保存済みデータ の2条件）
- 以下は出勤日数に含めない: 先の日付の予定入力／DUTY STAMPのみ入力／コメントのみ入力／勤務時間のみ入力／明け休み／黒字公休日／赤字公休日（休み）／売上未入力の日
- 将来的には赤字公休日でも実際に出勤し売上を入力した日は通常勤務と同様に出勤日数に含める

## 11. README.mdとの差異

- README.md「今後の実装予定」は、出勤日数のカウント条件（売上 > 0 AND 保存済みデータ）を**未実装**であるかのように記載している。しかし実際のコード（`isWorkedEntry`: 売上 > 0 かつ当日以前、`calculateWorkSchedule`）では、この条件に近い判定が**既に実装済み**であることを確認した。README側とコード側で実装状況の記載に差異がある。本書ではどちらを正とするか判断せず、事実としてのみ記録する。

## 12. 要確認事項

- `recordFormat`（`legacy` / `current`）の区分が、画面表示や入力可否に具体的にどう影響するか
- `red-half`（赤字半日公休）が `calculateWorkSchedule` の集計上どう扱われるか（`black-half` の0.5減算は確認できたが `red-half` の同等処理はコード上未確認）
- 半日公休の午前・午後をコメント欄に記入する運用ルールの強制有無（専用フィールド・バリデーションなし）
- DUTY STAMPで「日赤夜①・②」が「横関夜①・②」と異なり統合されていない理由
- 14日周期の基準日 `"2026-07-21"` の設定意図、黒→赤の順序の意図
- `normalizeFixedDateEntry` が日付 `"2026-08-08"` を固定的に通常勤務日として扱う理由（根拠: `src/WorkLog.jsx` の該当関数。この日付に対する特別処理の意図はコードから断定できない）
