const mongoose = require('mongoose');

/** One profile per patient phone — visit records are appended over time. */
const patientProfileSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    lastVisitDate: {
      type: String,
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PatientProfile', patientProfileSchema);
