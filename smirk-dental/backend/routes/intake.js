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
    try {
        const data = await Intake.find().populate('appointmentId');

        res.json({
            success: true,
            data
        });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

module.exports = router;