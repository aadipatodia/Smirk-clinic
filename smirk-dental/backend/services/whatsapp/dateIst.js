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

module.exports = { todayYmdIst, formatDateYmdInTimeZone, addDaysYmdIst, monthsAgoYmdIst };
