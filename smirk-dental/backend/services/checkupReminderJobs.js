const Appointment = require('../models/Appointment');
const OutreachLog = require('../models/OutreachLog');
const { todayYmdIst, monthsAgoYmdIst } = require('./whatsapp/dateIst');
const { phoneDigits } = require('./appointmentService');
const { sendText, sendTemplate } = require('./whatsapp/outbound');

async function hasFutureConfirmedForWa(waDigits) {
  const today = todayYmdIst();
  if (!today) return false;
  const list = await Appointment.find({ status: 'confirmed', date: { $gte: today } })
    .select('phone')
    .lean();
  return list.some((a) => phoneDigits(a.phone) === waDigits);
}

/**
 * Weekly-style job: patients whose last *completed* visit is older than CHECKUP_GAP_MONTHS,
 * no upcoming confirmed visit, and no checkup outreach in CHECKUP_COOLDOWN_DAYS.
 */
async function runCheckupReminders() {
  const gapMonths = Math.min(36, Math.max(1, parseInt(process.env.CHECKUP_GAP_MONTHS || '6', 10)));
  const cooldownDays = Math.min(365, Math.max(7, parseInt(process.env.CHECKUP_COOLDOWN_DAYS || '90', 10)));
  const cutoff = monthsAgoYmdIst(gapMonths);
  if (!cutoff) return;

  const completed = await Appointment.find({ status: 'completed' }).select('phone date').lean();
  const lastByWa = {};
  for (const c of completed) {
    const w = phoneDigits(c.phone);
    if (!w || w.length < 10) continue;
    if (!lastByWa[w] || c.date > lastByWa[w]) lastByWa[w] = c.date;
  }

  const cooldownSince = new Date(Date.now() - cooldownDays * 86400000);

  for (const [waId, lastYmd] of Object.entries(lastByWa)) {
    if (lastYmd >= cutoff) continue;
    if (await hasFutureConfirmedForWa(waId)) continue;

    const recent = await OutreachLog.findOne({
      waId,
      kind: 'checkup',
      sentAt: { $gte: cooldownSince },
    }).lean();
    if (recent) continue;

    try {
      const tpl = process.env.WHATSAPP_TEMPLATE_CHECKUP;
      if (tpl) {
        await sendTemplate(waId, tpl, process.env.WHATSAPP_TEMPLATE_LANG || 'en', [
          process.env.CLINIC_NAME || 'Smirk Dental',
        ]);
      } else {
        await sendText(
          waId,
          `🦷 ${process.env.CLINIC_NAME || 'Smirk Dental'}\n\nIt has been a while since your last visit. When you are ready, open the menu here and tap Book visit to schedule a checkup.`
        );
      }
      await OutreachLog.create({ waId, kind: 'checkup' });
      console.log('📣 Checkup reminder sent to', waId);
    } catch (e) {
      console.error('checkup reminder failed', waId, e.message);
    }
  }
}

module.exports = { runCheckupReminders };
