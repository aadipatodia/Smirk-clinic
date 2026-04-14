const express = require('express');
const router = express.Router();
const Intake = require('../models/Intake');

// SAVE INTAKE
router.post('/', async (req, res) => {
    try {
        const intake = await Intake.create(req.body);

        res.json({
            success: true,
            intake
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

// GET ALL INTAKES (ADMIN)
router.get('/', async (req, res) => {
    const { date } = req.query;

    const appointments = await Appointment.find({ date });

    const bookedSlots = appointments.map(a => a.time);

    res.json({ bookedSlots });
});

module.exports = router;