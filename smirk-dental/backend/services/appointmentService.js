const Appointment = require('../models/Appointment');
const Unavailable = require('../models/Unavailable');
const User = require('../models/User');
const { todayYmdIst, addDaysYmdIst } = require('./whatsapp/dateIst');

function phoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function apptBelongsToWa(appt, waId) {
  if (!appt || !waId) return false;
  return phoneDigits(appt.phone) === String(waId).replace(/\D/g, '');
}

// No starts between 2:00–3:00 PM (clinic break). Must stay in sync with frontend ALL_SLOTS.
const VALID_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '01:00 PM',
  '01:45 PM', '03:15 PM', '03:45 PM',
  '04:15 PM', '04:45 PM', '05:15 PM', '05:45 PM', '06:15 PM', '06:30 PM',
];

/** Weekday (0=Sun) for this calendar date in IST, using a noon anchor instant. */
function weekdayIstYmd(dateStr) {
  const [y, mo, d] = dateStr.split('-').map(Number);
  if (!y || !mo || !d) return null;
  const inst = new Date(Date.UTC(y, mo - 1, d, 6, 30, 0));
  return inst.getUTCDay();
}

function isValidAppointmentDate(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const today = todayYmdIst();
  if (!today || dateStr < today) return false;
  const wd = weekdayIstYmd(dateStr);
  if (wd === 0) return false;
  return true;
}

function formatPhoneForAppointment(waDigits) {
  const d = String(waDigits).replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return `+91${d}`;
  return `+${d}`;
}

async function getBookedAndBlockedForDate(date) {
  const booked = await Appointment.find(
    { date, status: { $in: ['confirmed'] } },
    'time -_id'
  ).lean();
  const bookedSlots = [...new Set(booked.map((a) => a.time))];

  const blocked = await Unavailable.find({ date }).lean();
  const blockedSlots = [];
  let fullDayBlock = false;
  blocked.forEach((b) => {
    if (b.time) blockedSlots.push(b.time);
    else fullDayBlock = true;
  });
  if (fullDayBlock) blockedSlots.push(null);

  return { bookedSlots, blockedSlots, fullDayBlock };
}

async function getAvailableSlots(date) {
  if (!isValidAppointmentDate(date)) return [];
  const { bookedSlots, blockedSlots, fullDayBlock } = await getBookedAndBlockedForDate(date);
  if (fullDayBlock) return [];
  const blockedSet = new Set(blockedSlots);
  const bookedSet = new Set(bookedSlots);
  return VALID_SLOTS.filter((t) => !blockedSet.has(t) && !bookedSet.has(t));
}

/** Free slots for a date when moving `excludeAppointmentId` off that slot (still confirmed until saved). */
async function getAvailableSlotsForReschedule(date, excludeAppointmentId) {
  if (!isValidAppointmentDate(date)) return [];
  const booked = await Appointment.find(
    {
      date,
      status: { $in: ['confirmed'] },
      ...(excludeAppointmentId ? { _id: { $ne: excludeAppointmentId } } : {}),
    },
    'time -_id'
  ).lean();
  const bookedSlots = [...new Set(booked.map((a) => a.time))];

  const blocked = await Unavailable.find({ date }).lean();
  const blockedSlots = [];
  let fullDayBlock = false;
  blocked.forEach((b) => {
    if (b.time) blockedSlots.push(b.time);
    else fullDayBlock = true;
  });
  if (fullDayBlock) blockedSlots.push(null);

  if (fullDayBlock) return [];
  const blockedSet = new Set(blockedSlots);
  const bookedSet = new Set(bookedSlots);
  return VALID_SLOTS.filter((t) => !blockedSet.has(t) && !bookedSet.has(t));
}

async function listUpcomingAppointmentsForWa(waId) {
  const today = todayYmdIst();
  if (!today) return [];
  const digits = String(waId).replace(/\D/g, '');
  const all = await Appointment.find({
    status: 'confirmed',
    date: { $gte: today },
  })
    .sort({ date: 1, time: 1 })
    .limit(50)
    .lean();
  return all.filter((a) => phoneDigits(a.phone) === digits).slice(0, 10);
}

async function cancelAppointmentForWa(appointmentId, waId) {
  const appt = await Appointment.findById(appointmentId);
  if (!appt || !apptBelongsToWa(appt, waId)) return { ok: false, reason: 'not_found' };
  if (appt.status !== 'confirmed') return { ok: false, reason: 'not_confirmed' };
  appt.status = 'cancelled';
  await appt.save();
  return { ok: true, appt };
}

