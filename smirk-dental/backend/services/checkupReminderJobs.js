const Appointment = require('../models/Appointment');
const OutreachLog = require('../models/OutreachLog');
const { todayYmdIst, isAnniversaryDay, monthsSinceVisit } = require('./whatsapp/dateIst');
const { phoneDigits } = require('./appointmentService');
const { sendAppointmentReminderTemplate } = require('./whatsapp/appointmentReminderSend');
const { APPOINTMENT_REMINDER } = require('./whatsapp/templates');

const REMINDER_KINDS = [
  {
    kind: 'checkup_monthly',
    minMonths: 1,
    intervalMonths: 1,
    label: 'monthly',
  },
  {
    kind: 'checkup_quarterly',
    minMonths: 3,
    intervalMonths: 3,
    label: 'quarterly (3-month)',
  },
  {
    kind: 'checkup_6month',
    minMonths: 6,
    intervalMonths: 6,
    label: '6-month',
  },
];

async function hasFutureConfirmedForWa(waDigits) {
  const today = todayYmdIst();
  if (!today) return false;
  const list = await Appointment.find({ status: 'confirmed', date: { $gte: today } })
    .select('phone')
    .lean();
  return list.some((a) => phoneDigits(a.phone) === waDigits);
}

async function alreadySent(waId, kind, periodKey) {
  const existing = await OutreachLog.findOne({ waId, kind, periodKey }).lean();
  return !!existing;
}

function checkupHeaderForKind(kind) {
  return APPOINTMENT_REMINDER.headerCheckup[kind] || 'check-up';
}

/** One template message per check-up type (monthly / quarterly / 6-month). */
async function sendCheckupReminder(waId, dueConfigs, { name, dueDate }) {
  for (const cfg of dueConfigs) {
    await sendAppointmentReminderTemplate(waId, {
      headerText: checkupHeaderForKind(cfg.kind),
      name,
      date: dueDate,
      time: APPOINTMENT_REMINDER.checkupTimePlaceholder,
    });
  }
}

function isDueForInterval(months, cfg) {
  return months >= cfg.minMonths && months % cfg.intervalMonths === 0;
}

/**
 * Daily job (9:00 IST): patients whose last *completed* visit anniversary falls today
 * receive monthly, quarterly, and/or 6-month check-up reminders on WhatsApp.
 */
async function runCheckupReminders() {
  const today = todayYmdIst();
  if (!today) return;

  const completed = await Appointment.find({ status: 'completed' })
    .select('phone date name')
    .lean();

  const lastByWa = {};
  for (const c of completed) {
    const w = phoneDigits(c.phone);
    if (!w || w.length < 10) continue;
    if (!lastByWa[w] || c.date > lastByWa[w].date) {
      lastByWa[w] = { date: c.date, name: c.name?.trim() || 'there' };
    }
  }

  for (const [waId, { name }] of Object.entries(lastByWa)) {
    const lastDate = lastByWa[waId].date;
    if (!isAnniversaryDay(lastDate, today)) continue;
    if (await hasFutureConfirmedForWa(waId)) continue;

    const months = monthsSinceVisit(lastDate, today);
    const dueConfigs = REMINDER_KINDS.filter((cfg) => isDueForInterval(months, cfg));
    if (!dueConfigs.length) continue;

    const periodKey = today;
    const unsent = [];
    for (const cfg of dueConfigs) {
      if (!(await alreadySent(waId, cfg.kind, periodKey))) unsent.push(cfg);
    }
    if (!unsent.length) continue;

    try {
      await sendCheckupReminder(waId, unsent, { name, dueDate: today });
      for (const cfg of unsent) {
        await OutreachLog.create({ waId, kind: cfg.kind, periodKey });
      }
      const labels = unsent.map((c) => c.label).join(', ');
      console.log(`📣 Checkup reminder (${labels}) sent to`, waId);
    } catch (e) {
      console.error('checkup reminder failed', waId, e.message);
    }
  }
}

module.exports = { runCheckupReminders };
