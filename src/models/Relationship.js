const mongoose = require('mongoose');

const featuresSchema = new mongoose.Schema({
  voiceCall:     { type: Boolean, default: true },
  videoCall:     { type: Boolean, default: true },
  chat:          { type: Boolean, default: true },
  memories:      { type: Boolean, default: true },
  music:         { type: Boolean, default: true },
  loveTree:      { type: Boolean, default: true },
  watchTogether: { type: Boolean, default: true },
}, { _id: false });

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
  features: { type: featuresSchema, default: () => ({}) },
}, { timestamps: true });

module.exports = mongoose.model('Relationship', relationshipSchema);
