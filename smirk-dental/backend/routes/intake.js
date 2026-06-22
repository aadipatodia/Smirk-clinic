const express = require('express');
const router = express.Router();
const Intake = require('../models/Intake');
const { requireAdmin } = require('../middleware/adminAuth');

const ALLOWED_FIELDS = ['name', 'phone', 'email', 'dob', 'notes', 'reason', 'history', 'appointmentId'];

router.post('/', async (req, res) => {
    try {
        const filtered = {};
        for (const key of ALLOWED_FIELDS) {
            if (req.body[key] !== undefined) {
                filtered[key] = typeof req.body[key] === 'string'
                    ? req.body[key].trim().slice(0, 1000)
                    : req.body[key];
            }
        }

        if (!filtered.name || !filtered.phone) {
            return res.status(400).json({ success: false, message: 'Name and phone are required.' });
        }

        const intake = await Intake.create(filtered);

        res.json({
            success: true,
            intake
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false });
    }
});

router.get('/', requireAdmin, async (req, res) => {
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
