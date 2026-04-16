// ─────────────────────────────────────────────
// routes/appointments.js
// GET  /appointments?date=YYYY-MM-DD  → booked slots
// POST /appointments                  → create booking
// ─────────────────────────────────────────────

const express = require('express');
const { body, query, validationResult } = require('express-validator');
const router = express.Router();
const Appointment = require('../models/Appointment');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const Unavailable = require('../models/Unavailable');

// ── Valid time slots (must match frontend ALL_SLOTS) ──
const VALID_SLOTS = [
  '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '01:00 PM',
  '01:45 PM', '02:15 PM', '02:45 PM', '03:15 PM', '03:45 PM',
  '04:15 PM', '04:45 PM', '05:15 PM', '05:45 PM', '06:15 PM', '06:30 PM',
];

// ── Helper: validate date is not Sunday and not in the past ──
function isValidAppointmentDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isNaN(d)) return false;
  if (d.getDay() === 0) return false;             // No Sundays
  const today = new Date();
  today.setHours(0, 0, 0, 0);
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
   GET /appointments/all?date=YYYY-MM-DD
   Returns list of booked time slots for a date
═══════════════════════════════════════════════ */
router.get(
  '/',
  validate([
    query('date')
      .matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date must be YYYY-MM-DD')
      .custom(d => {
        if (!isValidAppointmentDate(d)) throw new Error('Invalid date');
        return true;
      }),
  ]),
  async (req, res) => {
    try {
      const { date } = req.query;

      // 🔹 Get booked appointments
      const booked = await Appointment.find(
        { date, status: { $in: ['confirmed'] } },
        'time -_id'
      ).lean();

      let bookedSlots = booked.map(a => a.time);

      // 🔹 Get blocked slots (admin)
      const blocked = await Unavailable.find({ date }).lean();

      const blockedSlots = [];

      blocked.forEach(b => {
        if (b.time) {
          blockedSlots.push(b.time);
        } else {
          blockedSlots.push(null); // full day block
        }
      });

      // 🔹 Remove duplicates from booked slots
      const uniqueBooked = [...new Set(bookedSlots)];

      // 🔹 Final response
      return res.json({
        success: true,
        date,
        bookedSlots: uniqueBooked,
        blockedSlots
      });

    } catch (err) {
      console.error('[GET /appointments]', err);
      return res.status(500).json({
        success: false,
        message: 'Server error'
      });
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


      if (process.env.WHATSAPP_TOKEN) {
        try {
          const message = `
🦷 ${process.env.CLINIC_NAME}

Hello ${appointment.name},

Your appointment is confirmed!

📅 Date: ${appointment.date}
🕐 Time: ${appointment.time}

📍 Smirk Dental Clinic, Vasant Kunj

See you soon 😊
`;

          const cleanPhone = appointment.phone.replace(/\D/g, '');
          await sendWhatsAppMessage(cleanPhone, message);

        } catch (err) {
          console.error("WhatsApp failed:", err.message);
        }
      }
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
   GET /appointments/all/all (admin)
═══════════════════════════════════════════════ */
router.get('/all', async (req, res) => {
  try {
    const appointments = await Appointment.find()
      .sort({ date: 1, time: 1 })
      .lean();

    res.json({
      success: true,
      appointments
    });
  } catch (err) {
    console.error('[ADMIN FETCH]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

/* ═══════════════════════════════════════════════
   DELETE /appointments/:id  (optional - for admin)
   Cancel an appointment
═══════════════════════════════════════════════ */
router.put('/:id/cancel', async (req, res) => {
  try {
    const updated = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    );

    res.json({
      success: true,
      appointment: updated
    });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ═════════ RESCHEDULE APPOINTMENT ═════════
router.put('/:id', async (req, res) => {
  try {
    const { date, time } = req.body;

    const existing = await Appointment.findOne({
      date,
      time,
      status: 'confirmed',
      _id: { $ne: req.params.id }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Slot already booked'
      });
    }

    const updated = await Appointment.findByIdAndUpdate(
      req.params.id,
      { date, time },
      { new: true }
    );

    res.json({
      success: true,
      appointment: updated
    });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.post('/:id/review', async (req, res) => {
  try {
    const appt = await Appointment.findById(req.params.id);

    const message = `
Thank you for visiting ${process.env.CLINIC_NAME} 😊

We would love your feedback:

⭐ https://search.google.com/local/writereview?placeid=ChIJYbabucgdDTkRAFAQTaS2fHM
`;

    const cleanPhone = appt.phone.replace(/\D/g, '');
    await sendWhatsAppMessage(cleanPhone, message);

    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
