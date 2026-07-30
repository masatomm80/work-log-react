import { useState, useEffect, useMemo, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Save,
  Trash2,
  CalendarDays,
  X,
  Download,
  Upload,
  FileSpreadsheet,
} from "lucide-react";

const STORAGE_KEY = "workLogEntries";
const PRESET_TAGS = ["日赤", "日赤夜", "寝台", "宿直", "横関", "横関夜", "早出", "明け", "点検書類提出"];
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const FIRST_WORKDAY = "2024-12-22";
const DAY_STATUS = {
  WORKDAY: "workday",
  DAYOFF: "dayoff",
  HOLIDAY: "holiday",
};
const WORK_TIME_OPTIONS = Array.from({ length: 24 * 6 }, (_, i) => {
  const mins = i * 10;
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
});
const BREAK_TIME_OPTIONS = Array.from({ length: 8 * 6 + 1 }, (_, i) => {
  const mins = i * 10;
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
});

// ---------- date helpers (local time, no UTC drift) ----------
function todayISO() {
  return toISO(new Date());
}
function toISO(dt) {
  const tz = dt.getTimezoneOffset() * 60000;
  return new Date(dt - tz).toISOString().slice(0, 10);
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso, n) {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}
function diffDays(a, b) {
  const d1 = parseISO(a);
  const d2 = parseISO(b);
  return Math.round((d1 - d2) / 86400000);
}
function isWorkDay(iso) {
  const diff = diffDays(iso, FIRST_WORKDAY);
  return diff >= 0 && diff % 2 === 0;
}
function getEffectiveDayStatus(iso, record) {
  if (record?.dayStatus === DAY_STATUS.HOLIDAY && isWorkDay(iso)) {
    return DAY_STATUS.HOLIDAY;
  }
  return isWorkDay(iso) ? DAY_STATUS.WORKDAY : DAY_STATUS.DAYOFF;
}
function getStatusLabel(status) {
  if (status === DAY_STATUS.HOLIDAY) return "公休日";
  if (status === DAY_STATUS.DAYOFF) return "明け休み";
  return "勤務日";
}
function hasFormData(form) {
  return Boolean(
    form.sales ||
      form.salesExtra ||
      form.tip ||
      form.count ||
      form.workStart ||
      form.workEnd ||
      form.breakTime ||
      form.workHours ||
      form.notes
  );
}
function fmtDateLabel(iso) {
  if (!iso) return { m: 0, d: 0, wd: "" };
  const dt = parseISO(iso);
  const [, m, d] = iso.split("-").map(Number);
  return { m, d, wd: WEEKDAY_JA[dt.getDay()] };
}
function parseTimeToMinutes(value) {
  if (!value) return null;
  const [h, m] = value.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}
function calcHours(start, end, breakTime) {
  if (!start || !end) return "";
  const startMinutes = parseTimeToMinutes(start);
  const endMinutes = parseTimeToMinutes(end);
  const breakMinutes = parseTimeToMinutes(breakTime) || 0;
  if (startMinutes === null || endMinutes === null) return "";
  let mins = endMinutes - startMinutes;
  if (mins <= 0) mins += 24 * 60;
  const worked = mins - breakMinutes;
  if (worked <= 0) return "0.0";
  return (Math.round((worked / 60) * 10) / 10).toFixed(1);
}
// Period runs 21st of a month through 20th of the next month.
function getPeriodBounds(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  let start, end;
  if (d >= 21) {
    start = new Date(y, m - 1, 21);
    end = new Date(y, m, 20);
  } else {
    start = new Date(y, m - 2, 21);
    end = new Date(y, m - 1, 20);
  }
  return { start: toISO(start), end: toISO(end) };
}
function shiftPeriod(anchorISO, dir) {
  const { start, end } = getPeriodBounds(anchorISO);
  return dir < 0 ? addDays(start, -1) : addDays(end, 1);
}
function yen(n) {
  const v = Number(n);
  if (!n || isNaN(v)) return "0";
  return v.toLocaleString("ja-JP");
}

// ---------- localStorage helpers ----------
function loadEntries() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error("読み込みエラー", e);
    return [];
  }
}
function persistEntries(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return true;
  } catch (e) {
    console.error("保存エラー", e);
    return false;
  }
}

