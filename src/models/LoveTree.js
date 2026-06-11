const mongoose = require('mongoose');

const loveTreeSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true, unique: true },
  stage: {
    type: String,
    enum: ['seed', 'plant', 'tree', 'blooming', 'golden', 'legendary'],
    default: 'seed',
  },
  points: { type: Number, default: 0 },
  chatPoints: { type: Number, default: 0 },
  photoPoints: { type: Number, default: 0 },
  diaryPoints: { type: Number, default: 0 },
  musicPoints: { type: Number, default: 0 },
  checkinPoints: { type: Number, default: 0 },
  lastWatered: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('LoveTree', loveTreeSchema);
