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

module.exports = router;