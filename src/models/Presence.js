const mongoose = require('mongoose');

const presenceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  isOnline: { type: Boolean, default: false },
  lastHeartbeat: { type: Date, default: Date.now },
  lastSeen: { type: Date, default: Date.now },
  socketId: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('Presence', presenceSchema);
