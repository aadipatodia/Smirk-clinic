const Appointment = require('../../models/Appointment');
const { sendListMessage } = require('./outbound');

/**
 * Ask patient to rate visit (1–5) via list reply. Id format: RVW:<stars>:<appointmentId>
 */
async function sendReviewPromptToPatient(appointment) {
  if (!appointment?.phone) return;
  const clean = String(appointment.phone).replace(/\D/g, '');
  if (!clean) return;

  const id = String(appointment._id);
  const rows = [5, 4, 3, 2, 1].map((n) => ({
    id: `RVW:${n}:${id}`,
    title: `${'⭐'.repeat(n)} (${n}/5)`,
    description: 'Tap to submit',
  }));

  try {
    await sendListMessage(
      clean,
      `How was your visit with ${process.env.CLINIC_NAME || 'us'}?\n\nPlease rate your experience:`,
      'Rate visit',
      rows,
      'Feedback'
    );
    await Appointment.updateOne(
      { _id: appointment._id },
      { $set: { reviewRequestSent: true } }
    );
  } catch (e) {
    console.error('sendReviewPromptToPatient:', e.message);
  }
}

module.exports = { sendReviewPromptToPatient };
