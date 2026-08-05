const mongoose = require('mongoose');
const { getTitle } = require('../constants/progression');

const levelSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true, unique: true },
  level: { type: Number, default: 1 },
  xp: { type: Number, default: 0 },
  xpToNext: { type: Number, default: 100 },
  history: [{
    level: Number,
    achievedAt: { type: Date, default: Date.now },
    title: String,
  }],
}, { timestamps: true });

levelSchema.methods.getTitle = function () {
  return getTitle(this.level);
};

module.exports = mongoose.model('RelationshipLevel', levelSchema);
