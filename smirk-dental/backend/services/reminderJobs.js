const Appointment = require('../models/Appointment');
const { appointmentUtcMs } = require('./appointmentService');
const { sendAppointmentReminderTemplate } = require('./whatsapp/appointmentReminderSend');
const { APPOINTMENT_REMINDER } = require('./whatsapp/templates');

const WINDOW_MS = 12 * 60 * 1000;

async function send24hReminder(appt) {
  await sendAppointmentReminderTemplate(appt.phone, {
    headerText: APPOINTMENT_REMINDER.header24h,
    name: appt.name,
    date: appt.date,
    time: appt.time,
  });
  await Appointment.updateOne({ _id: appt._id }, { $set: { reminder24hSent: true } });
}

async function send1hReminder(appt) {
  await sendAppointmentReminderTemplate(appt.phone, {
    headerText: APPOINTMENT_REMINDER.header1h,
    name: appt.name,
    date: appt.date,
    time: appt.time,
  });
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
          console.error('24h reminder failed', a.phone, e.message);
        }
      }
    }

    if (!a.reminder1hSent) {
      const target = 60 * 60 * 1000;
      if (Math.abs(msUntil - target) <= WINDOW_MS) {
        try {
          await send1hReminder(a);
        } catch (e) {
          console.error('1h reminder failed', a.phone, e.message);
        }
      }
    }
  }
}

module.exports = { runAppointmentReminders };