async function rescheduleAppointmentForWa(appointmentId, waId, date, time) {
  if (!VALID_SLOTS.includes(time)) {
    throw Object.assign(new Error('Invalid time slot'), { code: 'VALIDATION' });
  }
  if (!isValidAppointmentDate(date)) {
    throw Object.assign(new Error('Invalid date'), { code: 'VALIDATION' });
  }
  const appt = await Appointment.findById(appointmentId);
  if (!appt || !apptBelongsToWa(appt, waId)) {
    throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
  }
  if (appt.status !== 'confirmed') {
    throw Object.assign(new Error('NOT_CONFIRMED'), { code: 'VALIDATION' });
  }
  const existing = await Appointment.findOne({
    date,
    time,
    status: 'confirmed',
    _id: { $ne: appointmentId },
  }).lean();
  if (existing) {
    throw Object.assign(new Error('SLOT_TAKEN'), { code: 'CONFLICT' });
  }
  try {
    appt.date = date;
    appt.time = time;
    await appt.save();
    return appt;
  } catch (err) {
    if (err.code === 11000) {
      throw Object.assign(new Error('SLOT_TAKEN'), { code: 'CONFLICT' });
    }
    throw err;
  }
}

function parseTimeTo24h(timeStr) {
  const m = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h !== 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { h, min };
}

function appointmentUtcMs(dateStr, timeStr) {
  const parts = parseTimeTo24h(timeStr);
  if (!parts) return null;
  const [Y, M, D] = dateStr.split('-').map((x) => parseInt(x, 10));
  if (!Y || !M || !D) return null;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${Y}-${pad(M)}-${pad(D)}T${pad(parts.h)}:${pad(parts.min)}:00+05:30`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function getNextBookableDates(maxDays = 14) {
  const out = [];
  let ymd = todayYmdIst();
  if (!ymd) return out;
  let added = 0;
  let guard = 0;
  while (added < maxDays && guard < 40) {
    guard += 1;
    if (isValidAppointmentDate(ymd)) {
      out.push(ymd);
      added += 1;
    }
    ymd = addDaysYmdIst(ymd, 1);
    if (!ymd) break;
  }
  return out;
}

async function resolvePatientNameForWa(waDigits) {
  const d = String(waDigits).replace(/\D/g, '');
  const user = await User.findOne({
    $or: [{ phone: new RegExp(`${d}$`) }, { phone: `+${d}` }],
  })
    .lean()
    .catch(() => null);
  if (user?.name?.trim()) return user.name.trim().slice(0, 100);
  return `Patient ${d.slice(-4)}`;
}

async function createAppointment({ name, phone, date, time, notes, userId }) {
  if (!name?.trim()) throw Object.assign(new Error('Name is required'), { code: 'VALIDATION' });
  const phoneStr = String(phone).trim();
  if (!/^[\d\s+\-]{8,15}$/.test(phoneStr)) {
    throw Object.assign(new Error('Invalid phone number'), { code: 'VALIDATION' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Object.assign(new Error('Invalid date'), { code: 'VALIDATION' });
  }
  if (!isValidAppointmentDate(date)) {
    throw Object.assign(new Error('Cannot book on Sundays or past dates'), { code: 'VALIDATION' });
  }
  if (!VALID_SLOTS.includes(time)) {
    throw Object.assign(new Error('Invalid time slot'), { code: 'VALIDATION' });
  }

  const existing = await Appointment.findOne({ date, time, status: 'confirmed' });
  if (existing) {
    throw Object.assign(new Error('SLOT_TAKEN'), { code: 'CONFLICT' });
  }

  try {
    return await Appointment.create({
      name: name.trim().slice(0, 100),
      phone: phoneStr,
      date,
      time,
      notes: notes ? String(notes).slice(0, 500) : undefined,
      userId,
    });
  } catch (err) {
    if (err.code === 11000) {
      throw Object.assign(new Error('SLOT_TAKEN'), { code: 'CONFLICT' });
    }
    throw err;
  }
}

async function setAppointmentStatus(appointmentId, status) {
  const allowed = ['confirmed', 'cancelled', 'completed', 'no-show'];
  if (!allowed.includes(status)) return null;
  return Appointment.findByIdAndUpdate(
    appointmentId,
    { $set: { status } },
    { new: true }
  ).lean();
}

async function recordReviewRating(appointmentId, rating) {
  const r = Number(rating);
  if (r < 1 || r > 5) return null;
  return Appointment.findByIdAndUpdate(
    appointmentId,
    { $set: { reviewRating: r, reviewSubmittedAt: new Date() } },
    { new: true }
  ).lean();
}

module.exports = {
  VALID_SLOTS,
  isValidAppointmentDate,
  formatPhoneForAppointment,
  phoneDigits,
  apptBelongsToWa,
  getBookedAndBlockedForDate,
  getAvailableSlots,
  getAvailableSlotsForReschedule,
  getNextBookableDates,
  appointmentUtcMs,
  resolvePatientNameForWa,
  createAppointment,
  setAppointmentStatus,
  recordReviewRating,
  listUpcomingAppointmentsForWa,
  cancelAppointmentForWa,
  rescheduleAppointmentForWa,
};
