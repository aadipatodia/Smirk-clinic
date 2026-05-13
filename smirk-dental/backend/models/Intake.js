const mongoose = require('mongoose');

const intakeSchema = new mongoose.Schema({
  name: String,
  phone: String,
  email: String,
  dob: String,
  notes: String,

  appointmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Appointment'
  }
}, { timestamps: true });

module.exports = mongoose.model('Intake', intakeSchema);