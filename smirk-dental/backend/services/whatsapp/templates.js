/**
 * Hardcoded WhatsApp template names & languages (approved in Meta Business Manager).
 * Variable order must match each template exactly.
 */

const LANG_EN_US = 'en_US';

/** appointment_reminder_3 — header text {{1}}, body {{1}} name, {{2}} clinic, {{3}} date, {{4}} time */
const APPOINTMENT_REMINDER = {
  name: 'appointment_reminder_3',
  language: LANG_EN_US,
  /** Header: "You have an upcoming {{1}} appointment" */
  header24h: "tomorrow's",
  header1h: "today's",
  /** Check-up reminders reuse this template — header {{1}} = interval label */
  headerCheckup: {
    checkup_monthly: 'monthly',
    checkup_quarterly: 'quarterly',
    checkup_6month: '6-month',
  },
  /** Body {{4}} when no booked slot (check-up nudge) */
  checkupTimePlaceholder: 'book a visit',
};

/** review — body {{1}} name, {{2}} visit date; URL button {{1}} = review link */
const REVIEW_REQUEST = {
  name: 'review',
  language: LANG_EN_US,
  buttonIndex: 0,
};

/**
 * appointment_confirmation_patient — static header "Your appointment is booked"
 * body {{1}} name, {{2}} clinic, {{3}} service, {{4}} date, {{5}} time
 * URL button "View details"
 */
const APPOINTMENT_CONFIRMATION_PATIENT = {
  name: 'appointment_confirmation_patient',
  language: LANG_EN_US,
  buttonIndex: 0,
  defaultService: 'dental visit',
};

/** appointment_cancellation_patient — body {{1}} name, {{2}} date */
const APPOINTMENT_CANCELLATION_PATIENT = {
  name: 'appointment_cancellation_patient',
  language: LANG_EN_US,
};

/**
 * reschedule_patient — body {{1}} name, {{2}} clinic, {{3}} date, {{4}} time
 * URL button "View details"
 */
const RESCHEDULE_PATIENT = {
  name: 'reschedule_patient',
  language: LANG_EN_US,
  buttonIndex: 0,
};

function clinicName() {
  return process.env.CLINIC_NAME || 'Smirk Dental';
}

function appointmentDetailsUrl() {
  return (process.env.FRONTEND_URL || process.env.CLINIC_MAPS_URL || '').trim();
}

module.exports = {
  LANG_EN_US,
  APPOINTMENT_REMINDER,
  REVIEW_REQUEST,
  APPOINTMENT_CONFIRMATION_PATIENT,
  APPOINTMENT_CANCELLATION_PATIENT,
  RESCHEDULE_PATIENT,
  clinicName,
  appointmentDetailsUrl,
};
