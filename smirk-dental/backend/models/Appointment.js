// ─────────────────────────────────────────────
// models/Appointment.js
// MongoDB schema for dental appointments
// ─────────────────────────────────────────────

const mongoose = require('mongoose');

const appointmentSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Patient name is required'],
      trim: true,
      maxlength: [100, 'Name too long'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      trim: true,
      match: [/^[\d\s\+\-]{8,15}$/, 'Invalid phone number format'],
    },
    date: {
      type: String,            // stored as 'YYYY-MM-DD'
      required: [true, 'Appointment date is required'],
      match: [/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD'],
    },
    time: {
      type: String,            // stored as 'HH:MM AM/PM'
      required: [true, 'Appointment time is required'],
      trim: true,
    },
    status: {
      type: String,
      enum: ['confirmed', 'cancelled', 'completed', 'no-show'],
      default: 'confirmed',
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reminder24hSent: {
      type: Boolean,
      default: false,
    },
    reminder1hSent: {
      type: Boolean,
      default: false,
    },
    reviewRequestSent: {
      type: Boolean,
      default: false,
    },
    reviewRating: {
      type: Number,
      min: 1,
      max: 5,
    },
    reviewSubmittedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,   // adds createdAt and updatedAt
  }
);
// ── Compound unique index to prevent double booking ──
appointmentSchema.index({ date: 1, time: 1 }, { unique: true });

// ── Index for efficient date queries ──
appointmentSchema.index({ date: 1, status: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
