const express = require('express');
const router = express.Router();
const Unavailable = require('../models/Unavailable');

// BLOCK SLOT OR DAY
router.post('/', async (req, res) => {
    try {
        const { date, time } = req.body;

        await Unavailable.create({ date, time });

        res.json({ success: true });

    } catch (err) {
        res.status(500).json({ success: false });
    }
});

// UNBLOCK: body { date: "YYYY-MM-DD", time: null } = full day, or { date, time: "09:00 AM" } = one slot
router.delete('/', async (req, res) => {
    try {
        const { date, time } = req.body || {};
        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            return res.status(400).json({ success: false, message: 'Invalid date' });
        }

        if (time === undefined || time === null || time === '') {
            const result = await Unavailable.deleteMany({
                date,
                $or: [{ time: null }, { time: { $exists: false } }],
            });
            return res.json({ success: true, deletedCount: result.deletedCount });
        }

        const result = await Unavailable.deleteMany({ date, time: String(time).trim() });
        return res.json({ success: true, deletedCount: result.deletedCount });
    } catch (err) {
        console.error('[DELETE /unavailable]', err);
        res.status(500).json({ success: false });
    }
});

module.exports = router;