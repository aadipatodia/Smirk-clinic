const Appointment = require('../models/Appointment');
const { appointmentUtcMs } = require('./appointmentService');
const { sendReviewPromptToPatient } = require('./whatsapp/reviewPrompt');

const REVIEW_DELAY_MS = 30 * 60 * 1000;
const WINDOW_MS = 20 * 60 * 1000;

/**
 * Send "rate us" ~30 minutes after the scheduled appointment time (IST).
 * Runs inside the 15-minute cron (Asia/Kolkata).
 */
async function runPostAppointmentReviewPrompts() {
  const now = Date.now();
  const appts = await Appointment.find({
    status: { $in: ['confirmed', 'completed'] },
    reviewRequestSent: false,
    reviewSubmittedAt: { $exists: false },
  }).lean();

  for (const a of appts) {
    const apptMs = appointmentUtcMs(a.date, a.time);
    if (!apptMs) continue;

    const elapsed = now - apptMs;
    if (elapsed < REVIEW_DELAY_MS || elapsed > REVIEW_DELAY_MS + WINDOW_MS) continue;

    try {
      await sendReviewPromptToPatient(a);
    } catch (e) {
      console.error('post-appointment review failed', a._id, e.message);
    }
  }
}

module.exports = { runPostAppointmentReviewPrompts };
