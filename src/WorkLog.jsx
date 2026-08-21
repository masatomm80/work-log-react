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
const LAST_BACKUP_KEY = "workLogLastBackupAt";
const APP_NAME = "Masato Taxi AI";
const APP_VERSION = "1.0";
const DUTY_TAGS = [
  "当番なし",
  "日赤",
  "日赤夜①",
  "日赤夜②",
  "寝台①",
  "寝台②",
  "横関",
  "横関夜",
  "宿直",
  "研修",
  "貸切",
  "赤字（1日）",
  "赤字（半日）",
  "黒字（半日）",
];
const PRESET_TAGS = ["日赤", "日赤夜", "寝台", "宿直", "横関", "横関夜", "早出", "明け", "点検書類提出"];
const WEATHER_OPTIONS = [
  { value: "sunny", label: "晴れ" },
  { value: "cloudy", label: "くもり" },
  { value: "rain", label: "雨" },
  { value: "snow", label: "雪" },
];
// 営業明細(rideDetails)の乗車種別。Step①時点ではこの3種類のみ。
const RIDE_TYPE_OPTIONS = [
  { value: "general", label: "一般" },
  { value: "app", label: "アプリ" },
  { value: "street", label: "手上げ" },
];
const RIDE_TYPE_LABEL = { general: "一般", app: "アプリ", street: "手上げ" };
const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];
const FIRST_WORKDAY = "2024-12-22";
const HOLIDAY_AUTO_CYCLE_START = "2026-07-21";
const DAY_STATUS = {
  WORKDAY: "workday",
  DAYOFF: "dayoff",
  HOLIDAY: "holiday",
};
// MONTHLY LOGの「勤務区分」表示用の短縮ラベル(表示専用、データ・集計ロジックには影響しない)。
const HOLIDAY_SHORT_LABEL = {
  black: "黒字",
  red: "赤字",
  "black-half": "黒字半日",
  "red-half": "赤字半日",
  paid: "有給",
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
  // 基準日(HOLIDAY_AUTO_CYCLE_START)から14日周期で黒字・赤字を交互算出する。
  // 過去方向(legacy期間を含む)にも同じ周期をそのまま適用する。
  const diff = diffDays(iso, HOLIDAY_AUTO_CYCLE_START);
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
    const rawType = manual.holidayType || null;
    // Normalize legacy variants to base types for behavior
    let baseType = rawType;
    if (rawType === "red-work" || rawType === "red-off") baseType = "red";
    // For stored 'red' rely on stored dayStatus when present; if missing, default to HOLIDAY
    const manualDayStatus = Object.prototype.hasOwnProperty.call(manual, "dayStatus") ? manual.dayStatus : undefined;
    const isActual = manualDayStatus === DAY_STATUS.HOLIDAY || (rawType === "red" && manualDayStatus === undefined);
    return {
      type: baseType,
      isActual,
      isManual: true,
      isOverride: !!manual.id,
      date,
      holidayOrigin: manual.holidayOrigin || manual.date,
      isMovedDestination: manual.holidayOrigin && manual.holidayOrigin !== manual.date,
      originalDate: manual.holidayOrigin && manual.holidayOrigin !== manual.date ? manual.holidayOrigin : undefined,
      manualDayStatus,
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
  // Prefer moved-from label
  if (holidayInfo?.isMovedFrom) {
    const t = holidayInfo.type;
    if (t === "black") return "黒字公休日（移動済み）";
    if (t === "black-half") return "黒字半日公休日（移動済み）";
    if (t === "red-half") return "赤字半日公休日（移動済み）";
    if (t === "red") return "赤字公休日（移動済み）";
    if (t === "paid") return "有給休暇（移動済み）";
    return "公休日（移動済み）";
  }

  // Determine holidayType and effective dayStatus
  const date = entry?.date || holidayInfo?.date;
  const baseType = entry?.holidayType || holidayInfo?.type;
  const effectiveStatus = getEffectiveDayStatus(date, entry, holidayInfo);

  if (!baseType) return "公休日";

  if (baseType === "red") {
    return effectiveStatus === DAY_STATUS.WORKDAY ? "赤字公休日（出勤）" : "赤字公休日（休み）";
  }
  if (baseType === "black") return "黒字公休日";
  if (baseType === "black-half") return "黒字半日公休日";
  if (baseType === "red-half") return "赤字半日公休日";
  if (baseType === "paid") return "有給休暇";
  return "公休日";
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
function getRecordFormatFromDate(date) {
  if (!date) return "current";
  return date >= "2024-12-21" && date <= "2026-07-20" ? "legacy" : "current";
}
function inferRecordFormat(entry) {
  if (!entry) return "current";
  if (entry.recordFormat) return entry.recordFormat;
  return getRecordFormatFromDate(entry.date);
}
function normalizeFixedDateEntry(entry) {
  if (!entry || entry.date !== "2026-08-08") return entry;
  const normalized = {
    ...entry,
    dayStatus: DAY_STATUS.WORKDAY,
    holidayType: null,
    holidayOrigin: null,
  };
  if (Object.prototype.hasOwnProperty.call(normalized, "holidayTransfer")) {
    const { holidayTransfer, ...rest } = normalized;
    return rest;
  }
  return normalized;
}
function inferHolidayFraction(holidayType) {
  if (holidayType === "black-half" || holidayType === "red-half") return 0.5;
  if (holidayType === "black" || holidayType === "red" || holidayType === "paid") return 1;
  return 1;
}

// 営業明細(rideDetails)1件の初期値。idはnull(保存時に採番)、numberは表示順で都度振り直す。
function emptyRideDetail() {
  return {
    id: null,
    number: 1,
    pickupTime: "",
    dropoffTime: "",
    pickupLocation: "",
    dropoffLocation: "",
    amount: "",
    rideType: "general",
    favorite: false,
    note: "",
  };
}
// numberは配列の並び順から都度再計算する(idは変更しない)。追加・削除・将来の並べ替え後は必ずこれを通す。
function renumberRideDetails(list) {
  return (Array.isArray(list) ? list : []).map((item, index) => ({ ...item, number: index + 1 }));
}

function canShowWorkForm(entryLike) {
  // entryLike can be an object with dayStatus and holidayType, or just a holidayType string
  if (!entryLike) return false;
  const dayStatus = typeof entryLike === "object" ? entryLike.dayStatus : undefined;
  const holidayType = typeof entryLike === "object" ? entryLike.holidayType : entryLike;
  if (dayStatus === DAY_STATUS.WORKDAY) return true;
  return ["black-half", "red-half"].includes(holidayType);
}

function ensureRecordFormat(entry) {
  if (!entry || typeof entry !== "object") return entry;
  const normalizedEntry = normalizeFixedDateEntry(entry);
  const recordFormat = normalizedEntry.recordFormat || inferRecordFormat(normalizedEntry);
  const rawDutyTags = Array.isArray(normalizedEntry.dutyTags) ? normalizedEntry.dutyTags : [];
  const dutyTags = rawDutyTags.map((t) => {
    if (t === "横関夜①" || t === "横関夜②") return "横関夜";
    if (t === "赤字（出勤）") return "赤字（1日）";
    return t;
  });
  const holidayFraction = normalizedEntry.holidayFraction ?? inferHolidayFraction(normalizedEntry.holidayType);
  // entryStatus(編集中/入力済み)はdayStatus(勤務日/公休日など)とは完全に独立した値。
  // 既存データに値が無い場合は"editing"として扱う(一括変換や削除は行わない)。
  const entryStatus = normalizedEntry.entryStatus === "completed" ? "completed" : "editing";
  // rideDetails(営業明細)。既存データに存在しない場合は[]として安全に扱う(一括変換や既存フィールドの書き換えは行わない)。
  const rideDetails = Array.isArray(normalizedEntry.rideDetails) ? normalizedEntry.rideDetails : [];
  return { ...normalizedEntry, recordFormat, dutyTags, holidayFraction, entryStatus, rideDetails };
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
// 自動保存の比較用データ。id・recordFormat・holidayTransfer(保存日時を含む)や
// 展開状態などのUI専用stateは含めず、保存内容として意味のある項目だけをキー順固定で抜き出す。
function getComparableFormData(record) {
  if (!record) return null;
  return {
    date: record.date ?? null,
    dayStatus: record.dayStatus ?? null,
    entryStatus: record.entryStatus === "completed" ? "completed" : "editing",
    holidayType: record.holidayType ?? null,
    holidayFraction: record.holidayFraction ?? null,
    holidayOrigin: record.holidayOrigin ?? null,
    dutyTags: Array.isArray(record.dutyTags) ? [...record.dutyTags] : [],
    notes: record.notes ?? "",
    sales: record.sales ?? "",
    salesExtra: record.salesExtra ?? "",
    tip: record.tip ?? "",
    count: record.count ?? "",
    handRaisedCount: record.handRaisedCount ?? "",
    appRideCount: record.appRideCount ?? "",
    totalDistance: record.totalDistance ?? "",
    occupiedDistance: record.occupiedDistance ?? "",
    condition: record.condition ?? "",
    weather: Array.isArray(record.weather) ? [...record.weather] : [],
    workStart: record.workStart ?? "",
    workEnd: record.workEnd ?? "",
    breakTime: record.breakTime ?? "",
    workHours: record.workHours ?? "",
    hoursOverride: Boolean(record.hoursOverride),
    rideDetails: getComparableRideDetails(record.rideDetails),
  };
}
// rideDetails配列を、キー順を固定したオブジェクトの配列へ変換する。
// JSON.stringifyによる比較(isFormUnchanged)を安定させるため、営業明細側の項目もここで正規化する。
function getComparableRideDetails(list) {
  return (Array.isArray(list) ? list : []).map((item) => ({
    id: item?.id ?? null,
    number: item?.number ?? null,
    pickupTime: item?.pickupTime ?? "",
    dropoffTime: item?.dropoffTime ?? "",
    pickupLocation: item?.pickupLocation ?? "",
    dropoffLocation: item?.dropoffLocation ?? "",
    amount: item?.amount ?? "",
    rideType: item?.rideType ?? "general",
    favorite: Boolean(item?.favorite),
    note: item?.note ?? "",
  }));
}
function isFormUnchanged(record, comparableSnapshot) {
  if (!comparableSnapshot) return false;
  return JSON.stringify(getComparableFormData(record)) === JSON.stringify(comparableSnapshot);
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
// 「year年month月度」(前月21日〜当月20日)の開始日を求める。月度計算自体はgetPeriodBoundsを再利用する。
function getPeriodStartForYearMonth(year, month) {
  const iso = `${year}-${String(month).padStart(2, "0")}-20`;
  return getPeriodBounds(iso).start;
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
function calculateWorkSchedule(periodRange, entries) {
  if (!periodRange || !periodRange.start || !periodRange.end) {
    return {
      calendarWorkDays: 0,
      blackHolidayDays: 0,
      redHolidayDays: 0,
      plannedWorkDays: 0,
      completedWorkDays: 0,
      remainingWorkDays: 0,
    };
  }
  let cursor = periodRange.start;
  let calendarWorkDays = 0;
  let blackHolidayDays = 0;
  let blackHalfDays = 0;
  let redOffDays = 0;
  let paidHolidayDays = 0;
  const byDate = {};
  while (cursor <= periodRange.end) {
    const isWork = isWorkDay(cursor);
    if (isWork) calendarWorkDays += 1;
    const h = getHolidayInfo(cursor, entries);
    const entry = entries.find((e) => e.date === cursor) || null;
    const effectiveStatus = getEffectiveDayStatus(cursor, entry, h);
    if (h && h.type === "black") {
      if (!(h.isScheduled && h.isMovedFrom)) blackHolidayDays += 1;
    }
    if (h && h.type === "black-half") {
      // black-half reduces planned work by 0.5 when treated as half holiday
      blackHalfDays += 1;
    }
    if (h && h.type === "paid") {
      if (effectiveStatus === DAY_STATUS.HOLIDAY) paidHolidayDays += 1;
    }
    // Count red-off (red holiday where effective status is HOLIDAY)
    if (h && h.type === "red" && effectiveStatus === DAY_STATUS.HOLIDAY) {
      if (!(h.isScheduled && h.isMovedFrom)) redOffDays += 1;
    }
    byDate[cursor] = h || null;
    cursor = addDays(cursor, 1);
  }

  // Calculate plannedWorkDays: calendarWorkDays minus full black, paid, and black-half(0.5) and red-off
  const plannedWorkDays = Math.max(
    0,
    calendarWorkDays - blackHolidayDays - paidHolidayDays - redOffDays - blackHalfDays * 0.5
  );

  // completedWorkDays: count entries in period that satisfy isWorkedEntry
  const completedWorkDays = entries.reduce((acc, e) => {
    if (!e || !e.date) return acc;
    if (e.date < periodRange.start || e.date > periodRange.end) return acc;
    if (isWorkedEntry(e)) return acc + 1;
    return acc;
  }, 0);

  const remainingWorkDays = Math.max(0, plannedWorkDays - completedWorkDays);

  return {
    calendarWorkDays,
    blackHolidayDays,
    redHolidayDays: redOffDays,
    blackHalfDays,
    paidHolidayDays,
    plannedWorkDays,
    completedWorkDays,
    remainingWorkDays,
  };
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
    const needsPersist = normalized.some((entry, index) => {
      if (!entry.recordFormat) return true;
      if (entry.recordFormat !== parsed[index]?.recordFormat) return true;
      if (!Array.isArray(parsed[index]?.dutyTags)) return true;
      const orig = Array.isArray(parsed[index]?.dutyTags) ? parsed[index].dutyTags : [];
      if (JSON.stringify(orig) !== JSON.stringify(entry.dutyTags)) return true;
      return false;
    });
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
  holidayFraction: 1,
  entryStatus: "editing",
  rideDetails: [],
});

function normalizeForm(date, existing, holidayInfo = null) {
  const entry = ensureRecordFormat(existing || {});
  // Normalize legacy variants 'red-work'/'red-off' to base 'red' for form behavior
  const rawHolidayType = entry.dayStatus === DAY_STATUS.HOLIDAY ? entry.holidayType || holidayInfo?.type : entry.holidayType || null;
  const holidayType = rawHolidayType === "red-work" || rawHolidayType === "red-off" ? "red" : rawHolidayType;
  return {
    ...emptyForm(date),
    ...entry,
    weather: Array.isArray(entry?.weather) ? entry.weather : [],
    dayStatus: getEffectiveDayStatus(date, entry, holidayInfo),
    holidayType,
    holidayOrigin: entry.holidayOrigin || null,
    holidayFraction: entry.holidayFraction ?? inferHolidayFraction(entry.holidayType || holidayType),
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

// バックアップJSONのラッパー構造を作る。entries自体の中身・構造は変更しない。
function buildBackupPayload(entriesToBackup, createdAtIso) {
  const list = Array.isArray(entriesToBackup) ? entriesToBackup : [];
  return {
    app: APP_NAME,
    version: APP_VERSION,
    createdAt: createdAtIso,
    recordCount: list.length,
    legacyCount: list.filter(isLegacyRecord).length,
    currentCount: list.filter(isCurrentRecord).length,
    entries: list,
  };
}
// 復元対象のJSONを、旧形式(素の配列)・新形式({app, version, ..., entries})のどちらでも読めるようにする。
function parseBackupFile(raw) {
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return { entries: parsed, app: null, version: null };
  }
  if (parsed && Array.isArray(parsed.entries)) {
    return { entries: parsed.entries, app: parsed.app ?? null, version: parsed.version ?? null };
  }
  return null;
}
function formatBackupTimestamp(isoString) {
  if (!isoString) return "未作成";
  const dt = new Date(isoString);
  if (isNaN(dt.getTime())) return "未作成";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}/${m}/${d} ${hh}:${mm}`;
}
function formatBackupFileTimestamp(isoString) {
  const dt = new Date(isoString);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}_${hh}${mm}`;
}

// ファイル名に使えない文字(空白含む)を安全な文字へ置き換える。
function sanitizeFilenamePart(name) {
  return String(name).replace(/[\s<>:"/\\|?*\x00-\x1f]+/g, "_");
}

function csvEscape(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function WorkLog() {
  const [entries, setEntries] = useState(() => loadEntries().map(ensureRecordFormat));
  const [saveState, setSaveState] = useState("idle"); // idle | saved | error (手動保存ボタンの一時的なラベル用、既存のまま)
  const [autoSaveStatus, setAutoSaveStatus] = useState("saved"); // saving | saved | error (自動保存ステータス表示用)
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [form, setForm] = useState(emptyForm(todayISO()));
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmReeditOpen, setConfirmReeditOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [holidayMoveTarget, setHolidayMoveTarget] = useState("");
  const [dutyStampOpen, setDutyStampOpen] = useState(false);
  const [holidayOptionsOpen, setHolidayOptionsOpen] = useState(false);
  const [lastBackupAt, setLastBackupAt] = useState(() => localStorage.getItem(LAST_BACKUP_KEY));
  const [pendingRestore, setPendingRestore] = useState(null); // { entries, validCount, appMismatch, versionMismatch, sourceApp, sourceVersion }
  const [restoreBusy, setRestoreBusy] = useState(false);
  // MONTHLY JUMPで開いている年度(1つだけ)。初期値は現在開いている月度の年。
  // 一度ユーザーが閉じたら、selectedDateが変わっても自動では開き直さない。
  const [expandedJumpYear, setExpandedJumpYear] = useState(null); // 初期状態はすべて閉じる
  // MONTHLY LOGで「選択→再タップでジャンプ」するための、1回目タップで選ばれている日付。
  const [selectedLogDate, setSelectedLogDate] = useState(null);
  // 営業明細パネル(RideDetailsPanel)の開閉状態。選択中の日付専用のパネルなので、日付が変わったら閉じる。
  const [rideDetailsPanelOpen, setRideDetailsPanelOpen] = useState(false);
  // DAILY LOG内の営業明細クイック入力欄(current期間のみ)。追加専用の下書き状態で、rideDetails自体には含まれない。
  const [quickRideDraft, setQuickRideDraft] = useState(emptyRideDetail());
  // CSV書き出しの対象期間。初期値は現在開いている月度(既存のgetPeriodRangeを利用)。
  const [csvStartDate, setCsvStartDate] = useState(() => getPeriodRange(selectedDate).start);
  const [csvEndDate, setCsvEndDate] = useState(() => getPeriodRange(selectedDate).end);
  const dateInputRef = useRef(null);
  const restoreInputRef = useRef(null);
  const toastTimer = useRef(null);
  const formRef = useRef(form);
  const autoSaveTimerRef = useRef(null);
  const lastSavedSnapshotRef = useRef(null);
  const skipNextAutoSaveRef = useRef(true);
  // CSV期間欄を最後に自動セットした月度(start_end)。同じ月度内ではユーザーの手動編集を上書きしない。
  const csvRangeSyncRef = useRef(`${getPeriodRange(selectedDate).start}_${getPeriodRange(selectedDate).end}`);

  const currentEntries = useMemo(() => entries.filter(isCurrentRecord), [entries]);
  const legacyEntries = useMemo(() => entries.filter(isLegacyRecord), [entries]);
  const holidayInfo = useMemo(() => getHolidayInfo(selectedDate, entries), [selectedDate, entries]);
  // 画面表示モード(legacy/current)は保存済みrecordFormatに関係なく、日付だけで判定する。
  // entryのrecordFormat自体(保存データ)は書き換えない。
  const activeRecordFormat = getRecordFormatFromDate(selectedDate);
  const isLegacyMode = activeRecordFormat === "legacy";
  const isCurrentMode = activeRecordFormat === "current";

  useEffect(() => {
    const existing = entries.find((e) => e.date === selectedDate);
    const nextForm = existing
      ? normalizeForm(selectedDate, existing, holidayInfo)
      : normalizeForm(selectedDate, null, holidayInfo);
    // 日付変更・entries更新(自分自身の保存やバックアップ復元を含む)によるフォーム反映は
    // ユーザー入力ではないため、直後の自動保存監視を1回だけ無視させる。
    skipNextAutoSaveRef.current = true;
    lastSavedSnapshotRef.current = getComparableFormData(nextForm);
    setForm(nextForm);
  }, [selectedDate, entries, holidayInfo]);

  useEffect(() => {
    formRef.current = form;
  }, [form]);

  // 日付が(ジャンプ以外の操作も含めて)変わったら、MONTHLY LOGの1回目タップ選択状態を解除する。
  useEffect(() => {
    setSelectedLogDate(null);
  }, [selectedDate]);

  // 日付が変わったら営業明細パネルも閉じる(別日のパネルが開いたままにならないようにする)。
  useEffect(() => {
    setRideDetailsPanelOpen(false);
  }, [selectedDate]);

  // 日付が変わったら営業明細クイック入力欄も新規入力状態へリセットする(別日の下書きを持ち越さない)。
  useEffect(() => {
    setQuickRideDraft(emptyRideDetail());
  }, [selectedDate]);

  // 日付が切り替わったら(MONTHLY LOGからのジャンプを含むすべての日付変更で)、詳細画面を最上部から表示する。
  // 描画直後に実行するため、コミット後の最初のフレームでrequestAnimationFrameを使う。
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
    return () => cancelAnimationFrame(raf);
  }, [selectedDate]);

  const monthlyLogRange = useMemo(() => getPeriodRange(selectedDate), [selectedDate]);
  // selectedDateの月度が変わった場合だけ、CSV期間欄を新しい月度に合わせる。
  // 同じ月度内の日付移動では、ユーザーが手動で変更したCSV期間をそのまま維持する。
  useEffect(() => {
    const key = `${monthlyLogRange.start}_${monthlyLogRange.end}`;
    if (csvRangeSyncRef.current !== key) {
      csvRangeSyncRef.current = key;
      setCsvStartDate(monthlyLogRange.start);
      setCsvEndDate(monthlyLogRange.end);
    }
  }, [monthlyLogRange]);
  // MONTHLY JUMPの年度一覧。2024年度から「現在年 or 選択中の年」の遅い方+1年先まで、新しい年度が上にくる降順。
  const jumpYearOptions = useMemo(() => {
    const startYear = 2024;
    const endYear = Math.max(Number(todayISO().slice(0, 4)), Number(selectedDate.slice(0, 4))) + 1;
    const years = [];
    for (let y = endYear; y >= startYear; y--) years.push(y);
    return years;
  }, [selectedDate]);
  const selectedJumpYear = Number(monthlyLogRange.end.slice(0, 4));
  const selectedJumpMonth = Number(monthlyLogRange.end.slice(5, 7));
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
  const workSchedule = useMemo(() => calculateWorkSchedule(monthlyLogRange, entries), [monthlyLogRange, entries]);

  // MONTHLY TOTALもMONTHLY LOG/WORK SCHEDULEと同じ月度(selectedDateが属する期間)を使う。
  const periodBounds = monthlyLogRange;
  const periodEntries = useMemo(
    () => entries.filter((e) => e.date >= periodBounds.start && e.date <= periodBounds.end),
    [entries, periodBounds]
  );
  const selectedDutyTags = Array.isArray(form.dutyTags) ? form.dutyTags : [];
  const dutyStampSummary = selectedDutyTags.length > 0 ? selectedDutyTags.join("　") : "未設定";
  // 手動保存(manual)・自動保存(auto)・日付移動前の即時保存(flush)で共通利用する保存関数。
  // 検証・正規化・entries/localStorageの更新ロジックは1箇所にまとめている。
  const saveCurrentForm = ({ source }) => {
    const current = formRef.current;

    if (isFormUnchanged(current, lastSavedSnapshotRef.current)) {
      setAutoSaveStatus("saved");
      if (source === "manual") {
        setSaveState("saved");
        showToast("保存しました");
        setTimeout(() => setSaveState("idle"), 1200);
      }
      return { ok: true, skipped: true, entries };
    }

    const isLegacyForm = isLegacyRecord(current);
    const handRaisedValue = Number(current.handRaisedCount) || 0;
    const appRideValue = Number(current.appRideCount) || 0;
    const countValue = Number(current.count) || 0;
    const occupiedValue = Number(current.occupiedDistance) || 0;
    const totalDistanceValue = Number(current.totalDistance) || 0;

    if (!isLegacyForm) {
      let validationError = "";
      if (handRaisedValue > countValue) validationError = "手上げ乗車回数は通常の回数を超えません";
      else if (appRideValue > countValue) validationError = "アプリ乗車回数は通常の回数を超えません";
      else if (handRaisedValue + appRideValue > countValue) validationError = "手上げ乗車回数とアプリ乗車回数の合計が通常の回数を超えます";
      else if (occupiedValue > totalDistanceValue) validationError = "営業距離は走行距離を超えません";

      if (validationError) {
        if (source === "manual" || source === "flush") showToast(validationError);
        setAutoSaveStatus("error");
        return { ok: false, skipped: false, entries };
      }
    }

    if (source === "auto") setAutoSaveStatus("saving");

    const id = current.id || `${current.date}-${Date.now()}`;
    const recordFormat = inferRecordFormat(current);
    // Normalize holidayType: do not store red-work/red-off; store base types only
    let normalizedHolidayType = current.holidayType || null;
    if (normalizedHolidayType === "red-work" || normalizedHolidayType === "red-off") normalizedHolidayType = "red";
    const computedDayStatus = current.dayStatus || getEffectiveDayStatus(current.date, current, getHolidayInfo(current.date, entries));
    // If holidayType is 'red' and dayStatus undefined, default to HOLIDAY
    const finalDayStatus = typeof current.dayStatus !== "undefined" ? current.dayStatus : computedDayStatus;
    const record = {
      ...current,
      holidayType: normalizedHolidayType,
      dayStatus: finalDayStatus,
      holidayFraction: current.holidayFraction ?? inferHolidayFraction(normalizedHolidayType),
      recordFormat,
      id,
      holidayOrigin: finalDayStatus === DAY_STATUS.HOLIDAY && normalizedHolidayType ? current.holidayOrigin || current.date : undefined,
    };
    const next = entries.some((e) => e.id === id)
      ? entries.map((e) => (e.id === id ? record : e))
      : [...entries.filter((e) => e.date !== current.date), record];

    setEntries(next);
    setForm(record);
    formRef.current = record;
    const ok = persistEntries(next);
    if (ok) lastSavedSnapshotRef.current = getComparableFormData(record);

    if (source === "manual") {
      setSaveState(ok ? "saved" : "error");
      showToast(ok ? "保存しました" : "保存に失敗しました");
      setTimeout(() => setSaveState("idle"), 1200);
    } else if (source === "flush" && !ok) {
      showToast("保存に失敗しました");
    }
    setAutoSaveStatus(ok ? "saved" : "error");

    return { ok, skipped: false, entries: next };
  };

  // 保留中の自動保存タイマーを解除し、その場で即時保存する(日付移動・公休日移動の直前に使用)。
  const flushPendingSave = () => {
    clearTimeout(autoSaveTimerRef.current);
    return saveCurrentForm({ source: "flush" });
  };

  // 営業明細(rideDetails)専用の保存処理。DAILY LOG本体の売上・回数・距離等のバリデーション(saveCurrentForm)には
  // 一切依存せず、選択中の日付のentryのrideDetailsだけを書き換える。既存entriesに対象日のentryがあればそれを
  // ベースにして他フィールドは一切変更せず、無ければnormalizeForm(date, null, holidayInfo)で新規作成する
  // (formRef.currentをベースにしないのは、メインフォーム側の未保存input値を営業明細の保存につられて
  // 誤って永続化しないため)。
  //
  // 競合防止: DAILY LOG本体に未保存の変更(800msの自動保存debounce待ち)がある状態で営業明細を
  // 追加・編集・削除すると、その直後にentries変更を監視するフォーム再同期useEffectが走り、
  // 「保存前の入力中の値」が「entries側の古い保存済みの値」に戻って見えてしまう。これを防ぐため、
  // 既存のflushPendingSave()(日付移動時などと同じ共通処理)を使って先にDAILY LOG側の保留中の変更を
  // 確定させてから、その結果(flushResult.entries)を基準にrideDetailsを書き換える。
  // flushに失敗した場合(バリデーションエラー等)は、営業明細側の変更も行わない。
  const saveRideDetails = (nextRideDetails) => {
    const date = selectedDate;
    const flushResult = flushPendingSave();
    if (flushResult.ok === false) {
      return { ok: false, rideDetails: Array.isArray(nextRideDetails) ? nextRideDetails : [] };
    }
    const baseEntries = flushResult.entries || entries;
    const renumbered = renumberRideDetails(nextRideDetails);
    const existing = baseEntries.find((e) => e.date === date) || null;
    const base = existing ? ensureRecordFormat(existing) : normalizeForm(date, null, holidayInfo);
    const id = base.id || `${date}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const nextRecord = { ...base, id, rideDetails: renumbered };
    const nextEntries = existing
      ? baseEntries.map((e) => (e.date === date ? nextRecord : e))
      : [...baseEntries, nextRecord];
    setEntries(nextEntries);
    const ok = persistEntries(nextEntries);
    return { ok, rideDetails: renumbered };
  };

  // DAILY LOG内の営業明細クイック入力欄「＋明細を追加」。RideDetailsPanelの追加処理と同じく、
  // 既存rideDetails配列に1件追加してsaveRideDetailsへ渡すだけで、保存経路(id採番・番号振り直し・
  // flush・専用保存)は共通のsaveRideDetailsをそのまま再利用する(保存ロジックの二重実装はしない)。
  const handleQuickAddRideDetail = () => {
    const list = Array.isArray(form.rideDetails) ? form.rideDetails : [];
    const amountValue = quickRideDraft.amount === "" || quickRideDraft.amount === null ? "" : Number(quickRideDraft.amount);
    const normalizedAmount =
      quickRideDraft.amount === "" || quickRideDraft.amount === null || Number.isNaN(amountValue) ? "" : amountValue;
    const newItem = {
      ...quickRideDraft,
      amount: normalizedAmount,
      id: `ride-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };
    const result = saveRideDetails([...list, newItem]);
    if (result.ok) {
      setQuickRideDraft(emptyRideDetail());
    }
  };

  // entryStatus(編集中/入力済み)の切替専用。setFormと同時にformRef.currentも直接更新してから
  // 既存のsaveCurrentForm(source:"flush")を再利用して即時保存する。800msのdebounceは待たない。
  // 保存に失敗した場合(バリデーションエラー等)は、フォームがロックされたまま編集できなくなる事態を
  // 避けるため、entryStatusの変更を画面上も元に戻す。
  const setEntryStatusAndSave = (nextStatus) => {
    const updated = { ...formRef.current, entryStatus: nextStatus };
    formRef.current = updated;
    setForm(updated);
    const result = flushPendingSave();
    if (!result.ok) {
      const reverted = { ...formRef.current, entryStatus: nextStatus === "completed" ? "editing" : "completed" };
      formRef.current = reverted;
      setForm(reverted);
    }
  };

  const handleMarkCompleted = () => setEntryStatusAndSave("completed");

  const handleEntryStatusButtonClick = () => {
    if (form.entryStatus === "completed") {
      setConfirmReeditOpen(true);
    } else {
      handleMarkCompleted();
    }
  };

  const handleConfirmReedit = () => {
    setConfirmReeditOpen(false);
    setEntryStatusAndSave("editing");
  };

  // 日付変更・読込直後のフォーム反映では発火させず、入力が止まってから800ms後に1回だけ自動保存する。
  useEffect(() => {
    if (skipNextAutoSaveRef.current) {
      skipNextAutoSaveRef.current = false;
      return undefined;
    }
    clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      saveCurrentForm({ source: "auto" });
    }, 800);
    return () => clearTimeout(autoSaveTimerRef.current);
  }, [form]);

  // 日付を変える処理はすべてここを経由させ、移動前に未保存の変更をflushする。
  const changeDateSafely = (nextDateOrUpdater) => {
    const result = flushPendingSave();
    if (result.ok === false) return;
    setSelectedDate((current) =>
      typeof nextDateOrUpdater === "function" ? nextDateOrUpdater(current) : nextDateOrUpdater
    );
  };

  const toggleDutyTag = (tag) => {
    setForm((f) => {
      const current = Array.isArray(f.dutyTags) ? f.dutyTags : [];
      const next = current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag];
      return { ...f, dutyTags: next };
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
    changeDateSafely(today);
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
  const holidayToggleDisabled = Boolean(isMovedDestination);

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
    // entriesを直接書き換える前に、現在フォームの未保存の変更を先にflushする。
    const flushResult = flushPendingSave();
    if (flushResult.ok === false) {
      showToast("保存に失敗したため、公休日の移動を中止しました。");
      return;
    }
    const baseEntries = flushResult.entries;
    const targetHolidayInfo = getHolidayInfo(holidayMoveTarget, baseEntries);
    if (targetHolidayInfo?.isActual || targetHolidayInfo?.isScheduled || targetHolidayInfo?.isMovedDestination) {
      showToast("移動先はすでに公休日になっています。");
      return;
    }
    const originalDate = selectedDate;
    const movedDate = holidayMoveTarget;
    // flush後の最新entriesを基準に、この日の公休種別を取り直す(flushで内容が変わった場合に備える)。
    const currentHolidayInfo = getHolidayInfo(originalDate, baseEntries) || holidayInfo;
    const transfer = {
      originalDate,
      movedDate,
      holidayType: currentHolidayInfo.type,
      movedAt: new Date().toISOString(),
    };
    const originalEntry = baseEntries.find((entry) => entry.date === originalDate);
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
    const next = baseEntries.filter((entry) => entry.date !== originalDate && entry.date !== movedDate);
    const existingTarget = baseEntries.find((entry) => entry.date === movedDate);
    const targetEntry = existingTarget
      ? {
          ...ensureRecordFormat(existingTarget),
          dayStatus: DAY_STATUS.HOLIDAY,
          holidayType: currentHolidayInfo.type,
          holidayOrigin: originalDate,
          holidayTransfer: transfer,
        }
      : {
          ...emptyForm(movedDate),
          id: `${movedDate}-${Date.now()}-dest`,
          dayStatus: DAY_STATUS.HOLIDAY,
          holidayType: currentHolidayInfo.type,
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
    // entriesを直接書き換える前に、現在フォームの未保存の変更を先にflushする。
    const flushResult = flushPendingSave();
    if (flushResult.ok === false) {
      showToast("保存に失敗したため、公休日の移動解除を中止しました。");
      return;
    }
    const baseEntries = flushResult.entries;
    const movedDate = selectedDate;
    const targetEntry = baseEntries.find((entry) => entry.date === movedDate && entry.holidayTransfer);
    if (!targetEntry) {
      showToast("解除対象の移動データが見つかりませんでした。");
      return;
    }
    const originalDate = targetEntry.holidayTransfer.originalDate;
    const next = baseEntries.map((entry) => {
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
    clearTimeout(autoSaveTimerRef.current);
    saveCurrentForm({ source: "manual" });
  };

  const handleDelete = (id) => {
    clearTimeout(autoSaveTimerRef.current);
    const next = entries.filter((e) => e.id !== id);
    setEntries(next);
    persistEntries(next);
    setConfirmDeleteId(null);
    if (form.id === id) {
      const cleared = emptyForm(selectedDate);
      skipNextAutoSaveRef.current = true;
      lastSavedSnapshotRef.current = getComparableFormData(cleared);
      setForm(cleared);
    }
    showToast("削除しました");
  };

  // CSV期間プリセット。ボタンを押すとcsvStartDate/csvEndDateへ反映するだけ(書き出しは実行しない)。
  const applyCsvPresetCurrentPeriod = () => {
    setCsvStartDate(monthlyLogRange.start);
    setCsvEndDate(monthlyLogRange.end);
  };
  const applyCsvPresetThisYear = () => {
    const year = todayISO().slice(0, 4);
    setCsvStartDate(`${year}-01-01`);
    setCsvEndDate(`${year}-12-31`);
  };
  const applyCsvPresetAllTime = () => {
    if (entries.length === 0) {
      showToast("保存されているデータがありません");
      return;
    }
    const dates = entries.map((e) => e.date).filter(Boolean).sort();
    setCsvStartDate(dates[0]);
    setCsvEndDate(dates[dates.length - 1]);
  };

  const handleExportCsv = () => {
    if (!csvStartDate || !csvEndDate) {
      showToast("開始日と終了日を指定してください");
      return;
    }
    if (csvStartDate > csvEndDate) {
      showToast("開始日は終了日以前にしてください");
      return;
    }
    // 未保存の入力があれば先にflushし、保存成功(または変更なし)の場合だけ書き出す。
    const flushResult = flushPendingSave();
    if (flushResult.ok === false) {
      showToast("保存エラー：未保存の内容を保存できなかったため、CSVを書き出せませんでした");
      return;
    }
    const targetEntries = flushResult.entries.filter((e) => e && e.date >= csvStartDate && e.date <= csvEndDate);
    if (targetEntries.length === 0) {
      showToast("指定期間のデータがありません");
      return;
    }
    const rows = [
      ["日付", "曜日", "売上", "追加売上", "チップ", "回数", "勤務開始", "勤務終了", "休憩時間", "勤務時間", "備考"].join(","),
    ];
    [...targetEntries]
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
    const filename = `${sanitizeFilenamePart("M's Taxi AI")}_${csvStartDate}_${csvEndDate}.csv`;
    downloadBlob(csv, "text/csv;charset=utf-8", filename);
    showToast("CSVを書き出しました");
  };

  // 手動バックアップ・復元前の自動バックアップの両方で使う共通処理。
  const performBackup = (entriesToBackup, filename) => {
    try {
      const createdAtIso = new Date().toISOString();
      const payload = buildBackupPayload(entriesToBackup, createdAtIso);
      downloadBlob(JSON.stringify(payload, null, 2), "application/json", filename);
      localStorage.setItem(LAST_BACKUP_KEY, createdAtIso);
      setLastBackupAt(createdAtIso);
      return { ok: true, createdAtIso };
    } catch (e) {
      console.error("バックアップ失敗", e);
      return { ok: false };
    }
  };

  const handleBackup = () => {
    const filename = `${APP_NAME.replace(/\s+/g, "")}_Backup_${formatBackupFileTimestamp(new Date().toISOString())}.json`;
    const result = performBackup(entries, filename);
    showToast(result.ok ? "バックアップを書き出しました" : "バックアップ失敗：書き出しに失敗しました");
  };

  const handleRestoreFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsedResult;
      try {
        parsedResult = parseBackupFile(reader.result);
      } catch {
        showToast("JSON形式が不正：ファイルを読み込めませんでした");
        return;
      }
      if (!parsedResult) {
        showToast("JSON形式が不正：バックアップの形式が正しくありません");
        return;
      }
      const { entries: rawImported, app: sourceApp, version: sourceVersion } = parsedResult;
      // app名が異なる場合は復元不可(他アプリのデータの可能性が高いため)。
      if (sourceApp && sourceApp !== APP_NAME) {
        showToast(`このバックアップは「${sourceApp}」のデータのため復元できません`);
        return;
      }
      const imported = rawImported.map((r) => {
        if (!r || !r.date) return r;
        const normalized = ensureRecordFormat(r);
        if (!normalized.id) normalized.id = `${normalized.date}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        return normalized;
      });
      const validCount = imported.filter((r) => r && r.date).length;
      // versionだけ異なる場合は復元を止めず、警告付きの確認ダイアログを出す。
      const versionMismatch = Boolean(sourceVersion) && sourceVersion !== APP_VERSION;
      setPendingRestore({ entries: imported, validCount, versionMismatch, sourceVersion });
    };
    reader.onerror = () => {
      showToast("JSON形式が不正：ファイルを読み込めませんでした");
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const cancelRestore = () => {
    if (restoreBusy) return;
    setPendingRestore(null);
  };

  const confirmRestore = () => {
    if (!pendingRestore || restoreBusy) return;
    setRestoreBusy(true);
    const filename = `${APP_NAME.replace(/\s+/g, "")}_AutoBackup_${formatBackupFileTimestamp(new Date().toISOString())}.json`;
    const backupResult = performBackup(entries, filename);
    if (!backupResult.ok) {
      setRestoreBusy(false);
      showToast("バックアップ失敗：復元前の自動バックアップに失敗したため、復元を中止しました");
      return;
    }
    try {
      const byDate = {};
      entries.forEach((en) => (byDate[en.date] = en));
      pendingRestore.entries.forEach((r) => {
        if (r && r.date) byDate[r.date] = r;
      });
      const merged = Object.values(byDate).map(ensureRecordFormat);
      setEntries(merged);
      const ok = persistEntries(merged);
      setPendingRestore(null);
      setRestoreBusy(false);
      showToast(ok ? "復元しました" : "復元失敗：保存に失敗しました");
    } catch (err) {
      console.error("復元失敗", err);
      setPendingRestore(null);
      setRestoreBusy(false);
      showToast("復元失敗：データの反映に失敗しました");
    }
  };

  const { m, d, wd } = fmtDateLabel(selectedDate);
  const effectiveStatus = getEffectiveDayStatus(selectedDate, form, holidayInfo);
  const isWorkday = effectiveStatus === DAY_STATUS.WORKDAY;
  const isHoliday = effectiveStatus === DAY_STATUS.HOLIDAY;
  const isRedHoliday = isHoliday && form.holidayType === "red";
  const showNormalEntryForm = canShowWorkForm({ dayStatus: effectiveStatus, holidayType: form.holidayType });
  const isDayOff = effectiveStatus === DAY_STATUS.DAYOFF;
  // entryStatus(編集中/入力済み)。dayStatus(勤務日/公休日)とは無関係にフォームのロック有無だけを決める。
  const isEntryLocked = form.entryStatus === "completed";
  const isBeforeHolidayAutoCycle = selectedDate < HOLIDAY_AUTO_CYCLE_START;
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
  // 達成＋− = 売上合計 − 今月ノルマ(超過はプラス、未達はマイナス、0は符号なしで表示する)
  const monthlyAchievementDiff = monthlySalesTotal - monthlyTarget;
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
    setForm((f) => {
      const next = { ...f };
      next.dayStatus = status;
      // if caller provided a holidayType (may be null), use it; otherwise keep existing
      const provided = typeof holidayType !== "undefined" ? holidayType : f.holidayType;
      next.holidayType = provided;
      next.holidayFraction = provided ? inferHolidayFraction(provided) : 1;
      if (status === DAY_STATUS.WORKDAY && !next.holidayType) {
        next.holidayOrigin = null;
      }
      return next;
    });
    // close the holiday options UI after a manual selection
    try {
      setHolidayOptionsOpen(false);
    } catch (e) {
      // ignore
    }
  };

  const handleToggleHoliday = () => {
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
        <div className="flex items-center gap-4">
          <img
            src="/icons/logo-mascot-app-bg.png"
            alt=""
            className="w-20 h-20 sm:w-24 sm:h-24 flex-shrink-0 object-contain shadow-[0_2px_10px_rgba(0,0,0,0.45)]"
          />
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.25em] text-[#FFD54A] font-meter font-medium">DAILY LOG</div>
            <h1 className="font-display text-2xl mt-1" style={{ fontWeight: 900 }}>
              masato taxi ai
            </h1>
            <p className="text-[13px] text-[#7C8496] mt-0.5">記録が戦略に。</p>
          </div>
        </div>
      </header>

      {/* Date nav */}
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-[#232A36] bg-[#161A21] sticky top-0 z-10 max-w-[560px] mx-auto">
        <button
          onClick={() => changeDateSafely((s) => addDays(s, -1))}
          className="p-2 -ml-2 text-[#7C8496] active:text-[#FFD54A] transition-colors"
          aria-label="前の日"
        >
          <ChevronLeft size={20} />
        </button>
        {!isTodaySelected ? (
          <button
            onClick={handleGoToToday}
            className="rounded-full border border-[#2A3140] px-3 py-1.5 text-[11px] text-[#C0C8D4] active:border-[#FFD54A] active:text-[#FFD54A]"
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
            onChange={(e) => e.target.value && changeDateSafely(e.target.value)}
            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
          />
        </button>
        <button
          onClick={() => changeDateSafely((s) => addDays(s, 1))}
          className="p-2 -mr-2 text-[#7C8496] active:text-[#FFD54A] transition-colors"
          aria-label="次の日"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="max-w-[560px] mx-auto">
        <div className="mx-5 mt-4 rounded-2xl border border-[#232A36] bg-[#171C24] px-4 py-3">
          <fieldset
            disabled={isEntryLocked}
            className={`flex flex-col gap-3 border-0 p-0 m-0 min-w-0${isEntryLocked ? " opacity-80" : ""}`}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] tracking-[0.2em] text-[#7C8496] font-meter">DATE STATUS</div>
                <div className="font-medium text-[#EDEFF3] mt-1">{statusLabel}</div>
                {isMovedFrom ? (
                  <div className="text-[12px] text-[#FFD54A] mt-1">本来の公休・移動済み</div>
                ) : null}
                {isMovedDestination ? (
                  <div className="text-[12px] text-[#6EE7A8] mt-1">元の公休: {holidayInfo.originalDate}</div>
                ) : null}
              </div>
            </div>
            {(isWorkday || isHoliday || (isDayOff && isBeforeHolidayAutoCycle)) ? (
              <div>
                {!holidayOptionsOpen ? (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setDateStatus(DAY_STATUS.WORKDAY, null)}
                      className={`rounded-full border px-3 py-2 text-sm transition-colors text-left ${
                        effectiveStatus === DAY_STATUS.WORKDAY
                          ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]"
                          : "border-[#2A3140] text-[#8B93A1] hover:border-[#FFD54A]"
                      }`}
                    >
                      勤務日
                    </button>
                    {isHoliday ? (
                      <div className="flex items-center gap-2">
                        <div className="rounded-full border px-3 py-2 text-sm text-[#EDEFF3] border-[#2A3140] bg-[#171C24]">
                          {getHolidayLabel(form, holidayInfo)}
                        </div>
                        <button
                          type="button"
                          onClick={() => setHolidayOptionsOpen(true)}
                          className="rounded-full border px-3 py-2 text-sm border-[#2A3140] text-[#8B93A1] hover:border-[#FFD54A]"
                        >
                          公休日を変更
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setHolidayOptionsOpen(true)}
                        className="rounded-full border px-3 py-2 text-sm border-[#2A3140] text-[#8B93A1] hover:border-[#FFD54A]"
                      >
                        公休日に変更
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: "勤務日", status: DAY_STATUS.WORKDAY, holidayType: null },
                      { label: "黒字公休日", status: DAY_STATUS.HOLIDAY, holidayType: "black" },
                      { label: "赤字公休日（出勤）", status: DAY_STATUS.WORKDAY, holidayType: "red" },
                      { label: "赤字公休日（休み）", status: DAY_STATUS.HOLIDAY, holidayType: "red" },
                      { label: "黒字半日公休日", status: DAY_STATUS.WORKDAY, holidayType: "black-half" },
                      { label: "赤字半日公休日", status: DAY_STATUS.WORKDAY, holidayType: "red-half" },
                      { label: "有給休暇", status: DAY_STATUS.HOLIDAY, holidayType: "paid" },
                    ].map((option) => {
                      const selected =
                        option.status === DAY_STATUS.WORKDAY
                          ? option.holidayType
                            ? effectiveStatus === DAY_STATUS.WORKDAY && form.holidayType === option.holidayType
                            : effectiveStatus === DAY_STATUS.WORKDAY && !form.holidayType
                          : effectiveStatus === DAY_STATUS.HOLIDAY && form.holidayType === option.holidayType;
                      return (
                        <button
                          key={`${option.status}-${option.holidayType || "default"}`}
                          type="button"
                          onClick={() => setDateStatus(option.status, option.holidayType)}
                          className={`rounded-full border px-3 py-2 text-sm transition-colors text-left ${
                            selected
                              ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]"
                              : "border-[#2A3140] text-[#8B93A1] hover:border-[#FFD54A]"
                          }`}
                        >
                          {option.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      onClick={() => setHolidayOptionsOpen(false)}
                      className="col-span-2 rounded-full border px-3 py-2 text-sm border-[#2A3140] text-[#8B93A1] hover:border-[#FFD54A]"
                    >
                      閉じる
                    </button>
                  </div>
                )}
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
                    className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
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
          </fieldset>
        </div>
        {showNormalEntryForm ? (
          <>
            {!isLegacyMode ? (
            <fieldset
              disabled={isEntryLocked}
              className={`mx-5 mt-3 rounded-2xl border border-[#232A36] bg-[#171C24] overflow-hidden${isEntryLocked ? " opacity-80" : ""}`}
            >
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
                              ? "border-[#FFD54A] bg-[#FFD54A] text-[#12151A]"
                              : "border-[#2A3140] text-[#8B93A1] hover:border-[#FFD54A]"
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
            </fieldset>
            ) : null}
            <div className="mx-5 mt-5 rounded-2xl bg-[#181D25] border border-[#232A36] overflow-hidden">
              <div className="border-l-4 border-[#FFD54A] px-5 py-5">
                <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">売上 SALES</div>
                <div
                  className="font-meter font-bold text-[#FFD54A] mt-1 leading-none break-all"
                  style={{ fontSize: "clamp(2.2rem, 9vw, 3rem)", textShadow: "0 0 13px rgba(255,213,74,0.26)" }}
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
                  [isLegacyMode ? "勤務時間" : "実務時間", form.workHours ? `${form.workHours}h` : "—"],
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
                <fieldset
                  disabled={isEntryLocked}
                  className={`rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-4${isEntryLocked ? " opacity-80" : ""}`}
                >
                  <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">朝入力</div>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="体調">
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: "good", label: "◉ 良", className: "border-[#6EE7A8]/40 text-[#6EE7A8]" },
                          { value: "normal", label: "○ 並", className: "border-[#FFD54A]/40 text-[#FFD54A]" },
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
                                active ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]" : "border-[#2A3140] text-[#8B93A1]"
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
                </fieldset>
              ) : null}

              {!isLegacyMode ? (
                <Field label="コメント">
                  <textarea
                    value={form.notes}
                    onChange={(e) => updateField("notes", e.target.value)}
                    placeholder="自由に入力"
                    rows={3}
                    disabled={isEntryLocked}
                    className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-[17px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] resize-none disabled:opacity-70"
                  />
                </Field>
              ) : null}

              {isCurrentMode ? (
                <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-3">
                  <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">営業明細入力</div>
                  <fieldset
                    disabled={isEntryLocked}
                    className={`space-y-3 border-0 p-0 m-0${isEntryLocked ? " opacity-80" : ""}`}
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="乗車時間">
                        <input
                          type="time"
                          value={quickRideDraft.pickupTime}
                          onChange={(e) => setQuickRideDraft((d) => ({ ...d, pickupTime: e.target.value }))}
                          className="w-full bg-[#181D25] border border-[#232A36] rounded-lg px-3 py-2.5 text-base font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
                        />
                      </Field>
                      <Field label="降車時間">
                        <input
                          type="time"
                          value={quickRideDraft.dropoffTime}
                          onChange={(e) => setQuickRideDraft((d) => ({ ...d, dropoffTime: e.target.value }))}
                          className="w-full bg-[#181D25] border border-[#232A36] rounded-lg px-3 py-2.5 text-base font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="乗車場所">
                        <input
                          type="text"
                          value={quickRideDraft.pickupLocation}
                          onChange={(e) => setQuickRideDraft((d) => ({ ...d, pickupLocation: e.target.value }))}
                          placeholder="自由入力"
                          className="w-full bg-[#181D25] border border-[#232A36] rounded-lg px-3 py-2.5 text-[14px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
                        />
                      </Field>
                      <Field label="降車場所">
                        <input
                          type="text"
                          value={quickRideDraft.dropoffLocation}
                          onChange={(e) => setQuickRideDraft((d) => ({ ...d, dropoffLocation: e.target.value }))}
                          placeholder="自由入力"
                          className="w-full bg-[#181D25] border border-[#232A36] rounded-lg px-3 py-2.5 text-[14px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
                        />
                      </Field>
                    </div>
                    <Field label="金額">
                      <YenInput value={quickRideDraft.amount} onChange={(v) => setQuickRideDraft((d) => ({ ...d, amount: v }))} />
                    </Field>
                    <Field label="乗車種別">
                      <div className="flex gap-2">
                        {RIDE_TYPE_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setQuickRideDraft((d) => ({ ...d, rideType: opt.value }))}
                            className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                              quickRideDraft.rideType === opt.value
                                ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]"
                                : "border-[#2A3140] text-[#8B93A1]"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="お気に入り">
                        <button
                          type="button"
                          onClick={() => setQuickRideDraft((d) => ({ ...d, favorite: !d.favorite }))}
                          className={`w-full flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors ${
                            quickRideDraft.favorite ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]" : "border-[#2A3140] text-[#8B93A1]"
                          }`}
                        >
                          <span
                            className={`flex h-4 w-4 items-center justify-center rounded border ${
                              quickRideDraft.favorite ? "border-[#FFD54A] bg-[#FFD54A] text-[#12151A]" : "border-[#8B93A1]"
                            }`}
                          >
                            {quickRideDraft.favorite ? "✓" : ""}
                          </span>
                          お気に入り
                        </button>
                      </Field>
                      <Field label="備考">
                        <input
                          type="text"
                          value={quickRideDraft.note}
                          onChange={(e) => setQuickRideDraft((d) => ({ ...d, note: e.target.value }))}
                          placeholder="任意"
                          className="w-full bg-[#181D25] border border-[#232A36] rounded-lg px-3 py-2.5 text-[14px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
                        />
                      </Field>
                    </div>
                    <button
                      type="button"
                      onClick={handleQuickAddRideDetail}
                      className="w-full py-3 rounded-lg border border-dashed border-[#FFD54A]/50 text-[#FFD54A] text-sm font-medium active:bg-[#FFD54A]/10 disabled:opacity-40"
                    >
                      ＋ 明細を追加
                    </button>
                  </fieldset>
                  {isEntryLocked ? (
                    <div className="text-[12px] text-[#FFD54A]">入力済みのため営業明細を追加できません</div>
                  ) : null}
                </div>
              ) : null}

              <fieldset
                disabled={isEntryLocked}
                className={`rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-4${isEntryLocked ? " opacity-80" : ""}`}
              >
                <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">営業記録</div>
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
                  <Field label="回数 ※メーター外含まず">
                    <input
                      type="number"
                      inputMode="numeric"
                      value={form.count}
                      onChange={(e) => updateField("count", e.target.value)}
                      placeholder="0"
                      className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
                    />
                  </Field>
                  {!isLegacyMode ? (
                    <>
                      <Field label="手上げ乗車回数" helperText="※通常の回数に含まれる" warning={handRaisedWarning}>
                        <NumberInput
                          value={form.handRaisedCount}
                          onChange={(v) => updateField("handRaisedCount", v)}
                          min={0}
                          step="1"
                          placeholder="0"
                        />
                      </Field>
                      <Field label="アプリ乗車回数" helperText="※通常の回数に含まれる" warning={appRideWarning}>
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
              </fieldset>

              {isCurrentMode ? (
                <button
                  type="button"
                  onClick={() => setRideDetailsPanelOpen(true)}
                  className="w-full py-4 rounded-2xl border border-transparent bg-[#FFD54A] text-[#12151A] text-[15px] font-semibold hover:bg-[#E6C043] active:bg-[#E6C043] transition-colors"
                >
                  営業明細を開く
                </button>
              ) : null}

              {!isLegacyMode ? (
                <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-4">
                  <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter">営業効率</div>
                  <div className="grid grid-cols-2 gap-3">
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
                <fieldset
                  disabled={isEntryLocked}
                  className={`space-y-4 border-0 p-0 m-0 min-w-0${isEntryLocked ? " opacity-80" : ""}`}
                >
                {!isLegacyMode ? (
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="休憩時間">
                      <TimeSelect
                        value={form.breakTime}
                        onChange={(v) => updateField("breakTime", v)}
                        options={BREAK_TIME_OPTIONS}
                        className="w-full bg-[#181D25] border border-[#232A36] rounded-lg px-3 py-2.5 text-base font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
                      />
                    </Field>
                    <Field label="勤務終了">
                      <TimeSelect
                        value={form.workEnd}
                        onChange={(v) => updateField("workEnd", v)}
                        options={WORK_TIME_OPTIONS}
                        className="w-full bg-[#181D25] border border-[#232A36] rounded-lg px-3 py-2.5 text-base font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
                      />
                    </Field>
                  </div>
                ) : null}

                <Field label={isLegacyMode ? "勤務時間" : "実務時間"}>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={form.workHours}
                    onChange={(e) => setForm((f) => ({ ...f, workHours: e.target.value, hoursOverride: true }))}
                    placeholder="0.0"
                    className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
                  />
                </Field>

                {isLegacyMode ? (
                  <Field label="コメント">
                    <textarea
                      value={form.notes}
                      onChange={(e) => updateField("notes", e.target.value)}
                      placeholder="自由に入力"
                      rows={3}
                      className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-[17px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] resize-none"
                    />
                  </Field>
                ) : null}
                </fieldset>

                <div className="flex gap-2 pt-1">
                  <EntryStatusButton status={form.entryStatus} onClick={handleEntryStatusButtonClick} className="flex-1" />
                  {form.id && (
                    <button
                      onClick={() => setConfirmDeleteId(form.id)}
                      disabled={isEntryLocked}
                      className="px-4 rounded-lg border border-[#2A3140] text-[#7C8496] active:border-[#FF6B57] active:text-[#FF6B57] transition-colors disabled:opacity-40"
                      aria-label="削除"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
                <div
                  className={`text-right text-[11px] mt-1 ${
                    autoSaveStatus === "saving"
                      ? "text-[#FFD54A]"
                      : autoSaveStatus === "error"
                        ? "text-[#FF6B57]"
                        : "text-[#7C8496]"
                  }`}
                >
                  {autoSaveStatus === "saving" ? "保存中…" : autoSaveStatus === "error" ? "保存エラー" : "保存済み"}
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
            <fieldset
              disabled={isEntryLocked}
              className={`space-y-4 border-0 p-0 m-0 min-w-0${isEntryLocked ? " opacity-80" : ""}`}
            >
              {isHoliday ? (
                <div className="rounded-2xl border border-[#232A36] bg-[#181D25] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-[12px] text-[#7C8496]">公休日チェック</div>
                    <button
                      onClick={handleToggleHoliday}
                      className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${
                        isHoliday
                          ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]"
                          : "border-[#2A3140] text-[#8B93A1]"
                      }`}
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${isHoliday ? "border-[#FFD54A] bg-[#FFD54A] text-[#12151A]" : "border-[#8B93A1]"}`}>
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
                  className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-[17px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] resize-none"
                />
              </div>
            </fieldset>
            <EntryStatusButton status={form.entryStatus} onClick={handleEntryStatusButtonClick} className="w-full" />
            <div
              className={`text-right text-[11px] mt-1 ${
                autoSaveStatus === "saving"
                  ? "text-[#FFD54A]"
                  : autoSaveStatus === "error"
                    ? "text-[#FF6B57]"
                    : "text-[#7C8496]"
              }`}
            >
              {autoSaveStatus === "saving" ? "保存中…" : autoSaveStatus === "error" ? "保存エラー" : "保存済み"}
            </div>
          </div>
        )}

        {/* Monthly total */}
        <div className="mx-5 mt-8">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-2">MONTHLY TOTAL</div>
          <div className="rounded-2xl bg-[#181D25] border border-[#232A36] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#232A36]">
              <button
                onClick={() => changeDateSafely((d) => shiftPeriod(d, -1))}
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
                onClick={() => changeDateSafely((d) => shiftPeriod(d, 1))}
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
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[#181D25] px-3 py-2">
                  <div className="text-[10px] text-[#7C8496]">今月ノルマ</div>
                  <div className="font-meter text-sm text-[#EDEFF3] mt-0.5">¥{yen(monthlyTarget)}</div>
                </div>
                <div className="rounded-xl bg-[#181D25] px-3 py-2">
                  <div className="text-[10px] text-[#7C8496]">達成＋−</div>
                  <div
                    className={`font-meter text-sm mt-0.5 ${
                      monthlyAchievementDiff > 0
                        ? "text-[#6EE7A8]"
                        : monthlyAchievementDiff < 0
                          ? "text-[#FF6B57]"
                          : "text-[#EDEFF3]"
                    }`}
                  >
                    {monthlyAchievementDiff > 0 ? "+" : monthlyAchievementDiff < 0 ? "-" : ""}¥{yen(Math.abs(monthlyAchievementDiff))}
                  </div>
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

        {/* WORK SCHEDULE */}
        <div className="mx-5 mt-6">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-1">WORK SCHEDULE</div>
          <div className="text-[11px] text-[#7C8496] mb-3">今月度の勤務予定・実績</div>
          <div className="rounded-2xl bg-[#181D25] border border-[#232A36] px-4 py-3">
            <div className="mb-3">
              <div className="text-[12px] text-[#7C8496]">残り勤務</div>
              <div className="font-meter text-3xl font-bold text-[#EDEFF3] mt-1">{workSchedule.remainingWorkDays}日</div>
            </div>
            <div className="grid grid-cols-3 gap-2 text-left">
              <div className="rounded-2xl bg-[#171C24] px-2 py-2">
                <div className="text-[10px] text-[#7C8496] leading-none">暦上日数</div>
                <div className="font-meter text-xl font-semibold text-[#EDEFF3] mt-1 leading-none">{workSchedule.calendarWorkDays}日</div>
              </div>
              <div className="rounded-2xl bg-[#171C24] px-2 py-2">
                <div className="text-[10px] text-[#7C8496] leading-none">予定勤務</div>
                <div className="font-meter text-xl font-semibold text-[#EDEFF3] mt-1 leading-none">{workSchedule.plannedWorkDays}日</div>
              </div>
              <div className="rounded-2xl bg-[#171C24] px-2 py-2">
                <div className="text-[10px] text-[#7C8496] leading-none">勤務済み</div>
                <div className="font-meter text-xl font-semibold text-[#EDEFF3] mt-1 leading-none">{workSchedule.completedWorkDays}日</div>
              </div>
              <div className="rounded-2xl bg-[#171C24] px-2 py-2">
                <div className="text-[10px] text-[#7C8496] leading-none">黒字公休</div>
                <div className="font-meter text-xl font-semibold text-[#EDEFF3] mt-1 leading-none text-[#9CA3AF]">{workSchedule.blackHolidayDays}日</div>
              </div>
              <div className="rounded-2xl bg-[#171C24] px-2 py-2">
                <div className="text-[10px] text-[#7C8496] leading-none">赤字公休</div>
                <div className="font-meter text-xl font-semibold text-[#EDEFF3] mt-1 leading-none text-[#FF6B57]">{workSchedule.redHolidayDays}日</div>
              </div>
              <div className="rounded-2xl bg-[#171C24] px-2 py-2">
                <div className="text-[10px] text-[#7C8496] leading-none">有給休暇</div>
                <div className="font-meter text-xl font-semibold text-[#EDEFF3] mt-1 leading-none text-[#A78BFA]">{workSchedule.paidHolidayDays}日</div>
              </div>
            </div>
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
            <div className="space-y-1.5">
              {monthlyLogEntries.map((entry) => {
                const label = fmtDateLabel(entry.date);
                const type = entry.monthlyLogType;
                const isSelected = entry.date === selectedLogDate;
                const statusClasses =
                  type === "holiday"
                    ? entry.holidayInfo?.type === "red"
                      ? "bg-[#FF6B57]/10 text-[#FF6B57]"
                      : "bg-[#2F343B] text-[#D1D5DB]"
                    : type === "worked"
                      ? "bg-[#6EE7A8]/10 text-[#6EE7A8]"
                      : "bg-[#FFD54A]/10 text-[#FFD54A]";
                const statusLabel = type === "worked" ? "勤務済み" : type === "holiday" ? "公休日" : "勤務前";
                const dutyTags = Array.isArray(entry.dutyTags) ? entry.dutyTags : [];
                const holidayShortLabel = HOLIDAY_SHORT_LABEL[entry.holidayType] || "";
                const categoryParts = [holidayShortLabel, ...dutyTags].filter(Boolean);
                const categoryLabel = categoryParts.length > 0 ? categoryParts.join("・") : "—";
                const salesTotal = (Number(entry.sales) || 0) + (Number(entry.salesExtra) || 0);
                const salesDisplay = type === "worked" ? `¥${yen(salesTotal)}` : "—";
                return (
                  <div
                    key={entry.id}
                    onClick={() => {
                      if (selectedLogDate === entry.date) {
                        changeDateSafely(entry.date);
                        setSelectedLogDate(null);
                      } else {
                        setSelectedLogDate(entry.date);
                      }
                    }}
                    className={`rounded-xl border px-3 py-2 cursor-pointer transition-colors ${
                      isSelected ? "border-[#FFD54A] bg-[#1D2029]" : "border-[#232A36] bg-[#161A21] active:border-[#3A4152]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-1.5 font-meter flex-shrink-0">
                        <span className="font-bold text-[14px]">
                          {label.m}/{label.d}
                        </span>
                        <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${getWeekdayBadgeClass(label.wd)}`}>
                          {label.wd}
                        </span>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap flex-shrink-0 ${statusClasses}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="mt-1 flex items-start justify-between gap-2">
                      <span className="text-[12px] text-[#8B93A1] flex-1 min-w-0 break-words">{categoryLabel}</span>
                      <span
                        className={`font-meter text-[15px] font-bold whitespace-nowrap flex-shrink-0 ${
                          type === "worked" ? "text-[#EDEFF3]" : "text-[#5B6472]"
                        }`}
                      >
                        {salesDisplay}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* MONTHLY JUMP */}
        <div className="mx-5 mt-6">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-1">MONTHLY JUMP</div>
          <div className="text-[11px] text-[#7C8496] mb-3">月度を選んで移動</div>
          <div className="rounded-2xl bg-[#181D25] border border-[#232A36] p-3 space-y-2">
            {jumpYearOptions.map((year) => {
              const isYearOpen = expandedJumpYear === year;
              return (
                <div key={year}>
                  <button
                    type="button"
                    onClick={() => setExpandedJumpYear((cur) => (cur === year ? null : year))}
                    className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#171C24] border border-[#232A36] text-[13px] text-[#EDEFF3]"
                  >
                    <span>{year}年度</span>
                    <span className="text-[#7C8496]">{isYearOpen ? "⌄" : "›"}</span>
                  </button>
                  {isYearOpen ? (
                    <div className="grid grid-cols-3 gap-1.5 mt-1.5">
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
                        const isSelected = selectedJumpYear === year && selectedJumpMonth === month;
                        return (
                          <button
                            key={month}
                            type="button"
                            onClick={() => changeDateSafely(getPeriodStartForYearMonth(year, month))}
                            className={`rounded-lg border px-2 py-2 text-[12px] text-center transition-colors ${
                              isSelected
                                ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]"
                                : "border-[#2A3140] text-[#8B93A1] hover:border-[#FFD54A]"
                            }`}
                          >
                            {month}月度
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        {/* Data management */}
        <div className="mx-5 mt-8">
          <div className="text-[11px] tracking-[0.2em] text-[#7C8496] font-meter mb-2">データ管理</div>
          <div className="rounded-2xl bg-[#181D25] border border-[#232A36] p-4 space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-[12px] text-[#7C8496]">最終バックアップ</span>
              <span className="text-[12px] text-[#EDEFF3] font-meter">{formatBackupTimestamp(lastBackupAt)}</span>
            </div>
            <div className="rounded-xl border border-[#232A36] bg-[#171C24] p-3 space-y-2">
              <div className="text-[11px] text-[#7C8496]">CSV書き出し期間</div>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={applyCsvPresetCurrentPeriod}
                  className="flex-1 rounded-lg border border-[#2A3140] text-[#8B93A1] text-[11px] py-1.5 active:border-[#FFD54A] transition-colors"
                >
                  現在の月度
                </button>
                <button
                  type="button"
                  onClick={applyCsvPresetThisYear}
                  className="flex-1 rounded-lg border border-[#2A3140] text-[#8B93A1] text-[11px] py-1.5 active:border-[#FFD54A] transition-colors"
                >
                  今年
                </button>
                <button
                  type="button"
                  onClick={applyCsvPresetAllTime}
                  className="flex-1 rounded-lg border border-[#2A3140] text-[#8B93A1] text-[11px] py-1.5 active:border-[#FFD54A] transition-colors"
                >
                  全期間
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-[#7C8496]">開始日</label>
                  <input
                    type="date"
                    value={csvStartDate}
                    onChange={(e) => setCsvStartDate(e.target.value)}
                    className="w-full mt-1 bg-[#181D25] border border-[#232A36] rounded-lg px-2 py-2 text-[13px] font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-[#7C8496]">終了日</label>
                  <input
                    type="date"
                    value={csvEndDate}
                    onChange={(e) => setCsvEndDate(e.target.value)}
                    className="w-full mt-1 bg-[#181D25] border border-[#232A36] rounded-lg px-2 py-2 text-[13px] font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
                  />
                </div>
              </div>
            </div>
            <button
              onClick={handleExportCsv}
              className="w-full flex items-center justify-center gap-2 bg-[#161A21] border border-[#2A3140] text-[#EDEFF3] text-[15px] py-4 rounded-xl active:border-[#FFD54A] transition-colors"
            >
              <FileSpreadsheet size={18} />
              CSV書き出し
            </button>
            <button
              onClick={handleBackup}
              className="w-full flex items-center justify-center gap-2 bg-[#161A21] border border-[#2A3140] text-[#EDEFF3] text-[15px] py-4 rounded-xl active:border-[#FFD54A] transition-colors"
            >
              <Download size={18} />
              バックアップ（JSON）
            </button>
            <button
              onClick={() => restoreInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 bg-[#161A21] border border-[#2A3140] text-[#EDEFF3] text-[15px] py-4 rounded-xl active:border-[#FFD54A] transition-colors"
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

      {/* 営業明細パネル(current期間のみ、選択中の日付専用) */}
      <RideDetailsPanel
        open={rideDetailsPanelOpen}
        onClose={() => setRideDetailsPanelOpen(false)}
        dateLabel={`${m}/${d} (${wd})`}
        rideDetails={form.rideDetails}
        locked={isEntryLocked}
        onSave={saveRideDetails}
      />

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

      {confirmReeditOpen && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end justify-center z-20"
          onClick={() => setConfirmReeditOpen(false)}
        >
          <div
            className="bg-[#1B2029] border border-[#2A3140] rounded-t-2xl w-full max-w-[560px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-display font-bold text-[15px]">この日の入力を再編集しますか？</span>
              <button onClick={() => setConfirmReeditOpen(false)} className="text-[#7C8496]">
                <X size={18} />
              </button>
            </div>
            <p className="text-[13px] text-[#7C8496] mb-4">入力内容の変更が可能になります。</p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmReeditOpen(false)}
                className="flex-1 py-3 rounded-lg border border-[#2A3140] text-[#EDEFF3]"
              >
                キャンセル
              </button>
              <button
                onClick={handleConfirmReedit}
                className="flex-1 py-3 rounded-lg bg-[#FFD54A] text-[#12151A] font-medium"
              >
                編集する
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore confirm */}
      {pendingRestore && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end justify-center z-20"
          onClick={cancelRestore}
        >
          <div
            className="bg-[#1B2029] border border-[#2A3140] rounded-t-2xl w-full max-w-[560px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-display font-bold text-[15px]">
                {pendingRestore.versionMismatch ? "バックアップのバージョンが異なります" : "データを復元しますか？"}
              </span>
              <button onClick={cancelRestore} className="text-[#7C8496]">
                <X size={18} />
              </button>
            </div>
            {pendingRestore.versionMismatch ? (
              <p className="text-[13px] text-[#7C8496] mb-4 leading-relaxed">
                このバックアップは Ver {pendingRestore.sourceVersion}、現在のアプリは Ver {APP_VERSION} です。
                互換性は確認できません。
                <br />
                現在のデータは上書きされます。復元前に現在のデータを自動バックアップします。
                <br />
                このまま復元しますか？
              </p>
            ) : (
              <p className="text-[13px] text-[#7C8496] mb-4 leading-relaxed">
                現在のデータは上書きされます。
                <br />
                復元前に現在のデータを自動バックアップします。
                <br />
                復元を実行しますか？（{pendingRestore.validCount}件）
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={cancelRestore}
                disabled={restoreBusy}
                className="flex-1 py-3 rounded-lg border border-[#2A3140] text-[#EDEFF3] disabled:opacity-50"
              >
                キャンセル
              </button>
              <button
                onClick={confirmRestore}
                disabled={restoreBusy}
                className="flex-1 py-3 rounded-lg bg-[#FFD54A] text-[#12151A] font-medium disabled:opacity-50"
              >
                {restoreBusy ? "復元中…" : "復元する"}
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

// 編集中/入力済みの切替ボタン。編集中は既存のアクセント黄色、入力済みは落ち着いた緑でロック済みを示す。
function EntryStatusButton({ status, onClick, className = "" }) {
  const isCompleted = status === "completed";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 font-medium text-[14px] py-3 rounded-lg border transition-colors ${
        isCompleted
          ? "border-[#6EE7A8]/50 bg-[#6EE7A8]/10 text-[#6EE7A8] active:bg-[#6EE7A8]/20"
          : "border-transparent bg-[#FFD54A] text-[#12151A] active:bg-[#FFE066]"
      } ${className}`}
    >
      {isCompleted ? "入力済み" : "編集中"}
    </button>
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
        className="w-full bg-[#181D25] border border-[#232A36] rounded-xl pl-9 pr-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
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
        className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
      />
      {unit ? <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#7C8496] text-sm">{unit}</span> : null}
    </div>
  );
}

function TimeSelect({ value, onChange, options, disabled = false, className }) {
  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={
        className ||
        "w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-5 text-xl font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] disabled:opacity-60"
      }
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

// 営業明細(rideDetails)パネル。current期間のDAILY LOG画面から開くボトムシート。
// 既存の削除確認・復元確認ダイアログと同じ「暗色背景+下から出るシート」の見た目に合わせている。
// 一覧・追加・編集・削除はすべてこのコンポーネント内で完結し、保存は親から渡されるonSave(=saveRideDetails)
// を通じてentry.rideDetailsだけを書き換える(DAILY LOG本体のバリデーションには依存しない)。
function RideDetailsPanel({ open, onClose, dateLabel, rideDetails, locked, onSave }) {
  const [mode, setMode] = useState("list"); // "list" | "form"
  const [editingId, setEditingId] = useState(null); // nullは新規追加
  const [draft, setDraft] = useState(emptyRideDetail());
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  useEffect(() => {
    if (!open) {
      setMode("list");
      setEditingId(null);
      setConfirmDeleteId(null);
    }
  }, [open]);

  // パネルを開いたまま入力済みになった場合、編集フォームを表示したままにしない(閲覧のみへ戻す)。
  useEffect(() => {
    if (locked && mode === "form") {
      setMode("list");
      setEditingId(null);
    }
  }, [locked, mode]);

  if (!open) return null;

  const list = Array.isArray(rideDetails) ? rideDetails : [];

  const startAdd = () => {
    setDraft(emptyRideDetail());
    setEditingId(null);
    setMode("form");
  };
  const startEdit = (item) => {
    setDraft({ ...emptyRideDetail(), ...item });
    setEditingId(item.id);
    setMode("form");
  };
  const cancelForm = () => {
    setMode("list");
    setEditingId(null);
  };
  const submitForm = () => {
    const amountValue = draft.amount === "" || draft.amount === null ? "" : Number(draft.amount);
    const normalizedAmount = draft.amount === "" || draft.amount === null || Number.isNaN(amountValue) ? "" : amountValue;
    if (editingId) {
      // 編集時は既存のidをそのまま維持する(新しいidを作り直さない)。
      const next = list.map((item) =>
        item.id === editingId ? { ...item, ...draft, amount: normalizedAmount, id: editingId } : item
      );
      onSave(next);
    } else {
      const newItem = {
        ...draft,
        amount: normalizedAmount,
        id: `ride-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      };
      onSave([...list, newItem]);
    }
    setMode("list");
    setEditingId(null);
  };
  const confirmDelete = () => {
    const next = list.filter((item) => item.id !== confirmDeleteId);
    onSave(next);
    setConfirmDeleteId(null);
  };
  // ↑↓並べ替え。配列内の隣接要素を入れ替えてから、既存のrenumberRideDetails()でnumberを振り直し、
  // 既存のsaveRideDetails(onSave)経由で保存する(保存経路・flush連携は新規に作らず共通のものを再利用する)。
  const moveRideDetail = (index, direction) => {
    if (locked) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const next = [...list];
    const temp = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = temp;
    onSave(renumberRideDetails(next));
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-end justify-center z-30" onClick={onClose}>
      <div
        className="bg-[#1B2029] border border-[#2A3140] rounded-t-2xl w-full max-w-[560px] max-h-[85vh] overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="font-display font-bold text-[15px]">営業明細 {dateLabel}</span>
          <button onClick={onClose} className="text-[#7C8496]" aria-label="閉じる">
            <X size={18} />
          </button>
        </div>
        {locked ? (
          <div className="text-[12px] text-[#FFD54A] mb-3">入力済みのため編集できません（閲覧のみ）</div>
        ) : (
          <div className="mb-3" />
        )}

        {mode === "list" ? (
          <div className="space-y-3">
            {list.length === 0 ? (
              <div className="text-[13px] text-[#7C8496] py-6 text-center">まだ営業明細がありません</div>
            ) : (
              <div className="space-y-2">
                {list.map((item, index) => {
                  const isFirst = index === 0;
                  const isLast = index === list.length - 1;
                  return (
                    <div key={item.id} className="rounded-xl border border-[#232A36] bg-[#181D25] px-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        disabled={locked}
                        className="w-full text-left disabled:opacity-90 min-w-0"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[#7C8496] font-meter shrink-0">No.{item.number}</span>
                          <span className="text-[13px] text-[#EDEFF3] font-meter shrink-0">{item.pickupTime || "--:--"}</span>
                          <span className="text-[11px] rounded-full border border-[#2A3140] px-2 py-0.5 text-[#8B93A1] shrink-0">
                            {RIDE_TYPE_LABEL[item.rideType] || "一般"}
                          </span>
                          <span className="ml-auto text-[13px] font-meter font-medium text-[#FFD54A] shrink-0">
                            {item.amount !== "" && item.amount !== null && item.amount !== undefined && !Number.isNaN(Number(item.amount))
                              ? `¥${yen(item.amount)}`
                              : "—"}
                          </span>
                        </div>
                        <div className="mt-1 text-[12px] text-[#7C8496] truncate">
                          {item.pickupLocation || "（乗車場所未入力）"} → {item.dropoffLocation || "（降車場所未入力）"}
                        </div>
                      </button>
                      <div className="flex items-center justify-end gap-1.5 mt-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveRideDetail(index, -1);
                          }}
                          disabled={locked || isFirst}
                          aria-label="1つ上へ移動"
                          className={`flex h-7 w-7 items-center justify-center rounded-md border text-[13px] transition-colors ${
                            locked || isFirst
                              ? "border-[#232A36] text-[#4B525E]"
                              : "border-[#2A3140] text-[#8B93A1] active:border-[#FFD54A] active:text-[#FFD54A]"
                          }`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            moveRideDetail(index, 1);
                          }}
                          disabled={locked || isLast}
                          aria-label="1つ下へ移動"
                          className={`flex h-7 w-7 items-center justify-center rounded-md border text-[13px] transition-colors ${
                            locked || isLast
                              ? "border-[#232A36] text-[#4B525E]"
                              : "border-[#2A3140] text-[#8B93A1] active:border-[#FFD54A] active:text-[#FFD54A]"
                          }`}
                        >
                          ↓
                        </button>
                        {!locked ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(item.id);
                            }}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-[#7C8496] active:text-[#FF6B57] transition-colors"
                            aria-label="この営業明細を削除"
                          >
                            <Trash2 size={15} />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!locked ? (
              <button
                type="button"
                onClick={startAdd}
                className="w-full py-3 rounded-lg border border-dashed border-[#FFD54A]/50 text-[#FFD54A] text-sm font-medium active:bg-[#FFD54A]/10"
              >
                ＋ 明細を追加
              </button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Field label="乗車時間">
                <input
                  type="time"
                  value={draft.pickupTime}
                  onChange={(e) => setDraft((d) => ({ ...d, pickupTime: e.target.value }))}
                  className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-lg font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
                />
              </Field>
              <Field label="降車時間">
                <input
                  type="time"
                  value={draft.dropoffTime}
                  onChange={(e) => setDraft((d) => ({ ...d, dropoffTime: e.target.value }))}
                  className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-4 text-lg font-meter text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
                />
              </Field>
            </div>
            <Field label="乗車場所">
              <input
                type="text"
                value={draft.pickupLocation}
                onChange={(e) => setDraft((d) => ({ ...d, pickupLocation: e.target.value }))}
                placeholder="自由入力"
                className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-3 text-[15px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
              />
            </Field>
            <Field label="降車場所">
              <input
                type="text"
                value={draft.dropoffLocation}
                onChange={(e) => setDraft((d) => ({ ...d, dropoffLocation: e.target.value }))}
                placeholder="自由入力"
                className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-3 text-[15px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A]"
              />
            </Field>
            <Field label="金額">
              <YenInput value={draft.amount} onChange={(v) => setDraft((d) => ({ ...d, amount: v }))} />
            </Field>
            <Field label="乗車種別">
              <div className="flex gap-2">
                {RIDE_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft((d) => ({ ...d, rideType: opt.value }))}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                      draft.rideType === opt.value ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]" : "border-[#2A3140] text-[#8B93A1]"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="お気に入り乗車">
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, favorite: !d.favorite }))}
                className={`flex items-center gap-2 rounded-full border px-3 py-2 text-sm transition-colors ${
                  draft.favorite ? "border-[#FFD54A] bg-[#FFD54A]/10 text-[#FFD54A]" : "border-[#2A3140] text-[#8B93A1]"
                }`}
              >
                <span
                  className={`flex h-4 w-4 items-center justify-center rounded border ${
                    draft.favorite ? "border-[#FFD54A] bg-[#FFD54A] text-[#12151A]" : "border-[#8B93A1]"
                  }`}
                >
                  {draft.favorite ? "✓" : ""}
                </span>
                お気に入り
              </button>
            </Field>
            <Field label="備考">
              <textarea
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                rows={2}
                className="w-full bg-[#181D25] border border-[#232A36] rounded-xl px-4 py-3 text-[15px] text-[#EDEFF3] focus:outline-none focus:border-[#FFD54A] resize-none"
              />
            </Field>
            <div className="flex gap-2 pt-1">
              <button onClick={cancelForm} className="flex-1 py-3 rounded-lg border border-[#2A3140] text-[#EDEFF3]">
                キャンセル
              </button>
              <button onClick={submitForm} className="flex-1 py-3 rounded-lg bg-[#FFD54A] text-[#12151A] font-medium">
                {editingId ? "更新する" : "追加する"}
              </button>
            </div>
          </div>
        )}
      </div>

      {confirmDeleteId && (
        <div
          className="fixed inset-0 bg-black/60 flex items-end justify-center z-40"
          onClick={() => setConfirmDeleteId(null)}
        >
          <div
            className="bg-[#1B2029] border border-[#2A3140] rounded-t-2xl w-full max-w-[560px] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-display font-bold text-[15px]">この営業明細を削除しますか？</span>
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
              <button onClick={confirmDelete} className="flex-1 py-3 rounded-lg bg-[#FF6B57] text-[#12151A] font-medium">
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
