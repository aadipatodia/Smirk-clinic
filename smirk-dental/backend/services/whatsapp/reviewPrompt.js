const Appointment = require('../../models/Appointment');
const { getGoogleReviewUrl } = require('../googleReviewUrl');
const { sendTemplate } = require('./outbound');
const { REVIEW_REQUEST } = require('./templates');

function patientWaTo(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (!d || d.length < 10) return null;
  if (d.length === 10 && /^[6-9]/.test(d)) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  return d;
}

/** YYYY-MM-DD → "Jan 1, 2025" for template display */
function formatVisitDate(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd || '';
  const [y, m, d] = ymd.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[m - 1]} ${d}, ${y}`;
}

/**
 * Ask patient to leave a Google review after their visit (approved template).
 */
async function sendReviewPromptToPatient(appointment) {
  if (!appointment?.phone) return;
  const to = patientWaTo(appointment.phone);
  if (!to) return;

  const reviewUrl = getGoogleReviewUrl();
  if (!reviewUrl) {
    console.error('sendReviewPromptToPatient: review URL not configured');
    return;
  }

  const name = appointment.name?.trim() || 'there';
  const visitDate = formatVisitDate(appointment.date);
  const tpl = REVIEW_REQUEST;

  try {
    await sendTemplate(to, tpl.name, tpl.language, [name, visitDate], {
      strict: true,
      urlButton: { index: tpl.buttonIndex, url: reviewUrl },
    });
    await Appointment.updateOne({ _id: appointment._id }, { $set: { reviewRequestSent: true } });
  } catch (e) {
    console.error('sendReviewPromptToPatient:', e.message);
    throw e;
  }
}

module.exports = { sendReviewPromptToPatient, formatVisitDate };
