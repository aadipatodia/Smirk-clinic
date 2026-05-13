const mongoose = require('mongoose');

/** Dedupe periodic WhatsApp outreach (e.g. checkup nudges) per wa_id + kind. */
const outreachLogSchema = new mongoose.Schema(
  {
    waId: { type: String, required: true, trim: true, index: true },
    kind: { type: String, required: true, enum: ['checkup'], index: true },
    sentAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

outreachLogSchema.index({ waId: 1, kind: 1, sentAt: -1 });

module.exports = mongoose.model('OutreachLog', outreachLogSchema);
