const { sendTemplate } = require('./outbound');
const { APPOINTMENT_REMINDER, clinicName } = require('./templates');

function patientWaTo(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d || d.length < 10) return null;
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d;
}

/** Body {{1}} name, {{2}} clinic, {{3}} date, {{4}} time */
function reminderBodyParams({ name, date, time }) {
  return [name?.trim() || 'there', clinicName(), date, time];
}

/**
 * Send appointment_reminder_3 (header text + body name/clinic/date/time).
 */
async function sendAppointmentReminderTemplate(to, { headerText, name, date, time }) {
  const wa = patientWaTo(to);
  if (!wa) throw new Error('Invalid patient phone');

  const tpl = APPOINTMENT_REMINDER;
  await sendTemplate(wa, tpl.name, tpl.language, reminderBodyParams({ name, date, time }), {
    strict: true,
    headerText,
  });
}

module.exports = {
  patientWaTo,
  sendAppointmentReminderTemplate,
};
