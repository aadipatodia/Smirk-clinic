const mongoose = require('mongoose');

/** A single visit: procedure, date, and prescription file for one patient profile. */
const patientVisitRecordSchema = new mongoose.Schema(
  {
    patientProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PatientProfile',
      required: true,
      index: true,
    },
    date: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'],
    },
    procedureText: {
      type: String,
      trim: true,
      maxlength: 500,
      required: true,
    },
    prescription: {
      mediaType: {
        type: String,
        enum: ['image', 'document'],
      },
      mimeType: { type: String, trim: true },
      filename: { type: String, trim: true },
      storagePath: { type: String, trim: true },
      waMediaId: { type: String, trim: true },
    },
    /** Typed medicines text (admin portal); used to reload for editing. */
    medicinesText: { type: String, trim: true, maxlength: 3000 },
    createdByWaId: { type: String, trim: true },
    geminiConfidence: { type: Number, min: 0, max: 1 },
  },
  { timestamps: true }
);

patientVisitRecordSchema.index({ patientProfileId: 1, date: -1 });

module.exports = mongoose.model('PatientVisitRecord', patientVisitRecordSchema);
