const express = require('express');
const router = express.Router();
const User = require('../models/User');

// LOGIN / REGISTER
router.post('/login', async (req, res) => {
  try {
    const { name, phone } = req.body;

    let user = await User.findOne({ phone });

    if (!user) {
      user = await User.create({ name, phone });
    }

    res.json({
      success: true,
      user
    });

  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;