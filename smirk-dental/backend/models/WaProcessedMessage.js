const mongoose = require('mongoose');

/**
 * WhatsApp webhook message id deduplication (Meta may retry deliveries).
 */
const waProcessedMessageSchema = new mongoose.Schema(
  {
    messageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    waId: {
      type: String,
      trim: true,
      index: true,
    },
  },
  { timestamps: true }
);

waProcessedMessageSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 30 }
);

module.exports = mongoose.model('WaProcessedMessage', waProcessedMessageSchema);