const emptyForm = (date) => ({
  id: null,
  date,
  sales: "",
  salesExtra: "",
  tip: "",
  count: "",
  workStart: "",
  workEnd: "",
  breakTime: "",
  workHours: "",
  hoursOverride: false,
  notes: "",
  dayStatus: getEffectiveDayStatus(date, null),
});

function normalizeForm(date, existing) {
  return {
    ...emptyForm(date),
    ...(existing || {}),
    dayStatus: getEffectiveDayStatus(date, existing),
  };
}

function downloadBlob(content, mime, filename) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function WorkLog() {
  const [entries, setEntries] = useState(() => loadEntries());
  const [saveState, setSaveState] = useState("idle"); // idle | saved | error
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [form, setForm] = useState(emptyForm(todayISO()));
  const [periodAnchor, setPeriodAnchor] = useState(todayISO());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [toast, setToast] = useState(null);
  const dateInputRef = useRef(null);
  const restoreInputRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    const existing = entries.find((e) => e.date === selectedDate);
    setForm(existing ? normalizeForm(selectedDate, existing) : emptyForm(selectedDate));
  }, [selectedDate, entries]);

  const sortedEntries = useMemo(
    () => [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries]
  );

  const periodBounds = useMemo(() => getPeriodBounds(periodAnchor), [periodAnchor]);
  const periodEntries = useMemo(
    () => entries.filter((e) => e.date >= periodBounds.start && e.date <= periodBounds.end),
    [entries, periodBounds]
  );
  const periodTotals = useMemo(
    () =>
      periodEntries.reduce(
        (acc, e) => {
          acc.sales += (Number(e.sales) || 0) + (Number(e.salesExtra) || 0);
          acc.tip += Number(e.tip) || 0;
          acc.count += Number(e.count) || 0;
          acc.hours += Number(e.workHours) || 0;
          acc.days += 1;
          return acc;
        },
        { sales: 0, tip: 0, count: 0, hours: 0, days: 0 }
      ),
    [periodEntries]
  );

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 1600);
  };

  const updateField = (key, value) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if ((key === "workStart" || key === "workEnd" || key === "breakTime") && !f.hoursOverride) {
        next.workHours = calcHours(
          key === "workStart" ? value : f.workStart,
          key === "workEnd" ? value : f.workEnd,
          key === "breakTime" ? value : f.breakTime
        );
      }
      return next;
    });
  };

  const toggleTag = (tag) => {
    setForm((f) => {
      const parts = f.notes ? f.notes.split(/[\s、,　]+/).filter(Boolean) : [];
      const has = parts.includes(tag);
      const nextParts = has ? parts.filter((p) => p !== tag) : [...parts, tag];
      return { ...f, notes: nextParts.join("　") };
    });
  };

  const handleSave = () => {
    const id = form.id || `${form.date}-${Date.now()}`;
    const record = { ...form, dayStatus: getEffectiveDayStatus(form.date, form), id };
    const next = entries.some((e) => e.id === id)
      ? entries.map((e) => (e.id === id ? record : e))
      : [...entries.filter((e) => e.date !== form.date), record];
    setEntries(next);
    setForm(record);
    const ok = persistEntries(next);
    setSaveState(ok ? "saved" : "error");
    showToast(ok ? "保存しました" : "保存に失敗しました");
    setTimeout(() => setSaveState("idle"), 1200);
  };

  const handleDelete = (id) => {
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    persistEntries(next);
    setConfirmDeleteId(null);
    if (form.id === id) setForm(emptyForm(selectedDate));
    showToast("削除しました");
  };

  const handleExportCsv = () => {
    const rows = [
      ["日付", "曜日", "売上", "追加売上", "チップ", "回数", "勤務開始", "勤務終了", "休憩時間", "勤務時間", "備考"].join(","),
    ];
    [...entries]
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .forEach((e) => {
        const lbl = fmtDateLabel(e.date);
        rows.push(
          [
            e.date,
            lbl.wd,
            e.sales || 0,
            e.salesExtra || 0,
            e.tip || 0,
            e.count || 0,
            e.workStart || "",
            e.workEnd || "",
            e.breakTime || "",
            e.workHours || "",
            csvEscape(e.notes || ""),
          ].join(",")
        );
      });
    const csv = "\uFEFF" + rows.join("\r\n");
    downloadBlob(csv, "text/csv;charset=utf-8", `運行日報_${todayISO()}.csv`);
    showToast("CSVを書き出しました");
  };

  const handleBackup = () => {
    downloadBlob(JSON.stringify(entries, null, 2), "application/json", `work-log-backup_${todayISO()}.json`);
    showToast("バックアップを書き出しました");
  };

  const handleRestoreFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let imported;
      try {
        imported = JSON.parse(reader.result);
      } catch {
        showToast("ファイルの読み込みに失敗しました");
        return;
      }
      if (!Array.isArray(imported)) {
        showToast("バックアップ形式が正しくありません");
        return;
      }
      const validCount = imported.filter((r) => r && r.date).length;
      const proceed = window.confirm(
        `${validCount}件のデータを読み込みます。同じ日付の既存データは上書きされます。よろしいですか？`
      );
      if (!proceed) return;

      const byDate = {};
      entries.forEach((en) => (byDate[en.date] = en));
      imported.forEach((r) => {
        if (r && r.date) {
          if (!r.id) r.id = `${r.date}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
          byDate[r.date] = r;
        }
      });
      const merged = Object.values(byDate);
      setEntries(merged);
      persistEntries(merged);
      showToast("復元しました");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const { m, d, wd } = fmtDateLabel(selectedDate);
  const effectiveStatus = getEffectiveDayStatus(selectedDate, form);
  const isWorkday = effectiveStatus === DAY_STATUS.WORKDAY;
  const isHoliday = effectiveStatus === DAY_STATUS.HOLIDAY;
  const isDayOff = effectiveStatus === DAY_STATUS.DAYOFF;
  const canEditFields = isWorkday;
  const statusLabel = getStatusLabel(effectiveStatus);
  const totalSales = (Number(form.sales) || 0) + (Number(form.salesExtra) || 0);
  const activeTags = form.notes ? form.notes.split(/[\s、,　]+/).filter(Boolean) : [];
  const periodStartLbl = fmtDateLabel(periodBounds.start);
  const periodEndLbl = fmtDateLabel(periodBounds.end);

  const handleToggleHoliday = () => {
    if (!isWorkday) return;
    if (!isHoliday && hasFormData(form)) {
      const proceed = window.confirm("入力済みの内容は保持したまま、公休日に切り替えますか？");
      if (!proceed) return;
    }
    setForm((f) => ({ ...f, dayStatus: isHoliday ? DAY_STATUS.WORKDAY : DAY_STATUS.HOLIDAY }));
  };

  return (
    <div className="min-h-screen bg-[#12151A] font-body text-[#EDEFF3] pb-16">
      {/* Header */}
      <header className="px-5 pt-7 pb-4 border-b border-[#232A36] max-w-[560px] mx-auto">
        <div className="text-[11px] tracking-[0.25em] text-[#FFB454] font-meter font-medium">DAILY LOG</div>
        <h1 className="font-display text-2xl mt-1" style={{ fontWeight: 900 }}>
          masato taxi ai
        </h1>
        <p className="text-[13px] text-[#7C8496] mt-0.5">売上・チップ・勤務時間をその日のうちに</p>
      </header>

      {/* Date nav */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#232A36] bg-[#161A21] sticky top-0 z-10 max-w-[560px] mx-auto">
        <button
          onClick={() => setSelectedDate((s) => addDays(s, -1))}
          className="p-2 -ml-2 text-[#7C8496] active:text-[#FFB454] transition-colors"
          aria-label="前の日"
        >
          <ChevronLeft size={20} />
        </button>
        <button
          className="flex items-baseline gap-2 relative"
          onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}
        >
          <span className="font-meter text-lg font-bold">
            {m}
            <span className="text-[#7C8496] mx-0.5">/</span>
            {d}
          </span>
          <span className="text-sm text-[#7C8496]">({wd})</span>
          <CalendarDays size={14} className="text-[#7C8496] ml-1" />
          <input
            ref={dateInputRef}
            type="date"
            min={FIRST_WORKDAY}
            value={selectedDate}
            onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </button>
        <button
          onClick={() => setSelectedDate((s) => addDays(s, 1))}
          className="p-2 -mr-2 text-[#7C8496] active:text-[#FFB454] transition-colors"
          aria-label="次の日"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="max-w-[560px] mx-auto">
        <div className="mx-5 mt-4 rounded-2xl border border-[#232A36] bg-[#171C24] px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] tracking-[0.2em] text-[#7C8496] font-meter">DATE STATUS</div>
              <div className="font-medium text-[#EDEFF3] mt-1">{statusLabel}</div>
            </div>
            {isWorkday ? (
              <button
                onClick={handleToggleHoliday}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${
                  isHoliday
                    ? "border-[#FFB454] bg-[#FFB454]/10 text-[#FFB454]"
                    : "border-[#2A3140] text-[#8B93A1]"
                }`}
              >
                <span className={`flex h-4 w-4 items-center justify-center rounded border ${isHoliday ? "border-[#FFB454] bg-[#FFB454] text-[#12151A]" : "border-[#8B93A1]"}`}>
                  {isHoliday ? "✓" : ""}
                </span>
                公休日
              </button>
            ) : null}
          </div>
        </div>

        {/* Meter panel */}
        <div className="mx-5 mt-5 rounded-2xl bg-[#181D25] border border-[#232A36] overflow-hidden">
          <div className="border-l-4 border-[#FFB454] px-5 py-5">
            <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">売上 SALES</div>
            <div
              className="font-meter font-bold text-[#FFD98A] mt-1 leading-none break-all"
              style={{ fontSize: "clamp(2.2rem, 9vw, 3rem)", textShadow: "0 0 18px rgba(255,180,84,0.35)" }}
            >
              ¥{yen(totalSales)}
            </div>
            {form.salesExtra ? (
              <div className="text-[12px] text-[#7C8496] mt-1 font-meter">
                内訳 {yen(form.sales)} + {yen(form.salesExtra)}
              </div>
            ) : null}
          </div>
          <div className="grid grid-cols-3 border-t border-[#232A36]">
            {[
              ["チップ", form.tip ? `¥${yen(form.tip)}` : "—"],
              ["回数", form.count || "—"],
              ["勤務時間", form.workHours ? `${form.workHours}h` : "—"],
            ].map(([label, val]) => (
              <div key={label} className="px-4 py-3 border-r border-[#232A36] last:border-r-0 min-w-0">
                <div className="text-[10px] text-[#7C8496] tracking-wide">{label}</div>
                <div className="font-meter text-base font-medium mt-0.5 text-[#EDEFF3] break-all">{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Form */}
        <div className="mx-5 mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Field label="売上">
              <YenInput value={form.sales} onChange={(v) => updateField("sales", v)} disabled={!canEditFields} />
            </Field>
            <Field label="追加売上（任意）">
              <YenInput value={form.salesExtra} onChange={(v) => updateField("salesExtra", v)} disabled={!canEditFields} />
            </Field>
            <Field label="チップ">
              <YenInput value={form.tip} onChange={(v) => updateField("tip", v)} disabled={!canEditFields} />
            </Field>
            <Field label="回数">
              <input
                type="number"
                inputMode="numeric"
                value={form.count}
                onChange={(e) => updateField("count", e.target.value)}
                placeholder="0"
                disabled={!canEditFields}
                className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] disabled:opacity-60"
              />
            </Field>
            <Field label="勤務開始">
              <TimeSelect value={form.workStart} onChange={(v) => updateField("workStart", v)} options={WORK_TIME_OPTIONS} disabled={!canEditFields} />
            </Field>
            <Field label="勤務終了">
              <TimeSelect value={form.workEnd} onChange={(v) => updateField("workEnd", v)} options={WORK_TIME_OPTIONS} disabled={!canEditFields} />
            </Field>
            <Field label="休憩時間">
              <TimeSelect value={form.breakTime} onChange={(v) => updateField("breakTime", v)} options={BREAK_TIME_OPTIONS} disabled={!canEditFields} />
            </Field>
          </div>

          <Field label="勤務時間（自動計算・手入力で上書き可）">
            <input
              type="text"
              inputMode="decimal"
              value={form.workHours}
              onChange={(e) => setForm((f) => ({ ...f, workHours: e.target.value, hoursOverride: true }))}
              placeholder="0.0"
              disabled={!canEditFields}
              className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] disabled:opacity-60"
            />
          </Field>

          <Field label="コメント">
            <div className="flex flex-wrap gap-2 mb-3">
              {PRESET_TAGS.map((tag) => {
                const active = activeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`text-[14px] px-3.5 py-2 rounded-full border transition-colors ${
                      active
                        ? "bg-[#FFB454] border-[#FFB454] text-[#12151A] font-medium"
                        : "border-[#2A3140] text-[#8B93A1] active:border-[#FFB454]"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
            <textarea
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="タグをタップ、または自由に入力"
              rows={3}
              className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-[17px] text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] resize-none"
            />
          </Field>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              className="flex-1 flex items-center justify-center gap-2 bg-[#FFB454] text-[#12151A] font-medium text-lg py-5 rounded-xl active:bg-[#FFC578] transition-colors"
            >
              <Save size={20} />
              {saveState === "saved" ? "保存しました" : saveState === "error" ? "保存に失敗しました" : "この日を保存"}
            </button>
            {form.id && (
              <button
                onClick={() => setConfirmDeleteId(form.id)}
                className="px-6 rounded-xl border border-[#2A3140] text-[#7C8496] active:border-[#FF6B57] active:text-[#FF6B57] transition-colors"
                aria-label="削除"
              >
                <Trash2 size={22} />
              </button>
            )}
          </div>
        </div>

        {/* Monthly total */}
        <div className="mx-5 mt-8">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-2">MONTHLY TOTAL</div>
          <div className="rounded-2xl bg-[#181D25] border border-[#232A36] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#232A36]">
              <button
                onClick={() => setPeriodAnchor((a) => shiftPeriod(a, -1))}
                className="p-1.5 -ml-1.5 text-[#7C8496] active:text-[#6EE7A8] transition-colors"
                aria-label="前の期間"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="font-meter text-sm font-medium">
                {periodStartLbl.m}/{periodStartLbl.d}
                <span className="text-[#7C8496] mx-1.5">〜</span>
                {periodEndLbl.m}/{periodEndLbl.d}
                <span className="text-[#7C8496] text-[11px] ml-1.5">締め</span>
              </div>
              <button
                onClick={() => setPeriodAnchor((a) => shiftPeriod(a, 1))}
                className="p-1.5 -mr-1.5 text-[#7C8496] active:text-[#6EE7A8] transition-colors"
                aria-label="次の期間"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div className="border-l-4 border-[#6EE7A8] px-5 py-4">
              <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">合計売上</div>
              <div
                className="font-meter font-bold text-[#8FF0C0] mt-1 leading-none break-all"
                style={{ fontSize: "clamp(1.7rem, 7vw, 2.3rem)" }}
              >
                ¥{yen(periodTotals.sales)}
              </div>
            </div>
            <div className="grid grid-cols-3 border-t border-[#232A36]">
              <div className="px-4 py-3 border-r border-[#232A36] min-w-0">
                <div className="text-[10px] text-[#7C8496] tracking-wide">合計チップ</div>
                <div className="font-meter text-base font-medium mt-0.5 break-all">¥{yen(periodTotals.tip)}</div>
              </div>
              <div className="px-4 py-3 border-r border-[#232A36] min-w-0">
                <div className="text-[10px] text-[#7C8496] tracking-wide">合計回数</div>
                <div className="font-meter text-base font-medium mt-0.5">{periodTotals.count}</div>
              </div>
              <div className="px-4 py-3 min-w-0">
                <div className="text-[10px] text-[#7C8496] tracking-wide">出勤日数</div>
                <div className="font-meter text-base font-medium mt-0.5">{periodTotals.days}日</div>
              </div>
            </div>
            {periodTotals.hours > 0 && (
              <div className="px-4 py-2.5 border-t border-[#232A36] text-[12px] text-[#7C8496] font-meter">
                合計勤務時間 {(Math.round(periodTotals.hours * 10) / 10).toFixed(1)}h
              </div>
            )}
          </div>
        </div>

        {/* History */}
        <div className="mx-5 mt-8">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-2">HISTORY</div>
          {sortedEntries.length === 0 ? (
            <div className="text-[13px] text-[#7C8496] border border-dashed border-[#2A3140] rounded-xl px-4 py-6 text-center">
              まだ記録がありません。今日の分を入力しましょう。
            </div>
          ) : (
            <div className="space-y-2">
              {sortedEntries.map((entry) => {
                const label = fmtDateLabel(entry.date);
                const entryStatus = getEffectiveDayStatus(entry.date, entry);
                const isSelected = entry.date === selectedDate;
                const statusBadgeClass =
                  entryStatus === DAY_STATUS.HOLIDAY
                    ? "bg-[#FFB454]/10 text-[#FFB454]"
                    : entryStatus === DAY_STATUS.DAYOFF
                      ? "bg-[#2A3140] text-[#8B93A1]"
                      : "bg-[#6EE7A8]/10 text-[#6EE7A8]";
                return (
                  <div
                    key={entry.id}
                    onClick={() => setSelectedDate(entry.date)}
                    className={`rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                      isSelected ? "border-[#FFB454] bg-[#1D2029]" : "border-[#232A36] bg-[#161A21] active:border-[#3A4152]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2 font-meter flex-shrink-0">
                        <span className="font-bold">
                          {label.m}/{label.d}
                        </span>
                        <span className="text-[12px] text-[#7C8496]">({label.wd})</span>
                      </div>
                      <div className="flex items-center gap-3 font-meter text-[13px] text-[#EDEFF3] min-w-0">
                        <span className={`rounded-full px-2 py-1 text-[11px] ${statusBadgeClass}`}>{getStatusLabel(entryStatus)}</span>
                        <span className="truncate">
                          ¥{yen((Number(entry.sales) || 0) + (Number(entry.salesExtra) || 0))}
                        </span>
                        {entry.workHours && <span className="text-[#7C8496] flex-shrink-0">{entry.workHours}h</span>}
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setConfirmDeleteId(entry.id);
                          }}
                          className="text-[#7C8496] active:text-[#FF6B57] p-1 flex-shrink-0"
                          aria-label="削除"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                    {entry.notes && <div className="text-[12px] text-[#8B93A1] mt-1 truncate">{entry.notes}</div>}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Data management */}
        <div className="mx-5 mt-8">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-2">データ管理</div>
          <div className="rounded-2xl bg-[#181D25] border border-[#232A36] p-4 space-y-3">
            <button
              onClick={handleExportCsv}
              className="w-full flex items-center justify-center gap-2 bg-[#161A21] border border-[#2A3140] text-[#EDEFF3] text-[15px] py-4 rounded-xl active:border-[#FFB454] transition-colors"
            >
              <FileSpreadsheet size={18} />
              CSV書き出し
            </button>
            <button
              onClick={handleBackup}
              className="w-full flex items-center justify-center gap-2 bg-[#161A21] border border-[#2A3140] text-[#EDEFF3] text-[15px] py-4 rounded-xl active:border-[#FFB454] transition-colors"
            >
              <Download size={18} />
              バックアップ（JSON）
            </button>
            <button
              onClick={() => restoreInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 bg-[#161A21] border border-[#2A3140] text-[#EDEFF3] text-[15px] py-4 rounded-xl active:border-[#FFB454] transition-colors"
            >
              <Upload size={18} />
              バックアップから復元
            </button>
            <input ref={restoreInputRef} type="file" accept="application/json" onChange={handleRestoreFile} className="hidden" />
            <p className="text-[12px] text-[#7C8496] leading-relaxed">
              データはこの端末のブラウザ内（localStorage）にのみ保存されます。機種変更やブラウザの変更前には、必ずバックアップを取ってください。
            </p>
          </div>
        </div>
      </div>

      {/* Delete confirm */}
      {confirmDeleteId && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end justify-center z-20"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-[#1B2029] border border-[#2A3140] rounded-t-2xl w-full max-w-[560px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-display font-bold text-[15px]">この記録を削除しますか？</span>
              <button onClick={() => setConfirmDeleteId(null)} className="text-[#7C8496]">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[#7C8496] mb-4">削除すると元に戻せません。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="flex-1 py-3 rounded-lg border border-[#2A3140] text-[#EDEFF3]"
              >
                キャンセル
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                className="flex-1 py-3 rounded-lg bg-[#FF6B57] text-[#12151A] font-medium"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 bottom-6 -translate-x-1/2 bg-[#1B2029] border border-[#2A3140] text-[#EDEFF3] px-5 py-3 rounded-full text-sm z-30 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[13px] text-[#7C8496] mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function YenInput({ value, onChange, disabled = false }) {
  return (
    <div className="relative">
      <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[#7C8496] font-meter text-lg">¥</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0"
        disabled={disabled}
        className="w-full bg-[#181D25] border border-[#232A36] rounded-xl pl-9 pr-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] disabled:opacity-60"
      />
    </div>
  );
}

function TimeSelect({ value, onChange, options, disabled = false }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] disabled:opacity-60"
    >
      <option value="">--:--</option>
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}
