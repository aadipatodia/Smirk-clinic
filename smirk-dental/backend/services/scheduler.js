const cron = require('node-cron');
const { runAppointmentReminders } = require('./reminderJobs');
const { runCheckupReminders } = require('./checkupReminderJobs');
const { runPostAppointmentReviewPrompts } = require('./reviewRequestJobs');
const { sendDoctorTomorrowSchedule } = require('./doctorNotifications');

function startScheduler() {
    // Doctor: tomorrow's schedule every day at 8 PM IST
    cron.schedule('0 20 * * *', async () => {
        try {
            await sendDoctorTomorrowSchedule();
        } catch (err) {
            console.error('❌ Doctor schedule job error:', err.message);
        }
    }, {
        timezone: 'Asia/Kolkata',
    });

    // Patient reminders (~24h and ~1h before) + post-visit review (~30m after)
    cron.schedule('*/15 * * * *', async () => {
        try {
            await runAppointmentReminders();
        } catch (err) {
            console.error('❌ Reminder job error:', err.message);
        }
        try {
            await runPostAppointmentReviewPrompts();
        } catch (err) {
            console.error('❌ Review prompt job error:', err.message);
        }
    }, {
        timezone: 'Asia/Kolkata',
    });

    // Periodic checkup / follow-up nudge (Mondays 9:00 IST)
    cron.schedule('0 9 * * 1', async () => {
        try {
            await runCheckupReminders();
        } catch (err) {
            console.error('❌ Checkup reminder job:', err.message);
        }
    }, {
        timezone: 'Asia/Kolkata',
    });
}

module.exports = { startScheduler };