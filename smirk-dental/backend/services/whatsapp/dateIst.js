/**
 * Calendar date YYYY-MM-DD in Asia/Kolkata (used for appointment queries).
 */
function formatDateYmdInTimeZone(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}`;
}

function todayYmdIst() {
  return formatDateYmdInTimeZone(new Date(), 'Asia/Kolkata');
}

/** Add calendar days to a YYYY-MM-DD string interpreted in Asia/Kolkata. */
function addDaysYmdIst(ymd, daysToAdd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, mo, d] = ymd.split('-').map(Number);
  const base = Date.UTC(y, mo - 1, d, 6, 30, 0);
  const next = base + daysToAdd * 24 * 60 * 60 * 1000;
  return formatDateYmdInTimeZone(new Date(next), 'Asia/Kolkata');
}

/** IST calendar date shifted back by `monthsBack` whole months (eligibility cutoffs). */
function monthsAgoYmdIst(monthsBack) {
  const n = Math.max(0, Math.min(36, Number(monthsBack) || 0));
  const istToday = todayYmdIst();
  if (!istToday) return null;
  if (!n) return istToday;
  const [y, mo, d] = istToday.split('-').map(Number);
  const base = new Date(Date.UTC(y, mo - 1, d, 6, 30, 0));
  base.setUTCMonth(base.getUTCMonth() - n);
  return formatDateYmdInTimeZone(base, 'Asia/Kolkata');
}

/** Last calendar day for month (month 1–12). */
function lastDayOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Day-of-month for a visit anniversary in a given year/month (handles Jan 31 → Feb 28). */
function anniversaryDayInMonth(visitDay, year, month) {
  return Math.min(visitDay, lastDayOfMonth(year, month));
}

/** True when `todayYmd` is the monthly anniversary of `visitYmd` (IST calendar), after the visit itself. */
function isAnniversaryDay(visitYmd, todayYmd) {
  if (!visitYmd || !todayYmd || todayYmd <= visitYmd) return false;
  const [, , vd] = visitYmd.split('-').map(Number);
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  return td === anniversaryDayInMonth(vd, ty, tm);
}

/** Whole months elapsed from visit date to today (IST calendar). */
function monthsSinceVisit(visitYmd, todayYmd) {
  if (!visitYmd || !todayYmd || todayYmd <= visitYmd) return 0;
  const [vy, vm, vd] = visitYmd.split('-').map(Number);
  const [ty, tm, td] = todayYmd.split('-').map(Number);
  let months = (ty - vy) * 12 + (tm - vm);
  if (td < anniversaryDayInMonth(vd, ty, tm)) months -= 1;
  return Math.max(0, months);
}

/** Weekday (0=Sun) for a YYYY-MM-DD calendar date in IST. */
function weekdayIstYmd(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const inst = new Date(Date.UTC(y, mo - 1, d, 6, 30, 0));
  return inst.getUTCDay();
}

/** Monday–Sunday bounds for the week containing `ymd` (IST calendar). */
function weekBoundsYmdIst(ymd) {
  const wd = weekdayIstYmd(ymd);
  if (wd == null) return null;
  const daysFromMonday = (wd + 6) % 7;
  const start = addDaysYmdIst(ymd, -daysFromMonday);
  if (!start) return null;
  const end = addDaysYmdIst(start, 6);
  if (!end) return null;
  return { start, end };
}

/** YYYY-MM-DD → "Mon, Jul 5" for weekly digest display. */
function formatWeekdayShortDateIst(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [y, mo, d] = ymd.split('-').map(Number);
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const wd = weekdayIstYmd(ymd);
  if (wd == null) return ymd;
  return `${dayNames[wd]}, ${months[mo - 1]} ${d}`;
}

module.exports = {
  todayYmdIst,
  formatDateYmdInTimeZone,
  addDaysYmdIst,
  monthsAgoYmdIst,
  isAnniversaryDay,
  monthsSinceVisit,
  weekdayIstYmd,
  weekBoundsYmdIst,
  formatWeekdayShortDateIst,
};
