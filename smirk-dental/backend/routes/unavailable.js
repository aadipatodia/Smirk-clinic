const express = require('express');
const router = express.Router();
const Unavailable = require('../models/Unavailable');
const { requireAdmin } = require('../middleware/adminAuth');

router.post('/', requireAdmin, async (req, res) => {
    try {
        const { date, time } = req.body;

        if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
            return res.status(400).json({ success: false, message: 'Invalid date format.' });
        }

        if (time !== undefined && time !== null && typeof time === 'string' && time.trim()) {
            if (!/^\d{2}:\d{2}\s?(AM|PM)$/i.test(time.trim())) {
                return res.status(400).json({ success: false, message: 'Invalid time format.' });
            }
        }

        await Unavailable.create({ date, time: time || null });

        res.json({ success: true });

    } catch (err) {
        console.error('[POST /unavailable]', err);
        res.status(500).json({ success: false });
    }
});

router.delete('/', requireAdmin, async (req, res) => {
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
