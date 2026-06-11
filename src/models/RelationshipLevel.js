const mongoose = require('mongoose');

const LEVEL_TITLES = {
  1: 'New Sparks ✨', 5: 'Close Hearts ❤️', 10: 'Soulmates 💞',
  25: 'Forever Partners 👑', 50: 'Legendary Couple 🌟',
};

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
  const levels = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const l of levels) {
    if (this.level >= l) return LEVEL_TITLES[l];
  }
  return LEVEL_TITLES[1];
};

module.exports = mongoose.model('RelationshipLevel', levelSchema);
