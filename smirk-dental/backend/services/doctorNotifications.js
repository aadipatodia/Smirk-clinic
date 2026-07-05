const { sendText, sendTemplate } = require('./whatsapp/outbound');
const { TOMORROWS_APPOINTMENTS_DOC, WEEKS_APPOINTMENT, doctorName } = require('./whatsapp/templates');

function getDoctorWaId() {
  const raw = process.env.DOCTOR_WA_ID || process.env.ADMIN_PHONE || '';
  const digits = String(raw).replace(/\D/g, '');
  return digits || null;
}

function clinicLabel() {
  return process.env.CLINIC_NAME || 'Smirk Dental';
}

function patientDetails(appt) {
  const name = appt?.name?.trim();
  const phone = appt?.phone?.trim();
  const lines = [];
  if (name) lines.push(`👤 ${name}`);
  if (phone) lines.push(`📞 ${phone}`);
  if (!lines.length) lines.push('👤 A patient');
  return lines.join('\n');
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
    `${patientDetails(appt)}`,
    '',
    'Confirmed an appointment:',
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
    `${patientDetails(appt)}`,
    '',
    'Cancelled an appointment:',
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
    `${patientDetails(appt)}`,
    '',
    'Rescheduled an appointment:',
    '',
    `Was: ${oldDate} at ${oldTime}`,
    `Now: ${appt.date} at ${appt.time}`,
  ].join('\n');
  await sendText(to, body);
}

async function sendDoctorTomorrowSchedule() {
  const to = getDoctorWaId();
  if (!to) return;
  const { buildTomorrowAppointmentsList } = require('./whatsapp/flows/doctorFlow');
  const appointmentList = await buildTomorrowAppointmentsList();
  const tpl = TOMORROWS_APPOINTMENTS_DOC;
  await sendTemplate(
    to,
    tpl.name,
    tpl.language,
    [doctorName(), appointmentList],
    { strict: true }
  );
}

async function sendDoctorWeekSchedule() {
  const to = getDoctorWaId();
  if (!to) return;
  const { buildWeekAppointmentsList } = require('./whatsapp/flows/doctorFlow');
  const appointmentList = await buildWeekAppointmentsList();
  const tpl = WEEKS_APPOINTMENT;
  await sendTemplate(
    to,
    tpl.name,
    tpl.language,
    [doctorName(), appointmentList],
    { strict: true }
  );
}

module.exports = {
  notifyDoctorAppointmentConfirmed,
  notifyDoctorAppointmentCancelled,
  notifyDoctorAppointmentRescheduled,
  sendDoctorTomorrowSchedule,
  sendDoctorWeekSchedule,
};
