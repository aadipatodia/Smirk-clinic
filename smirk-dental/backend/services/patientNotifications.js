const { sendText } = require('./whatsapp/outbound');

function clinicLabel() {
  return process.env.CLINIC_NAME || 'Smirk Dental';
}

function patientWaId(appt) {
  const digits = String(appt?.phone || '').replace(/\D/g, '');
  return digits || null;
}

async function notifyPatientAppointmentCancelled(appt) {
  const to = patientWaId(appt);
  if (!to) return;
  const name = appt?.name?.trim() || 'there';
  const body = [
    `🦷 ${clinicLabel()}`,
    '',
    `Hi ${name},`,
    '',
    `Your appointment on ${appt.date} at ${appt.time} has been cancelled by the clinic.`,
    '',
    'To book a new visit, message us here or visit our website.',
  ].join('\n');
  await sendText(to, body);
}

async function notifyPatientAppointmentRescheduled(appt, oldDate, oldTime) {
  const to = patientWaId(appt);
  if (!to) return;
  const name = appt?.name?.trim() || 'there';
  const body = [
    `🦷 ${clinicLabel()}`,
    '',
    `Hi ${name},`,
    '',
    'Your appointment has been rescheduled by the clinic:',
    '',
    `Was: ${oldDate} at ${oldTime}`,
    `Now: ${appt.date} at ${appt.time}`,
    '',
    'See you at the clinic!',
  ].join('\n');
  await sendText(to, body);
}

module.exports = {
  notifyPatientAppointmentCancelled,
  notifyPatientAppointmentRescheduled,
};
