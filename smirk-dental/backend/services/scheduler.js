const cron = require('node-cron');
const Appointment = require('../models/Appointment');
const { sendWhatsAppMessage } = require('./whatsapp');

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
}

module.exports = { startScheduler };