const mongoose = require('mongoose');

const pendingRegistrationSchema = new mongoose.Schema({
  email:                 { type: String, required: true, unique: true, lowercase: true },
  name:                  { type: String, required: true },
  nickname:              { type: String },
  password:              { type: String, required: true },
  relationshipStartDate: { type: String },
  otp:                   { type: String, required: true },
  otpVerified:           { type: Boolean, default: false },
  createdAt:             { type: Date, default: Date.now, expires: 600 }, // auto-delete after 10 min
});

module.exports = mongoose.model('PendingRegistration', pendingRegistrationSchema);
