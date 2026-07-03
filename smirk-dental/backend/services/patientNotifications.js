const { sendTemplate } = require('./whatsapp/outbound');
const {
  APPOINTMENT_CONFIRMATION_PATIENT,
  APPOINTMENT_CANCELLATION_PATIENT,
  RESCHEDULE_PATIENT,
  clinicName,
  appointmentDetailsUrl,
} = require('./whatsapp/templates');
const { patientWaTo } = require('./whatsapp/appointmentReminderSend');
const { formatVisitDate } = require('./whatsapp/reviewPrompt');

function appointmentServiceLabel(appt) {
  const notes = appt?.notes?.trim();
  if (notes && notes.length >= 2) return notes.slice(0, 100);
  return APPOINTMENT_CONFIRMATION_PATIENT.defaultService;
}

async function notifyPatientAppointmentCancelled(appt) {
  const to = patientWaTo(appt?.phone);
  if (!to) return;

  const tpl = APPOINTMENT_CANCELLATION_PATIENT;
  await sendTemplate(
    to,
    tpl.name,
    tpl.language,
    [appt.name?.trim() || 'there', formatVisitDate(appt.date)],
    { strict: true }
  );
}

async function notifyPatientAppointmentRescheduled(appt, oldDate, oldTime) {
  const to = patientWaTo(appt?.phone);
  if (!to) return;

  const tpl = RESCHEDULE_PATIENT;
  const bodyParams = [
    appt.name?.trim() || 'there',
    clinicName(),
    formatVisitDate(appt.date),
    appt.time,
  ];

  const detailsUrl = appointmentDetailsUrl();
  const options = { strict: true };
  if (detailsUrl) {
    options.urlButton = { index: tpl.buttonIndex, url: detailsUrl };
  }

  await sendTemplate(to, tpl.name, tpl.language, bodyParams, options);
}

async function notifyPatientAppointmentConfirmed(appt) {
  const to = patientWaTo(appt?.phone);
  if (!to) return;

  const tpl = APPOINTMENT_CONFIRMATION_PATIENT;
  const bodyParams = [
    appt.name?.trim() || 'there',
    clinicName(),
    appointmentServiceLabel(appt),
    formatVisitDate(appt.date),
    appt.time,
  ];

  const detailsUrl = appointmentDetailsUrl();
  const options = { strict: true };
  if (detailsUrl) {
    options.urlButton = { index: tpl.buttonIndex, url: detailsUrl };
  }

  await sendTemplate(to, tpl.name, tpl.language, bodyParams, options);
}

module.exports = {
  notifyPatientAppointmentCancelled,
  notifyPatientAppointmentRescheduled,
  notifyPatientAppointmentConfirmed,
};
