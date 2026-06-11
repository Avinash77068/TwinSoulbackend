const mongoose = require('mongoose');

const relationshipSchema = new mongoose.Schema({
  user1: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  user2: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: ['pending', 'active', 'paused', 'ended'], default: 'pending' },
  startDate: { type: Date },
  user1Approved: { type: Boolean, default: false },
  user2Approved: { type: Boolean, default: false },
  user1WantsLeave: { type: Boolean, default: false },
  user2WantsLeave: { type: Boolean, default: false },
  isArchived: { type: Boolean, default: false },
  archivedAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Relationship', relationshipSchema);
