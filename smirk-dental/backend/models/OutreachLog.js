const mongoose = require('mongoose');

/** Dedupe periodic WhatsApp outreach (checkup reminders) per wa_id + kind + period. */
const outreachLogSchema = new mongoose.Schema(
  {
    waId: { type: String, required: true, trim: true, index: true },
    kind: {
      type: String,
      required: true,
      enum: ['checkup', 'checkup_monthly', 'checkup_quarterly', 'checkup_6month'],
      index: true,
    },
    /** IST date YYYY-MM-DD when the reminder was due (prevents duplicate sends). */
    periodKey: { type: String, trim: true, index: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

outreachLogSchema.index({ waId: 1, kind: 1, periodKey: 1 }, { unique: true, sparse: true });
outreachLogSchema.index({ waId: 1, kind: 1, sentAt: -1 });

module.exports = mongoose.model('OutreachLog', outreachLogSchema);
