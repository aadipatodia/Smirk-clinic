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
const {
  VALID_SLOTS,
  isValidAppointmentDate,
  getBookedAndBlockedForDate,
  createAppointment,
} = require('../services/appointmentService');

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

router.get(
  '/',
  validate([
    query('date')
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('date must be YYYY-MM-DD')
      .custom((d) => {
        if (!isValidAppointmentDate(d)) throw new Error('Invalid date');
        return true;
      }),
  ]),
  async (req, res) => {
    try {
      const { date } = req.query;
      const { bookedSlots, blockedSlots } = await getBookedAndBlockedForDate(date);
      const uniqueBooked = [...new Set(bookedSlots)];

      return res.json({
        success: true,
        date,
        bookedSlots: uniqueBooked,
        blockedSlots,
      });
    } catch (err) {
      console.error('[GET /appointments]', err);
      return res.status(500).json({
        success: false,
        message: 'Server error',
      });
    }
  }
);

router.post(
  '/',
  validate([
    body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }).withMessage('Name too long'),
    body('phone')
      .trim()
      .notEmpty()
      .withMessage('Phone is required')
      .matches(/^[\d\s+\-]{8,15}$/)
      .withMessage('Invalid phone number'),
    body('date')
      .matches(/^\d{4}-\d{2}-\d{2}$/)
      .withMessage('Date must be YYYY-MM-DD')
      .custom((d) => {
        if (!isValidAppointmentDate(d)) throw new Error('Cannot book on Sundays or past dates');
        return true;
      }),
    body('time')
      .trim()
      .notEmpty()
      .withMessage('Time is required')
      .custom((t) => {
        if (!VALID_SLOTS.includes(t)) throw new Error('Invalid time slot');
        return true;
      }),
  ]),
  async (req, res) => {
    const { name, phone, date, time, notes } = req.body;

    try {
      const appointment = await createAppointment({ name, phone, date, time, notes });

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
          console.error('WhatsApp failed:', err.message);
        }
      }
      return res.json({
        success: true,
        appointment: {
          id: appointment._id,
          name: appointment.name,
          date: appointment.date,
          time: appointment.time,
        },
      });
    } catch (err) {
      if (err.code === 'CONFLICT' || err.message === 'SLOT_TAKEN') {
        return res.status(409).json({
          success: false,
          message: `The ${time} slot on ${date} is already booked. Please choose a different time.`,
        });
      }
      if (err.code === 'VALIDATION') {
        return res.status(400).json({ success: false, message: err.message });
      }
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

router.get('/all', async (req, res) => {
  try {
    const appointments = await Appointment.find().sort({ date: 1, time: 1 }).lean();

    res.json({
      success: true,
      appointments,
    });
  } catch (err) {
    console.error('[ADMIN FETCH]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/:id/cancel', async (req, res) => {
  try {
    const updated = await Appointment.findByIdAndUpdate(req.params.id, { status: 'cancelled' }, { new: true });

    res.json({
      success: true,
      appointment: updated,
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { date, time } = req.body;

    const existing = await Appointment.findOne({
      date,
      time,
      status: 'confirmed',
      _id: { $ne: req.params.id },
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Slot already booked',
      });
    }

    const updated = await Appointment.findByIdAndUpdate(req.params.id, { date, time }, { new: true });

    res.json({
      success: true,
      appointment: updated,
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
