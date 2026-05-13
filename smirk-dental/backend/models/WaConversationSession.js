const mongoose = require('mongoose');

/**
 * Deterministic WhatsApp conversation state (button-driven flows).
 * Keyed by normalized WhatsApp wa_id (digits only, no +).
 */
const waConversationSessionSchema = new mongoose.Schema(
  {
    waId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['doctor', 'patient'],
      default: 'patient',
    },
    flow: {
      type: String,
      default: 'idle',
      trim: true,
      maxlength: 64,
    },
    step: {
      type: String,
      default: '0',
      trim: true,
      maxlength: 64,
    },
    context: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    lastActionId: {
      type: String,
      trim: true,
      maxlength: 256,
    },
  },
  { timestamps: true }
);

waConversationSessionSchema.index({ updatedAt: 1 });

module.exports = mongoose.model('WaConversationSession', waConversationSessionSchema);
