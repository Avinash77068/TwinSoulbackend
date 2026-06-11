const mongoose = require('mongoose');

const timeCapsuleSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  note: { type: String, default: '' },
  mediaUrl: { type: String, default: '' },
  unlockAt: { type: Date, required: true },
  isUnlocked: { type: Boolean, default: false },
  unlockedAt: { type: Date },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('TimeCapsule', timeCapsuleSchema);
