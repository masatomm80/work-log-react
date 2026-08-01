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
const DUTY_TAGS = [
  "日赤",
  "日赤夜①",
  "日赤夜②",
  "寝台①",
  "寝台②",
  "横関",
  "横関夜①",
  "横関夜②",
  "宿直",
  "研修",
  "貸切",
  "赤字（出勤）",
];
const PRESET_TAGS = ["日赤", "日赤夜", "寝台", "宿直", "横関", "横関夜", "早出", "明け", "点検書類提出"];
const WEATHER_OPTIONS = [
  { value: "sunny", label: "晴れ" },
  { value: "cloudy", label: "くもり" },
  { value: "rain", label: "雨" },
  { value: "snow", label: "雪" },
];
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const FIRST_WORKDAY = "2024-12-22";
const DAY_STATUS = {
  WORKDAY: "workday",
  DAYOFF: "dayoff",
  HOLIDAY: "holiday",
};
const WORK_TIME_OPTIONS = Array.from({ length: 24 * 2 }, (_, i) => {
  const mins = i * 30;
  const h = String(Math.floor(mins / 60)).padStart(2, "0");
  const m = String(mins % 60).padStart(2, "0");
  return `${h}:${m}`;
});
const BREAK_TIME_OPTIONS = Array.from({ length: 8 * 2 + 1 }, (_, i) => {
  const mins = i * 30;
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
function getEffectiveDayStatus(iso, record, holidayInfo = null) {
  if (holidayInfo?.isActual) return DAY_STATUS.HOLIDAY;
  if (holidayInfo?.isOverride) return record?.dayStatus || (isWorkDay(iso) ? DAY_STATUS.WORKDAY : DAY_STATUS.DAYOFF);
  if (holidayInfo?.isScheduled) return DAY_STATUS.HOLIDAY;
  if (record?.dayStatus === DAY_STATUS.HOLIDAY) return DAY_STATUS.HOLIDAY;
  return isWorkDay(iso) ? DAY_STATUS.WORKDAY : DAY_STATUS.DAYOFF;
}
function getStatusLabel(status) {
  if (status === DAY_STATUS.HOLIDAY) return "公休日";
  if (status === DAY_STATUS.DAYOFF) return "明け休み";
  return "勤務日";
}
function getPeriodRange(iso) {
  return getPeriodBounds(iso);
}
function getScheduledHolidayType(iso) {
  const base = "2026-07-21";
  const diff = diffDays(iso, base);
  if (diff % 14 !== 0) return null;
  const index = Math.floor(diff / 14);
  return index % 2 === 0 ? "black" : "red";
}
function findManualEntry(entries, date) {
  if (!Array.isArray(entries)) return null;
  return entries.find((entry) => entry.date === date) || null;
}
function getHolidayInfo(date, entries) {
  const manual = findManualEntry(entries, date);
  if (manual) {
    return {
      type: manual.holidayType || null,
      isActual: manual.dayStatus === DAY_STATUS.HOLIDAY,
      isManual: true,
      isOverride: !!manual.id,
      date,
      holidayOrigin: manual.holidayOrigin || manual.date,
      isMovedDestination: manual.holidayOrigin && manual.holidayOrigin !== manual.date,
      originalDate:
        manual.holidayOrigin && manual.holidayOrigin !== manual.date ? manual.holidayOrigin : undefined,
    };
  }
  const scheduledType = getScheduledHolidayType(date);
  if (!scheduledType) return null;
  return {
    type: scheduledType,
    isActual: false,
    isScheduled: true,
    date,
    holidayOrigin: null,
  };
}
function getMonthlyLogEntryType(entry, holidayInfo) {
  if (!entry || !entry.date) return "empty";
  const entryStatus = getEffectiveDayStatus(entry.date, entry, holidayInfo);
  if (holidayInfo?.isMovedFrom) return "holiday";
  if (entryStatus === DAY_STATUS.DAYOFF) return "dayoff";
  if (entryStatus === DAY_STATUS.HOLIDAY) return "holiday";
  if (isWorkedEntry(entry)) return "worked";
  if (hasMonthlyLogContents(entry)) return "scheduled";
  return "empty";
}
function getHolidayLabel(entry, holidayInfo) {
  if (holidayInfo?.isMovedFrom) {
    if (holidayInfo.type === "black") return "黒字公休日（移動済み）";
    if (holidayInfo.type === "red") return "赤字公休日（移動済み）";
    return "公休日（移動済み）";
  }
  if (holidayInfo?.isMovedDestination || holidayInfo?.isScheduled) {
    if (holidayInfo.type === "black") return "黒字公休日";
    if (holidayInfo.type === "red") return "赤字公休日";
    return "公休日";
  }
  if (!entry) return "公休日";
  switch (entry.holidayType) {
    case "black":
      return "黒字公休日";
    case "red":
      return "赤字公休日";
    case "paid":
      return "有給休暇";
    default:
      return "公休日";
  }
}
function isWorkedEntry(entry) {
  if (!entry || !entry.date) return false;
  const sales = Number(entry.sales || 0);
  const isPastOrToday = entry.date <= todayISO();
  return sales > 0 && isPastOrToday;
}
function hasMonthlyLogContents(entry) {
  if (!entry) return false;
  if (Array.isArray(entry.dutyTags) && entry.dutyTags.length > 0) return true;
  if (entry.notes) return true;
  if (entry.holidayType) return true;
  if (entry.sales || entry.salesExtra || entry.tip || entry.count || entry.handRaisedCount || entry.appRideCount || entry.totalDistance || entry.occupiedDistance || entry.condition || (Array.isArray(entry.weather) && entry.weather.length) || entry.workStart || entry.workEnd || entry.breakTime || entry.workHours) {
    return true;
  }
  return false;
}
function getNoteSummary(notes, maxLength = 40) {
  if (!notes) return "";
  const normalized = String(notes).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength).trimEnd()}…`;
}
function getRecordFormatFromDate(date) {
  if (!date) return "current";
  return date >= "2024-12-21" && date <= "2026-07-30" ? "legacy" : "current";
}
function inferRecordFormat(entry) {
  if (!entry) return "current";
  if (entry.recordFormat) return entry.recordFormat;
  return getRecordFormatFromDate(entry.date);
}
function ensureRecordFormat(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const recordFormat = entry.recordFormat || inferRecordFormat(entry);
  const dutyTags = Array.isArray(entry.dutyTags) ? entry.dutyTags : [];
  return { ...entry, recordFormat, dutyTags };
}
function isLegacyRecord(entry) {
  return inferRecordFormat(entry) === "legacy";
}
function isCurrentRecord(entry) {
  return inferRecordFormat(entry) === "current";
}
function hasFormData(form) {
  return Boolean(
    form.sales ||
      form.salesExtra ||
      form.tip ||
      form.count ||
      form.handRaisedCount ||
      form.appRideCount ||
      form.totalDistance ||
      form.occupiedDistance ||
      form.condition ||
      (Array.isArray(form.weather) && form.weather.length) ||
      form.workStart ||
      form.workEnd ||
      form.breakTime ||
      form.workHours ||
      form.notes
  );
}
function getConditionLabel(condition) {
  switch (condition) {
    case "good":
      return "◉ 良";
    case "normal":
      return "○ 並";
    case "bad":
      return "▲ 悪";
    default:
      return "";
  }
}
function formatOccupancyRate(totalDistance, occupiedDistance) {
  const total = Number(totalDistance);
  const occupied = Number(occupiedDistance);
  if (!Number.isFinite(total) || !Number.isFinite(occupied) || total <= 0) return "--";
  const rate = (occupied / total) * 100;
  if (!Number.isFinite(rate)) return "--";
  return `${rate.toFixed(1)}%`;
}
function formatAveragePrice(sales, count) {
  const salesValue = Number(sales) || 0;
  const countValue = Number(count) || 0;
  if (!countValue) return "--";
  const average = Math.round(salesValue / countValue);
  if (!Number.isFinite(average)) return "--";
  return `¥${average.toLocaleString("ja-JP")}`;
}
function formatDistanceValue(value) {
  if (value === "" || value === null || value === undefined) return "--";
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return "--";
  return `${numeric.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}km`;
}
function fmtDateLabel(iso) {
  if (!iso) return { m: 0, d: 0, wd: "" };
  const dt = parseISO(iso);
  const [, m, d] = iso.split("-").map(Number);
  return { m, d, wd: WEEKDAY_JA[dt.getDay()] };
}
function getWeekdayBadgeClass(weekday) {
  switch (weekday) {
    case "土":
      return "border-[#7CB5FF]/25 bg-[#7CB5FF]/10 text-[#7CB5FF]";
    case "日":
      return "border-[#FF8A80]/25 bg-[#FF8A80]/10 text-[#FF8A80]";
    default:
      return "border-[#2A3140] bg-[#181D25] text-[#C0C8D4]";
  }
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
function getMonthlyTarget(iso) {
  const dt = parseISO(iso);
  const month = dt.getMonth() + 1;
  const day = dt.getDate();
  if (month === 12 && day >= 21) return 850000;
  if (month === 1 && day <= 20) return 850000;
  if ((month === 1 && day >= 21) || (month === 2 && day <= 20)) return 750000;
  if ((month === 2 && day >= 21) || (month === 3 && day <= 20)) return 750000;
  return 800000;
}
function formatPeriodLabel(startIso, endIso) {
  const start = parseISO(startIso);
  const end = parseISO(endIso);
  const fmt = (dt) => `${dt.getMonth() + 1}/${dt.getDate()}`;
  return `${fmt(start)}〜${fmt(end)}`;
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
    if (!Array.isArray(parsed)) return [];
    const normalized = parsed.map(ensureRecordFormat);
    const needsPersist = normalized.some((entry, index) =>
      !entry.recordFormat ||
      entry.recordFormat !== parsed[index]?.recordFormat ||
      !Array.isArray(parsed[index]?.dutyTags)
    );
    if (needsPersist) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    }
    return normalized;
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
function getSalesTargetForWeekday(weekday) {
  return weekday === "金" || weekday === "土" ? 70000 : 60000;
}

const emptyForm = (date) => ({
  id: null,
  date,
  sales: "",
  salesExtra: "",
  tip: "",
  count: "",
  handRaisedCount: "",
  appRideCount: "",
  totalDistance: "",
  occupiedDistance: "",
  condition: "",
  weather: [],
  workStart: "",
  workEnd: "",
  breakTime: "",
  workHours: "",
  hoursOverride: false,
  notes: "",
  dutyTags: [],
  recordFormat: getRecordFormatFromDate(date),
  dayStatus: getEffectiveDayStatus(date, null),
  holidayType: null,
  holidayOrigin: null,
});

function normalizeForm(date, existing, holidayInfo = null) {
  const entry = ensureRecordFormat(existing || {});
  const holidayType = entry.dayStatus === DAY_STATUS.HOLIDAY ? entry.holidayType || holidayInfo?.type : entry.holidayType || null;
  return {
    ...emptyForm(date),
    ...entry,
    weather: Array.isArray(entry?.weather) ? entry.weather : [],
    dayStatus: getEffectiveDayStatus(date, entry, holidayInfo),
    holidayType,
    holidayOrigin: entry.holidayOrigin || null,
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
  const [entries, setEntries] = useState(() => loadEntries().map(ensureRecordFormat));
  const [saveState, setSaveState] = useState("idle"); // idle | saved | error
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [form, setForm] = useState(emptyForm(todayISO()));
  const [periodAnchor, setPeriodAnchor] = useState(todayISO());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [toast, setToast] = useState(null);
  const [holidayMoveTarget, setHolidayMoveTarget] = useState("");
  const [dutyStampOpen, setDutyStampOpen] = useState(false);
  const dateInputRef = useRef(null);
  const restoreInputRef = useRef(null);
  const toastTimer = useRef(null);

  const currentEntries = useMemo(() => entries.filter(isCurrentRecord), [entries]);
  const legacyEntries = useMemo(() => entries.filter(isLegacyRecord), [entries]);
  const holidayInfo = useMemo(() => getHolidayInfo(selectedDate, entries), [selectedDate, entries]);
  const activeRecordFormat = form.recordFormat || getRecordFormatFromDate(selectedDate);
  const isLegacyMode = activeRecordFormat === "legacy";
  const isCurrentMode = activeRecordFormat === "current";

  useEffect(() => {
    const existing = entries.find((e) => e.date === selectedDate);
    setForm(existing ? normalizeForm(selectedDate, existing, holidayInfo) : normalizeForm(selectedDate, null, holidayInfo));
  }, [selectedDate, entries, holidayInfo]);

  const monthlyLogRange = useMemo(() => getPeriodRange(selectedDate), [selectedDate]);
  const monthlyLogEntries = useMemo(() => {
    const byDate = entries.reduce((acc, entry) => {
      if (entry?.date) acc[entry.date] = ensureRecordFormat(entry);
      return acc;
    }, {});
    const result = [];
    let cursor = monthlyLogRange.start;
    while (cursor <= monthlyLogRange.end) {
      const holidayInfo = getHolidayInfo(cursor, entries);
      const entry = byDate[cursor] || { id: `placeholder-${cursor}`, date: cursor };
      const normalized = ensureRecordFormat(entry);
      const type = getMonthlyLogEntryType(normalized, holidayInfo);
      if (type !== "dayoff" && type !== "empty") {
        result.push({ ...normalized, holidayInfo, monthlyLogType: type });
      }
      cursor = addDays(cursor, 1);
    }
    return result.sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [entries, monthlyLogRange]);

  const periodBounds = useMemo(() => getPeriodBounds(periodAnchor), [periodAnchor]);
  const periodEntries = useMemo(
    () => entries.filter((e) => e.date >= periodBounds.start && e.date <= periodBounds.end),
    [entries, periodBounds]
  );
  const selectedDutyTags = Array.isArray(form.dutyTags) ? form.dutyTags : [];
  const dutyStampSummary = selectedDutyTags.length > 0 ? selectedDutyTags.join("　") : "未設定";
  const saveFormEntry = (formToSave) => {
    const id = formToSave.id || `${formToSave.date}-${Date.now()}`;
    const recordFormat = inferRecordFormat(formToSave);
    const record = {
      ...formToSave,
      dayStatus: formToSave.dayStatus || getEffectiveDayStatus(formToSave.date, formToSave, getHolidayInfo(formToSave.date, entries)),
      recordFormat,
      id,
      holidayOrigin:
        formToSave.dayStatus === DAY_STATUS.HOLIDAY && formToSave.holidayType
          ? formToSave.holidayOrigin || formToSave.date
          : undefined,
    };
    const next = entries.some((e) => e.id === id)
      ? entries.map((e) => (e.id === id ? record : e))
      : [...entries.filter((e) => e.date !== formToSave.date), record];
    setEntries(next);
    setForm(record);
    const ok = persistEntries(next);
    setSaveState(ok ? "saved" : "error");
    showToast(ok ? "保存しました" : "保存に失敗しました");
    setTimeout(() => setSaveState("idle"), 1200);
    return ok;
  };

  const toggleDutyTag = (tag) => {
    setForm((f) => {
      const current = Array.isArray(f.dutyTags) ? f.dutyTags : [];
      const next = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
      const nextForm = { ...f, dutyTags: next };
      saveFormEntry(nextForm);
      return nextForm;
    });
  };
  const periodTotals = useMemo(
    () =>
      periodEntries.reduce(
        (acc, e) => {
          acc.sales += (Number(e.sales) || 0) + (Number(e.salesExtra) || 0);
          acc.tip += Number(e.tip) || 0;
          acc.count += Number(e.count) || 0;
          acc.hours += Number(e.workHours) || 0;
          if (isWorkedEntry(e)) {
            acc.days += 1;
          }
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

  const handleGoToToday = () => {
    const today = todayISO();
    setSelectedDate(today);
    setPeriodAnchor(today);
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

  const isActualHolidayEntry = Boolean(holidayInfo?.isActual);
  const isMovedDestination = Boolean(holidayInfo?.isMovedDestination);
  const isMovedFrom = Boolean(holidayInfo?.isMovedFrom);
  const isScheduledHoliday = Boolean(holidayInfo?.isScheduled);
  const allowHolidayTypeChange = Boolean(isMovedFrom || form.dayStatus === DAY_STATUS.HOLIDAY);
  const holidayToggleDisabled = Boolean(holidayInfo?.isScheduled || holidayInfo?.isMovedDestination);

  const moveHoliday = () => {
    if (!isScheduledHoliday || isMovedFrom) {
      showToast("この日は移動対象の公休ではありません。");
      return;
    }
    if (!holidayMoveTarget) {
      showToast("移動先の日付を選択してください。");
      return;
    }
    if (holidayMoveTarget === selectedDate) {
      showToast("移動先は移動元と同じ日付にできません。");
      return;
    }
    const targetHolidayInfo = getHolidayInfo(holidayMoveTarget, entries);
    if (targetHolidayInfo?.isActual || targetHolidayInfo?.isScheduled || targetHolidayInfo?.isMovedDestination) {
      showToast("移動先はすでに公休日になっています。");
      return;
    }
    const originalDate = selectedDate;
    const movedDate = holidayMoveTarget;
    const transfer = {
      originalDate,
      movedDate,
      holidayType: holidayInfo.type,
      movedAt: new Date().toISOString(),
    };
    const originalEntry = entries.find((entry) => entry.date === originalDate);
    const updatedOriginal = originalEntry
      ? {
          ...ensureRecordFormat(originalEntry),
          holidayType: null,
          holidayTransfer: transfer,
          dayStatus: getEffectiveDayStatus(originalDate, { ...originalEntry, dayStatus: DAY_STATUS.WORKDAY, holidayType: null }),
        }
      : {
          ...emptyForm(originalDate),
          id: `${originalDate}-${Date.now()}-orig`,
          holidayType: null,
          holidayTransfer: transfer,
          dayStatus: getEffectiveDayStatus(originalDate, null),
        };
    const next = entries.filter((entry) => entry.date !== originalDate && entry.date !== movedDate);
    const existingTarget = entries.find((entry) => entry.date === movedDate);
    const targetEntry = existingTarget
      ? {
          ...ensureRecordFormat(existingTarget),
          dayStatus: DAY_STATUS.HOLIDAY,
          holidayType: holidayInfo.type,
          holidayOrigin: originalDate,
          holidayTransfer: transfer,
        }
      : {
          ...emptyForm(movedDate),
          id: `${movedDate}-${Date.now()}-dest`,
          dayStatus: DAY_STATUS.HOLIDAY,
          holidayType: holidayInfo.type,
          holidayOrigin: originalDate,
          holidayTransfer: transfer,
        };
    const merged = [...next, updatedOriginal, targetEntry].map(ensureRecordFormat);
    setEntries(merged);
    persistEntries(merged);
    setHolidayMoveTarget("");
    setSelectedDate(movedDate);
    showToast("公休日を移動しました。移動先でコメントを保存してください。");
  };

  const undoHolidayMove = () => {
    if (!isMovedDestination) {
      showToast("この日付は移動先の公休ではありません。");
      return;
    }
    const movedDate = selectedDate;
    const targetEntry = entries.find((entry) => entry.date === movedDate && entry.holidayTransfer);
    if (!targetEntry) {
      showToast("解除対象の移動データが見つかりませんでした。");
      return;
    }
    const originalDate = targetEntry.holidayTransfer.originalDate;
    const next = entries.map((entry) => {
      if (entry.date === movedDate) {
        const cleared = { ...ensureRecordFormat(entry) };
        delete cleared.holidayTransfer;
        cleared.holidayType = null;
        cleared.dayStatus = getEffectiveDayStatus(movedDate, cleared);
        return cleared;
      }
      if (entry.date === originalDate) {
        const cleared = { ...ensureRecordFormat(entry) };
        delete cleared.holidayTransfer;
        cleared.holidayType = null;
        cleared.dayStatus = getEffectiveDayStatus(originalDate, cleared);
        return cleared;
      }
      return entry;
    });
    const persisted = next.map(ensureRecordFormat);
    setEntries(persisted);
    persistEntries(persisted);
    setSelectedDate(originalDate);
    showToast("公休日の移動を解除しました。");
  };

  const handleSave = () => {
    const isLegacyForm = isLegacyRecord(form);
    const handRaisedValue = Number(form.handRaisedCount) || 0;
    const appRideValue = Number(form.appRideCount) || 0;
    const countValue = Number(form.count) || 0;
    const occupiedValue = Number(form.occupiedDistance) || 0;
    const totalDistanceValue = Number(form.totalDistance) || 0;

    if (!isLegacyForm) {
      if (handRaisedValue > countValue) {
        showToast("手上げ乗車回数は通常の回数を超えません");
        return;
      }
      if (appRideValue > countValue) {
        showToast("アプリ乗車回数は通常の回数を超えません");
        return;
      }
      if (handRaisedValue + appRideValue > countValue) {
        showToast("手上げ乗車回数とアプリ乗車回数の合計が通常の回数を超えます");
        return;
      }
      if (occupiedValue > totalDistanceValue) {
        showToast("営業距離は走行距離を超えません");
        return;
      }
    }

    const id = form.id || `${form.date}-${Date.now()}`;
    const recordFormat = inferRecordFormat(form);
    const record = {
      ...form,
      dayStatus: form.dayStatus || getEffectiveDayStatus(form.date, form, getHolidayInfo(form.date, entries)),
      recordFormat,
      id,
      holidayOrigin:
        form.dayStatus === DAY_STATUS.HOLIDAY && form.holidayType
          ? form.holidayOrigin || form.date
          : undefined,
    };
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
    downloadBlob(csv, "text/csv;charset=utf-8", `M's Taxi AI_${todayISO()}.csv`);
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
      imported = imported.map((r) => {
        if (!r || !r.date) return r;
        const normalized = ensureRecordFormat(r);
        if (!normalized.id) normalized.id = `${normalized.date}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        return normalized;
      });
      const validCount = imported.filter((r) => r && r.date).length;
      const proceed = window.confirm(
        `${validCount}件のデータを読み込みます。同じ日付の既存データは上書きされます。よろしいですか？`
      );
      if (!proceed) return;

      const byDate = {};
      entries.forEach((en) => (byDate[en.date] = en));
      imported.forEach((r) => {
        if (r && r.date) {
          byDate[r.date] = r;
        }
      });
      const merged = Object.values(byDate).map(ensureRecordFormat);
      setEntries(merged);
      persistEntries(merged);
      showToast("復元しました");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const { m, d, wd } = fmtDateLabel(selectedDate);
  const effectiveStatus = getEffectiveDayStatus(selectedDate, form, holidayInfo);
  const isWorkday = effectiveStatus === DAY_STATUS.WORKDAY;
  const isHoliday = effectiveStatus === DAY_STATUS.HOLIDAY;
  const isDayOff = effectiveStatus === DAY_STATUS.DAYOFF;
  const isTodaySelected = selectedDate === todayISO();
  const statusLabel = getStatusLabel(effectiveStatus);
  const currentSalesTotal = (Number(form.sales) || 0) + (Number(form.salesExtra) || 0);
  const totalSales = currentSalesTotal;
  const weekdayTarget = getSalesTargetForWeekday(wd);
  const targetRemaining = currentSalesTotal >= weekdayTarget ? 0 : Math.max(weekdayTarget - currentSalesTotal, 0);
  const achievementRate = weekdayTarget > 0 ? (currentSalesTotal / weekdayTarget) * 100 : 0;
  const activeTags = form.notes ? form.notes.split(/[\s、,　]+/).filter(Boolean) : [];
  const periodStartLbl = fmtDateLabel(periodBounds.start);
  const periodEndLbl = fmtDateLabel(periodBounds.end);
  const monthlyTarget = getMonthlyTarget(selectedDate);
  const monthlyPeriodLabel = formatPeriodLabel(periodBounds.start, periodBounds.end);
  const monthlySalesTotal = useMemo(() => {
    return periodEntries.reduce((acc, e) => {
      acc += (Number(e.sales) || 0) + (Number(e.salesExtra) || 0);
      return acc;
    }, 0);
  }, [periodEntries]);
  const monthlyRemaining = monthlySalesTotal >= monthlyTarget ? 0 : Math.max(monthlyTarget - monthlySalesTotal, 0);
  const occupancyRateDisplay = useMemo(
    () => formatOccupancyRate(form.totalDistance, form.occupiedDistance),
    [form.totalDistance, form.occupiedDistance]
  );
  const averagePriceDisplay = useMemo(() => formatAveragePrice(form.sales, form.count), [form.sales, form.count]);
  const handRaisedWarning =
    Number(form.handRaisedCount) > Number(form.count || 0) && (form.handRaisedCount !== "" || form.count !== "")
      ? "手上げ乗車回数は通常の回数を超えません。"
      : "";
  const appRideWarning =
    Number(form.appRideCount) > Number(form.count || 0) && (form.appRideCount !== "" || form.count !== "")
      ? "アプリ乗車回数は通常の回数を超えません。"
      : "";
  const rideTotalWarning =
    (Number(form.handRaisedCount) || 0) + (Number(form.appRideCount) || 0) > Number(form.count || 0) &&
    (form.handRaisedCount !== "" || form.appRideCount !== "" || form.count !== "")
      ? "手上げ乗車回数とアプリ乗車回数の合計が通常の回数を超えます。"
      : "";
  const distanceWarning =
    Number(form.occupiedDistance) > Number(form.totalDistance || 0) && (form.occupiedDistance !== "" || form.totalDistance !== "")
      ? "営業距離は走行距離を超えません。"
      : "";
  const companyRadioCountDisplay = Math.max((Number(form.count) || 0) - (Number(form.handRaisedCount) || 0) - (Number(form.appRideCount) || 0), 0);

  const setDateStatus = (status, holidayType = null) => {
    if (status === DAY_STATUS.HOLIDAY && (holidayType === "black" || holidayType === "red")) {
      if (!holidayInfo?.isScheduled && !holidayInfo?.isMovedDestination) {
        showToast("この日付では黒字公休日・赤字公休日を設定できません。自動算出された公休日を移動してください。\n");
        return;
      }
      if (holidayInfo?.isActual && holidayInfo.type !== holidayType) {
        showToast("自動算出された公休日の種類は変更できません。");
        return;
      }
    }
    setForm((f) => ({ ...f, dayStatus: status, holidayType: status === DAY_STATUS.HOLIDAY ? holidayType : null }));
  };

  const handleToggleHoliday = () => {
    if (holidayToggleDisabled) {
      showToast("自動算出された公休日はここでは切り替えできません。移動機能をご利用ください。");
      return;
    }
    if (isHoliday) {
      setDateStatus(DAY_STATUS.WORKDAY, null);
      return;
    }
    if (hasFormData(form)) {
      const proceed = window.confirm("入力済みの内容は保持したまま、公休日に切り替えますか？");
      if (!proceed) return;
    }
    setDateStatus(DAY_STATUS.HOLIDAY, null);
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
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-[#232A36] bg-[#161A21] sticky top-0 z-10 max-w-[560px] mx-auto">
        <button
          onClick={() => setSelectedDate((s) => addDays(s, -1))}
          className="p-2 -ml-2 text-[#7C8496] active:text-[#FFB454] transition-colors"
          aria-label="前の日"
        >
          <ChevronLeft size={20} />
        </button>
        {!isTodaySelected ? (
          <button
            onClick={handleGoToToday}
            className="rounded-full border border-[#2A3140] px-3 py-1.5 text-[11px] text-[#C0C8D4] active:border-[#FFB454] active:text-[#FFB454]"
          >
            今日へ戻る
          </button>
        ) : null}
        <button
          className="flex items-baseline gap-2 relative flex-1 justify-center"
          onClick={() => dateInputRef.current?.showPicker?.() || dateInputRef.current?.click()}
        >
          <span className="font-meter text-lg font-bold">
            {m}
            <span className="text-[#7C8496] mx-0.5">/</span>
            {d}
          </span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getWeekdayBadgeClass(wd)}`}>
            {wd}
          </span>
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
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] tracking-[0.2em] text-[#7C8496] font-meter">DATE STATUS</div>
                <div className="font-medium text-[#EDEFF3] mt-1">{statusLabel}</div>
                {isMovedFrom ? (
                  <div className="text-[12px] text-[#FFB454] mt-1">本来の公休・移動済み</div>
                ) : null}
                {isMovedDestination ? (
                  <div className="text-[12px] text-[#6EE7A8] mt-1">元の公休: {holidayInfo.originalDate}</div>
                ) : null}
              </div>
            </div>
            {(isWorkday || isHoliday) ? (
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "勤務日", status: DAY_STATUS.WORKDAY, holidayType: null },
                  { label: "黒字公休日", status: DAY_STATUS.HOLIDAY, holidayType: "black" },
                  { label: "赤字公休日", status: DAY_STATUS.HOLIDAY, holidayType: "red" },
                  { label: "有給休暇", status: DAY_STATUS.HOLIDAY, holidayType: "paid" },
                ].map((option) => {
                  const selected =
                    option.status === DAY_STATUS.WORKDAY
                      ? effectiveStatus === DAY_STATUS.WORKDAY
                      : effectiveStatus === DAY_STATUS.HOLIDAY && form.holidayType === option.holidayType;
                  return (
                    <button
                      key={`${option.status}-${option.holidayType || "default"}`}
                      type="button"
                      onClick={() => setDateStatus(option.status, option.holidayType)}
                      className={`rounded-full border px-3 py-2 text-sm transition-colors text-left ${
                        selected
                          ? "border-[#FFB454] bg-[#FFB454]/10 text-[#FFB454]"
                          : "border-[#2A3140] text-[#8B93A1] hover:border-[#FFB454]"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            {isScheduledHoliday ? (
              <div className="mt-4 rounded-2xl border border-[#232A36] bg-[#171C24] px-4 py-4">
                <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">公休日移動</div>
                <div className="mt-2 text-[13px] text-[#EDEFF3]">この日は自動算出された{holidayInfo.type === "black" ? "黒字" : "赤字"}公休です。</div>
                <div className="mt-3 grid gap-3">
                  <label className="text-[12px] text-[#7C8496]">移動先の日付</label>
                  <input
                    type="date"
                    min={FIRST_WORKDAY}
                    value={holidayMoveTarget}
                    onChange={(e) => setHolidayMoveTarget(e.target.value)}
                    className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454]"
                  />
                  <button
                    type="button"
                    onClick={moveHoliday}
                    className="w-full rounded-xl bg-[#6EE7A8] py-4 text-[#12151A] font-medium active:bg-[#7DF3B6] transition-colors"
                  >
                    公休日を移動する
                  </button>
                </div>
              </div>
            ) : null}
            {isMovedDestination ? (
              <div className="mt-4 rounded-2xl border border-[#232A36] bg-[#171C24] px-4 py-4">
                <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">移動先の公休日</div>
                <div className="mt-2 text-[13px] text-[#EDEFF3]">元の公休日: {holidayInfo.originalDate} ({holidayInfo.type === "black" ? "黒字" : "赤字"})</div>
                <button
                  type="button"
                  onClick={undoHolidayMove}
                  className="mt-3 w-full rounded-xl bg-[#FF6B57] py-4 text-[#12151A] font-medium active:bg-[#FF8A80] transition-colors"
                >
                  移動を解除する
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {isWorkday ? (
          <>
            <div className="mx-5 mt-3 rounded-2xl border border-[#232A36] bg-[#171C24] overflow-hidden">
              <button
                type="button"
                onClick={() => setDutyStampOpen((open) => !open)}
                className="w-full flex items-center justify-between gap-2 px-4 py-4 text-left"
              >
                <div>
                  <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">DUTY STAMP</div>
                  <div className="text-[12px] text-[#8B93A1] mt-1">今日の勤務予定・当番</div>
                </div>
                <div className="text-[13px] text-[#7C8496]">{dutyStampOpen ? "−" : "+"}</div>
              </button>
              {dutyStampOpen ? (
                <div className="border-t border-[#232A36] px-4 py-4 space-y-3 bg-[#171C24]">
                  <div className="grid grid-cols-2 gap-2">
                    {DUTY_TAGS.map((tag) => {
                      const selected = selectedDutyTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleDutyTag(tag)}
                          className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                            selected
                              ? "border-[#FFB454] bg-[#FFB454] text-[#12151A]"
                              : "border-[#2A3140] text-[#8B93A1] hover:border-[#FFB454]"
                          }`}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="border-t border-[#232A36] px-4 py-3 text-sm text-[#EDEFF3]">
                  {dutyStampSummary}
                </div>
              )}
            </div>
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
                  <div className="mt-3 space-y-2 text-[#7C8496] text-[12px] font-meter">
                    <div className="text-[10px] uppercase tracking-[0.25em] text-[#8B93A1]">内訳</div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-4">
                        <span>メーター</span>
                        <span className="font-medium text-[#EDEFF3]">¥{yen(form.sales)}</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span>メーター外</span>
                        <span className="font-medium text-[#EDEFF3]">¥{yen(form.salesExtra)}</span>
                      </div>
                    </div>
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
              {!isLegacyMode ? (
                <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-4">
                  <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">朝入力</div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="体調">
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "good", label: "◉ 良", className: "border-[#6EE7A8]/40 text-[#6EE7A8]" },
                          { value: "normal", label: "○ 並", className: "border-[#FFB454]/40 text-[#FFB454]" },
                          { value: "bad", label: "▲ 悪", className: "border-[#FF6B57]/40 text-[#FF6B57]" },
                        ].map((option) => {
                          const active = form.condition === option.value;
                          return (
                            <button
                              key={option.value}
                              onClick={() => updateField("condition", option.value)}
                              className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                                active ? `${option.className} bg-[#1F242C]` : "border-[#2A3140] text-[#8B93A1]"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    <Field label="天気">
                      <div className="flex flex-wrap gap-2">
                        {WEATHER_OPTIONS.map((option) => {
                          const active = Array.isArray(form.weather) && form.weather.includes(option.value);
                          return (
                            <button
                              key={option.value}
                              onClick={() => {
                                setForm((f) => {
                                  const current = Array.isArray(f.weather) ? f.weather : [];
                                  const next = current.includes(option.value)
                                    ? current.filter((item) => item !== option.value)
                                    : [...current, option.value];
                                  return { ...f, weather: next };
                                });
                              }}
                              className={`rounded-full border px-3 py-2 text-sm transition-colors ${
                                active ? "border-[#FFB454] bg-[#FFB454]/10 text-[#FFB454]" : "border-[#2A3140] text-[#8B93A1]"
                              }`}
                            >
                              {option.label}
                            </button>
                          );
                        })}
                      </div>
                    </Field>
                    <Field label="勤務開始">
                      <TimeSelect value={form.workStart} onChange={(v) => updateField("workStart", v)} options={WORK_TIME_OPTIONS} />
                    </Field>
                  </div>
                </div>
              ) : null}

              {!isLegacyMode ? (
                <Field label="コメント">
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    placeholder="自由に入力"
                    rows={3}
                    className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-[17px] text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] resize-none"
                  />
                </Field>
              ) : null}

              <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-4">
                <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">営業データ</div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="売上">
                    <YenInput value={form.sales} onChange={(v) => updateField("sales", v)} disabled={false} />
                  </Field>
                  <Field label="メーター外売上">
                    <YenInput value={form.salesExtra} onChange={(v) => updateField("salesExtra", v)} disabled={false} />
                  </Field>
                  <Field label="チップ">
                    <YenInput value={form.tip} onChange={(v) => updateField("tip", v)} disabled={false} />
                  </Field>
                  <Field label="回数（メーター外は含まず）">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={form.count}
                      onChange={(e) => updateField("count", e.target.value)}
                      placeholder="0"
                      className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454]"
                    />
                  </Field>
                  {!isLegacyMode ? (
                    <>
                      <Field label="手上げ乗車回数" helperText="通常の回数に含まれる手上げ乗車の回数" warning={handRaisedWarning}>
                        <NumberInput
                          value={form.handRaisedCount}
                          onChange={(v) => updateField("handRaisedCount", v)}
                          min={0}
                          step="1"
                          placeholder="0"
                        />
                      </Field>
                      <Field label="アプリ乗車回数" helperText="通常の回数に含まれるアプリ乗車の回数" warning={appRideWarning}>
                        <NumberInput
                          value={form.appRideCount}
                          onChange={(v) => updateField("appRideCount", v)}
                          min={0}
                          step="1"
                          placeholder="0"
                        />
                      </Field>
                      <Field label="会社無線配車回数" helperText="自動計算" warning={rideTotalWarning}>
                        <div className="rounded-xl border border-[#232A36] bg-[#181D25] px-4 py-5 text-xl font-meter text-[#EDEFF3]">
                          {companyRadioCountDisplay}
                        </div>
                      </Field>
                      <Field label="走行距離" helperText="km" warning={distanceWarning}>
                        <NumberInput
                          value={form.totalDistance}
                          onChange={(v) => updateField("totalDistance", v)}
                          min={0}
                          step="0.1"
                          placeholder="0"
                          unit="km"
                        />
                      </Field>
                      <Field label="営業距離" helperText="km" warning={distanceWarning}>
                        <NumberInput
                          value={form.occupiedDistance}
                          onChange={(v) => updateField("occupiedDistance", v)}
                          min={0}
                          step="0.1"
                          placeholder="0"
                          unit="km"
                        />
                      </Field>
                    </>
                  ) : null}
                </div>
              </div>

              {!isLegacyMode ? (
                <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-4">
                  <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">営業効率</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#232A36] bg-[#171C24] px-3 py-3">
                      <div className="text-[10px] text-[#7C8496]">走行距離</div>
                      <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">{formatDistanceValue(form.totalDistance)}</div>
                    </div>
                    <div className="rounded-xl border border-[#232A36] bg-[#171C24] px-3 py-3">
                      <div className="text-[10px] text-[#7C8496]">営業距離</div>
                      <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">{formatDistanceValue(form.occupiedDistance)}</div>
                    </div>
                    <div className="rounded-xl border border-[#232A36] bg-[#171C24] px-3 py-3">
                      <div className="text-[10px] text-[#7C8496]">乗車率</div>
                      <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">{occupancyRateDisplay}</div>
                    </div>
                    <div className="rounded-xl border border-[#232A36] bg-[#171C24] px-3 py-3">
                      <div className="text-[10px] text-[#7C8496]">平均単価</div>
                      <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">{averagePriceDisplay}</div>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-4">
                {!isLegacyMode ? (
                  <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">終了時</div>
                ) : null}
                {!isLegacyMode ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="休憩時間">
                      <TimeSelect value={form.breakTime} onChange={(v) => updateField("breakTime", v)} options={BREAK_TIME_OPTIONS} />
                    </Field>
                    <Field label="勤務終了">
                      <TimeSelect value={form.workEnd} onChange={(v) => updateField("workEnd", v)} options={WORK_TIME_OPTIONS} />
                    </Field>
                  </div>
                ) : null}

                <Field label="勤務時間">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.workHours}
                    onChange={(e) => setForm((f) => ({ ...f, workHours: e.target.value, hoursOverride: true }))}
                    placeholder="0.0"
                    className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454]"
                  />
                </Field>

                {isLegacyMode ? (
                  <Field label="コメント">
                    <textarea
                      value={form.notes}
                      onChange={(e) => updateField("notes", e.target.value)}
                      placeholder="自由に入力"
                      rows={3}
                      className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-[17px] text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] resize-none"
                    />
                  </Field>
                ) : null}

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
            </div>
          </>
        ) : (
          <div className="mx-5 mt-5 space-y-4">
            <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-3">
              <div className="text-[12px] text-[#7C8496]">日付</div>
              <div className="font-medium text-[#EDEFF3]">{m}/{d} ({wd})</div>
            </div>
            {isHoliday ? (
              <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-3">
                <div className="text-[12px] text-[#7C8496]">勤務状態</div>
                <div className="font-medium text-[#EDEFF3]">公休日</div>
              </div>
            ) : null}
            {isHoliday ? (
              <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-[12px] text-[#7C8496]">公休日チェック</div>
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
                </div>
              </div>
            ) : null}
            <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-3">
              <div className="text-[12px] text-[#7C8496]">コメント</div>
              <textarea
                value={form.notes}
                onChange={(e) => updateField("notes", e.target.value)}
                placeholder="メモを入力"
                rows={3}
                className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-[17px] text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] resize-none"
              />
            </div>
            <button
              onClick={handleSave}
              className="w-full flex items-center justify-center gap-2 bg-[#FFB454] text-[#12151A] font-medium text-lg py-5 rounded-xl active:bg-[#FFC578] transition-colors"
            >
              <Save size={20} />
              {saveState === "saved" ? "保存しました" : saveState === "error" ? "保存に失敗しました" : "この日を保存"}
            </button>
          </div>
        )}

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
                <div className="font-meter text-base font-medium mt-0.5 leading-tight">
                  <div>{periodTotals.count}</div>
                  <div className="text-[10px] text-[#7C8496]">メーター外除く</div>
                </div>
              </div>
              <div className="px-4 py-3 min-w-0">
                <div className="text-[10px] text-[#7C8496] tracking-wide">出勤日数</div>
                <div className="font-meter text-base font-medium mt-0.5">{periodTotals.days}日</div>
              </div>
            </div>
            <div className="border-t border-[#232A36] px-4 py-3">
              <div className="text-[10px] tracking-[0.2em] text-[#7C8496] font-meter">月間売上</div>
              <div className="font-meter text-sm font-medium text-[#EDEFF3] mt-1">{monthlyPeriodLabel}</div>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-[#181D25] px-3 py-2">
                  <div className="text-[10px] text-[#7C8496]">合計</div>
                  <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">¥{yen(monthlySalesTotal)}</div>
                </div>
                <div className="rounded-xl bg-[#181D25] px-3 py-2">
                  <div className="text-[10px] text-[#7C8496]">ノルマ</div>
                  <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">¥{yen(monthlyTarget)}</div>
                </div>
                <div className="rounded-xl bg-[#181D25] px-3 py-2">
                  <div className="text-[10px] text-[#7C8496]">残額</div>
                  <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">¥{yen(monthlyRemaining)}</div>
                </div>
              </div>
            </div>
            {periodTotals.hours > 0 && (
              <div className="px-4 py-2.5 border-t border-[#232A36] text-[12px] text-[#7C8496] font-meter">
                合計勤務時間 {(Math.round(periodTotals.hours * 10) / 10).toFixed(1)}h
              </div>
            )}
          </div>
        </div>

        {/* MONTHLY LOG */}
        <div className="mx-5 mt-8">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-2">MONTHLY LOG</div>
          {monthlyLogEntries.length === 0 ? (
            <div className="text-[13px] text-[#7C8496] border border-dashed border-[#2A3140] rounded-xl px-4 py-6 text-center">
              月度の履歴がありません。
            </div>
          ) : (
            <div className="space-y-2">
              {monthlyLogEntries.map((entry) => {
                const label = fmtDateLabel(entry.date);
                const type = entry.monthlyLogType;
                const isSelected = entry.date === selectedDate;
                const badgeClasses =
                  type === "holiday"
                    ? entry.holidayInfo?.type === "red"
                      ? "bg-[#FF6B57]/10 text-[#FF6B57]"
                      : "bg-[#2F343B] text-[#D1D5DB]"
                    : type === "worked"
                      ? "bg-[#6EE7A8]/10 text-[#6EE7A8]"
                      : "bg-[#FFB454]/10 text-[#FFB454]";
                const badgeLabel =
                  type === "holiday"
                    ? getHolidayLabel(entry, entry.holidayInfo)
                    : type === "worked"
                      ? "勤務済み"
                      : "勤務前";
                const dutyTags = Array.isArray(entry.dutyTags) ? entry.dutyTags : [];
                const totalSales = Number(entry.sales) || 0;
                const totalSalesExtra = Number(entry.salesExtra) || 0;
                const noteSummary = getNoteSummary(entry.notes, 40);
                const showTopSummary = noteSummary && type !== "worked";
                return (
                  <div
                    key={entry.id}
                    onClick={() => setSelectedDate(entry.date)}
                    className={`rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                      isSelected ? "border-[#FFB454] bg-[#1D2029]" : "border-[#232A36] bg-[#161A21] active:border-[#3A4152]"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2 font-meter flex-shrink-0">
                        <span className="font-bold">
                          {label.m}/{label.d}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${getWeekdayBadgeClass(label.wd)}`}>
                          {label.wd}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 min-w-0 justify-end">
                        {showTopSummary ? (
                          <span className="truncate text-[13px] text-[#EDEFF3] max-w-[280px]">{noteSummary}</span>
                        ) : null}
                        <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${badgeClasses}`}>{badgeLabel}</span>
                      </div>
                    </div>
                    {type === "holiday" ? null : (
                      <div className="mt-3 space-y-2 text-[#EDEFF3] text-sm">
                        {dutyTags.length > 0 ? (
                          <div className="flex flex-wrap gap-2">
                            {dutyTags.map((tag) => (
                              <span key={tag} className="rounded-full border border-[#2A3140] bg-[#171C24] px-2 py-1 text-[12px] text-[#EDEFF3]">
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {type === "worked" ? (
                          <div className="flex flex-wrap gap-3 text-[#EDEFF3]">
                            <div className="rounded-2xl bg-[#171C24] px-3 py-2 min-w-[120px]">
                              <div className="text-[10px] text-[#7C8496]">売上</div>
                              <div className="mt-1 text-lg font-semibold leading-none">¥{yen(totalSales + totalSalesExtra)}</div>
                            </div>
                            {noteSummary ? (
                              <div className="rounded-2xl bg-[#171C24] px-3 py-2 min-w-[140px] flex-1">
                                <div className="text-[10px] text-[#7C8496]">コメント</div>
                                <div className="mt-1 text-sm text-[#EDEFF3] truncate">{noteSummary}</div>
                              </div>
                            ) : null}
                            {entry.workHours ? (
                              <div className="rounded-2xl bg-[#171C24] px-3 py-2 min-w-[80px]">
                                <div className="text-[10px] text-[#7C8496]">勤務時間</div>
                                <div className="mt-1 font-medium">{entry.workHours}h</div>
                              </div>
                            ) : null}
                          </div>
                        ) : (
                          dutyTags.length > 0 ? null : null
                        )}
                      </div>
                    )}
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

function Field({ label, children, helperText, warning }) {
  return (
    <div>
      <div className="text-[13px] text-[#7C8496] mb-1.5">
        <div>{label}</div>
        {helperText ? <div className="text-[11px] text-[#7C8496] mt-0.5">{helperText}</div> : null}
      </div>
      {children}
      {warning ? <div className="mt-2 text-[12px] text-[#FF6B57]">{warning}</div> : null}
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

function NumberInput({ value, onChange, min = 0, step = "any", placeholder = "0", unit = "", disabled = false }) {
  return (
    <div className="relative">
      <input
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        min={min}
        step={step}
        disabled={disabled}
        className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFB454] disabled:opacity-60"
      />
      {unit ? <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7C8496] text-sm">{unit}</span> : null}
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
