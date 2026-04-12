// ─────────────────────────────────────────────
// routes/appointments.js
// GET  /appointments?date=YYYY-MM-DD  → booked slots
// POST /appointments                  → create booking
// ─────────────────────────────────────────────

const express    = require('express');
const { body, query, validationResult } = require('express-validator');
const router     = express.Router();
const Appointment = require('../models/Appointment');

// ── Valid time slots (must match frontend ALL_SLOTS) ──
const VALID_SLOTS = [
  '09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
  '12:00 PM','12:30 PM','01:00 PM',
  '01:45 PM','02:15 PM','02:45 PM','03:15 PM','03:45 PM',
  '04:15 PM','04:45 PM','05:15 PM','05:45 PM','06:15 PM','06:30 PM',
];

// ── Helper: validate date is not Sunday and not in the past ──
function isValidAppointmentDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return false;
  if (d.getDay() === 0) return false;             // No Sundays
  const today = new Date();
  today.setHours(0,0,0,0);
  return d >= today;
}

// ── Validation middleware helper ──
const validate = (rules) => [
  ...rules,
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: errors.array()[0].msg,
        errors: errors.array(),
      });
    }
    next();
  },
];

/* ═══════════════════════════════════════════════
   GET /appointments?date=YYYY-MM-DD
   Returns list of booked time slots for a date
═══════════════════════════════════════════════ */
router.get(
  '/',
  validate([
    query('date')
      .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date must be YYYY-MM-DD')
      .custom(d => { if (!isValidAppointmentDate(d)) throw new Error('Invalid date'); return true; }),
  ]),
  async (req, res) => {
    try {
      const { date } = req.query;

      // Find all confirmed appointments for that date
      const booked = await Appointment.find(
        { date, status: { $in: ['confirmed'] } },
        'time -_id'
      ).lean();

      const bookedSlots = booked.map(a => a.time);
      const availableSlots = VALID_SLOTS.filter(s => !bookedSlots.includes(s));

      return res.json({
        success: true,
        date,
        bookedSlots,
        availableSlots,
        total: VALID_SLOTS.length,
        available: availableSlots.length,
      });
    } catch (err) {
      console.error('[GET /appointments]', err);
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

/* ═══════════════════════════════════════════════
   POST /appointments
   Body: { name, phone, date, time }
   Creates a new appointment, prevents double booking
═══════════════════════════════════════════════ */
router.post(
  '/',
  validate([
    body('name')
      .trim().notEmpty().withMessage('Name is required')
      .isLength({ max: 100 }).withMessage('Name too long'),
    body('phone')
      .trim().notEmpty().withMessage('Phone is required')
      .matches(/^[\d\s\+\-]{8,15}$/).withMessage('Invalid phone number'),
    body('date')
      .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be YYYY-MM-DD')
      .custom(d => {
        if (!isValidAppointmentDate(d)) throw new Error('Cannot book on Sundays or past dates');
        return true;
      }),
    body('time')
      .trim().notEmpty().withMessage('Time is required')
      .custom(t => {
        if (!VALID_SLOTS.includes(t)) throw new Error('Invalid time slot');
        return true;
      }),
  ]),
  async (req, res) => {
    const { name, phone, date, time, notes } = req.body;

    try {
      // ── Check for double booking ──
      const existing = await Appointment.findOne({ date, time, status: 'confirmed' });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `The ${time} slot on ${date} is already booked. Please choose a different time.`,
        });
      }

      // ── Create appointment ──
      const appointment = await Appointment.create({ name, phone, date, time, notes });

      // ── Optional: Send email notification ──
      // sendBookingEmail(appointment).catch(err => console.error('Email error:', err));

      return res.status(201).json({
        success: true,
        message: 'Appointment booked successfully!',
        appointment: {
          id: appointment._id,
          name: appointment.name,
          date: appointment.date,
          time: appointment.time,
          status: appointment.status,
          createdAt: appointment.createdAt,
        },
      });
    } catch (err) {
      // MongoDB duplicate key error (race condition safety)
      if (err.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'This slot was just booked by another patient. Please choose a different time.',
        });
      }
      console.error('[POST /appointments]', err);
      return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
  }
);

/* ═══════════════════════════════════════════════
   DELETE /appointments/:id  (optional - for admin)
   Cancel an appointment
═══════════════════════════════════════════════ */
router.delete('/:id', async (req, res) => {
  try {
    const appt = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );
    if (!appt) return res.status(404).json({ success: false, message: 'Appointment not found' });
    return res.json({ success: true, message: 'Appointment cancelled', appointment: appt });
  } catch (err) {
    console.error('[DELETE /appointments]', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
