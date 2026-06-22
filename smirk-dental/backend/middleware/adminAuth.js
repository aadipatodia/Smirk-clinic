const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'smirk123';

function requireAdmin(req, res, next) {
  const pw = req.headers['x-admin-password'];
  if (!pw || pw !== ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Admin authentication required.' });
  }
  next();
}

module.exports = { requireAdmin, ADMIN_PASSWORD };
