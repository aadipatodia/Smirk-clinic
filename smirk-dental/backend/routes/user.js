const express = require('express');
const router = express.Router();
const User = require('../models/User');

/** +91XXXXXXXXXX or null */
function normalizeIndianMobile(input) {
  let d = String(input ?? '')
    .replace(/\s/g, '')
    .replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length > 10) return null;
  if (d.length !== 10 || !/^[6-9]\d{9}$/.test(d)) return null;
  return `+91${d}`;
}

// LOGIN / REGISTER
router.post('/login', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const normalized = normalizeIndianMobile(req.body.phone);

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    if (!normalized) {
      return res.status(400).json({
        success: false,
        message:
          'Invalid Indian mobile. Use 10 digits (starting 6–9), or +91 / 91 prefix, optional spaces.',
      });
    }

    const ten = normalized.slice(3);
    let user = await User.findOne({
      $or: [{ phone: normalized }, { phone: ten }, { phone: `91${ten}` }],
    });

    if (!user) {
      user = await User.create({ name: name.slice(0, 100), phone: normalized });
    }

    res.json({
      success: true,
      user,
    });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;