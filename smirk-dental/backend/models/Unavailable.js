const mongoose = require('mongoose');

const unavailableSchema = new mongoose.Schema({
    date: String,   // YYYY-MM-DD
    time: String,   // null = full day OR specific slot

}, { timestamps: true });

module.exports = mongoose.model('Unavailable', unavailableSchema);