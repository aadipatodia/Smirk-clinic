const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: String,
  phone: {
    type: String,
    unique: true
  }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);