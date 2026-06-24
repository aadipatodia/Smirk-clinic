const Appointment = require('../models/Appointment');
const OutreachLog = require('../models/OutreachLog');
const { todayYmdIst, isAnniversaryDay, monthsSinceVisit } = require('./whatsapp/dateIst');
const { phoneDigits } = require('./appointmentService');
const { sendText, sendTemplate } = require('./whatsapp/outbound');

const REMINDER_KINDS = [
  {
    kind: 'checkup_monthly',
    minMonths: 1,
    intervalMonths: 1,
    label: 'monthly',
    templateEnv: 'WHATSAPP_TEMPLATE_CHECKUP_MONTHLY',
  },
  {
    kind: 'checkup_quarterly',
    minMonths: 3,
    intervalMonths: 3,
    label: 'quarterly (3-month)',
    templateEnv: 'WHATSAPP_TEMPLATE_CHECKUP_QUARTERLY',
  },
  {
    kind: 'checkup_6month',
    minMonths: 6,
    intervalMonths: 6,
    label: '6-month',
    templateEnv: 'WHATSAPP_TEMPLATE_CHECKUP_6MONTH',
  },
];

function clinicLabel() {
  return process.env.CLINIC_NAME || 'Smirk Dental';
}

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

function buildCombinedMessage(dueConfigs, { name, lastDate }) {
  const clinic = process.env.CLINIC_NAME || 'Smirk Dental';
  const lines = dueConfigs.map((c) => `• ${c.label.charAt(0).toUpperCase() + c.label.slice(1)} check-up`);
  return [
    `🦷 ${clinic}`,
    '',
    `Hi ${name},`,
    '',
    'Your dental check-up is due today:',
    ...lines,
    '',
    `Last visit: ${lastDate}`,
    '',
    'Message us here or tap Book visit to schedule when it suits you.',
  ].join('\n');
}

async function sendCheckupReminder(waId, dueConfigs, { name, lastDate }) {
  const tpl = process.env.WHATSAPP_TEMPLATE_CHECKUP;
  if (tpl && dueConfigs.length === 1) {
    const cfg = dueConfigs[0];
    const specificTpl = process.env[cfg.templateEnv];
    if (specificTpl) {
      await sendTemplate(waId, specificTpl, process.env.WHATSAPP_TEMPLATE_LANG || 'en', [name, lastDate, clinicLabel()]);
      return;
    }
  }
  await sendText(waId, buildCombinedMessage(dueConfigs, { name, lastDate }));
}

function isDueForInterval(months, cfg) {
  return months >= cfg.minMonths && months % cfg.intervalMonths === 0;
}

/**
 * Daily job (9:00 IST): patients whose last *completed* visit anniversary falls today
 * receive monthly, quarterly, and/or 6-month check-up reminders on WhatsApp.
 * Example: last visit 2026-06-24 → monthly on every 24th, quarterly on 24th every 3 months, etc.
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

  for (const [waId, { date: lastDate, name }] of Object.entries(lastByWa)) {
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
      await sendCheckupReminder(waId, unsent, { name, lastDate });
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
