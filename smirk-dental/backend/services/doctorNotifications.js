const { sendText } = require('./whatsapp/outbound');

function getDoctorWaId() {
  const raw = process.env.DOCTOR_WA_ID || process.env.ADMIN_PHONE || '';
  const digits = String(raw).replace(/\D/g, '');
  return digits || null;
}

function clinicLabel() {
  return process.env.CLINIC_NAME || 'Smirk Dental';
}

function patientLine(appt) {
  const name = appt?.name?.trim() || 'A patient';
  const phone = appt?.phone ? ` (${appt.phone})` : '';
  return `${name}${phone}`;
}

function slotLine(date, time) {
  return `📅 ${date}\n🕐 ${time}`;
}

async function notifyDoctorAppointmentConfirmed(appt) {
  const to = getDoctorWaId();
  if (!to) return;
  const body = [
    `🦷 ${clinicLabel()}`,
    '',
    `${patientLine(appt)} confirmed an appointment:`,
    '',
    slotLine(appt.date, appt.time),
  ].join('\n');
  await sendText(to, body);
}

async function notifyDoctorAppointmentCancelled(appt) {
  const to = getDoctorWaId();
  if (!to) return;
  const body = [
    `🦷 ${clinicLabel()}`,
    '',
    `${patientLine(appt)} cancelled an appointment:`,
    '',
    slotLine(appt.date, appt.time),
  ].join('\n');
  await sendText(to, body);
}

async function notifyDoctorAppointmentRescheduled(appt, oldDate, oldTime) {
  const to = getDoctorWaId();
  if (!to) return;
  const body = [
    `🦷 ${clinicLabel()}`,
    '',
    `${patientLine(appt)} rescheduled an appointment:`,
    '',
    `Was: ${oldDate} at ${oldTime}`,
    `Now: ${appt.date} at ${appt.time}`,
  ].join('\n');
  await sendText(to, body);
}

module.exports = {
  notifyDoctorAppointmentConfirmed,
  notifyDoctorAppointmentCancelled,
  notifyDoctorAppointmentRescheduled,
};
