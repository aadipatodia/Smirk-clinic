const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  phone: {
    type: String,
  },
}, { timestamps: true });

// Same phone may exist for different names; duplicate (phone + name) is not allowed.
userSchema.index({ phone: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('User', userSchema);