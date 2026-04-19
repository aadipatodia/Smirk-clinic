const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const { sendWhatsAppMessage } = require('./whatsapp');
const { runAppointmentReminders } = require('./reminderJobs');
const { runCheckupReminders } = require('./checkupReminderJobs');

function formatDate(date) {
    return date.toISOString().split('T')[0];
}

function getTomorrowDateIST() {
    const now = new Date(
        new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' })
    );
    now.setDate(now.getDate() + 1);
    return formatDate(now);
}

function startScheduler() {
    // ⏰ Runs every day at 8 PM IST
    cron.schedule('0 20 * * *', async () => {
        console.log("⏰ Running admin summary job...");

        try {
            const tomorrow = getTomorrowDateIST();

            const appointments = await Appointment.find({
                date: tomorrow,
                status: 'confirmed'
            }).sort({ time: 1 });

            if (!appointments.length) {
                console.log("No appointments for tomorrow");
                return;
            }

            let message = `🦷 ${process.env.CLINIC_NAME}\n\n`;
            message += `Appointments for Tomorrow (${tomorrow}):\n\n`;

            appointments.forEach((a, i) => {
                message += `${i + 1}. ${a.name} — ${a.time}\n`;
            });

            message += `\nTotal: ${appointments.length} appointments`;

            await sendWhatsAppMessage(process.env.ADMIN_PHONE, message);

            console.log("✅ Admin summary sent");

        } catch (err) {
            console.error("❌ Scheduler error:", err.message);
        }
    }, {
        timezone: "Asia/Kolkata"
    });

    // Patient reminders (~24h and ~1h before appointment, IST wall clock)
    cron.schedule('*/15 * * * *', async () => {
        try {
            await runAppointmentReminders();
        } catch (err) {
            console.error('❌ Reminder job error:', err.message);
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