const Appointment = require('../../models/Appointment');
const { getGoogleReviewUrl } = require('../googleReviewUrl');
const { sendCtaUrl } = require('./outbound');

/**
 * Ask patient to leave a Google review after their visit.
 */
async function sendReviewPromptToPatient(appointment) {
  if (!appointment?.phone) return;
  const clean = String(appointment.phone).replace(/\D/g, '');
  if (!clean) return;

  const clinic = process.env.CLINIC_NAME || 'Smirk Dental';
  const reviewUrl = getGoogleReviewUrl();
  const body = [
    `Thank you for visiting ${clinic}! 😊`,
    '',
    'We hope you had a great experience. Would you take a moment to leave us a Google review?',
    '',
    reviewUrl,
  ].join('\n');

  try {
    await sendCtaUrl(clean, body, 'Rate on Google', reviewUrl);
    await Appointment.updateOne(
      { _id: appointment._id },
      { $set: { reviewRequestSent: true } }
    );
  } catch (e) {
    console.error('sendReviewPromptToPatient:', e.message);
  }
}

module.exports = { sendReviewPromptToPatient };
