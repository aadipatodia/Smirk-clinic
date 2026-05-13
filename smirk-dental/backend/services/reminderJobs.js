const Appointment = require('../models/Appointment');
const { appointmentUtcMs } = require('./appointmentService');
const { sendText, sendTemplate } = require('./whatsapp/outbound');

const WINDOW_MS = 12 * 60 * 1000;

function cleanPhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

async function send24hReminder(appt) {
  const to = cleanPhone(appt.phone);
  if (!to) return;
  const name = process.env.WHATSAPP_TEMPLATE_REMINDER_24H;
  if (name) {
    await sendTemplate(to, name, process.env.WHATSAPP_TEMPLATE_LANG || 'en', [
      appt.name || 'there',
      appt.date,
      appt.time,
      process.env.CLINIC_NAME || 'Smirk Dental',
    ]);
  } else {
    await sendText(
      to,
      `🦷 ${process.env.CLINIC_NAME || 'Smirk Dental'}\n\nHi ${appt.name},\n\nReminder: you have an appointment tomorrow (${appt.date}) at ${appt.time}.\n\nSee you soon!`
    );
  }
  await Appointment.updateOne({ _id: appt._id }, { $set: { reminder24hSent: true } });
}

async function send1hReminder(appt) {
  const to = cleanPhone(appt.phone);
  if (!to) return;
  const name = process.env.WHATSAPP_TEMPLATE_REMINDER_1H;
  if (name) {
    await sendTemplate(to, name, process.env.WHATSAPP_TEMPLATE_LANG || 'en', [
      appt.name || 'there',
      appt.time,
      process.env.CLINIC_NAME || 'Smirk Dental',
    ]);
  } else {
    await sendText(
      to,
      `🦷 ${process.env.CLINIC_NAME || 'Smirk Dental'}\n\nHi ${appt.name},\n\nYour appointment is in about 1 hour (${appt.time} today).\n\nSee you soon!`
    );
  }
  await Appointment.updateOne({ _id: appt._id }, { $set: { reminder1hSent: true } });
}

/**
 * Run inside cron (e.g. every 15 minutes, timezone Asia/Kolkata).
 */
async function runAppointmentReminders() {
  const now = Date.now();
  const appts = await Appointment.find({
    status: 'confirmed',
    $or: [{ reminder24hSent: false }, { reminder1hSent: false }],
  }).lean();

  for (const a of appts) {
    const t = appointmentUtcMs(a.date, a.time);
    if (!t) continue;

    const msUntil = t - now;

    if (!a.reminder24hSent) {
      const target = 24 * 60 * 60 * 1000;
      if (Math.abs(msUntil - target) <= WINDOW_MS) {
        try {
          await send24hReminder(a);
        } catch (e) {
          console.error('24h reminder failed', e.message);
        }
      }
    }

    if (!a.reminder1hSent) {
      const target = 60 * 60 * 1000;
      if (Math.abs(msUntil - target) <= WINDOW_MS) {
        try {
          await send1hReminder(a);
        } catch (e) {
          console.error('1h reminder failed', e.message);
        }
      }
    }
  }
}

module.exports = { runAppointmentReminders };
