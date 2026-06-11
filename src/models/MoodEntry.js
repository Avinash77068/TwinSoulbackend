const mongoose = require('mongoose');

const moodEntrySchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  mood: { type: String, enum: ['happy', 'loved', 'missing', 'sad', 'relaxed'], required: true },
  note: { type: String, default: '' },
  date: { type: String, required: true },
}, { timestamps: true });

moodEntrySchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('MoodEntry', moodEntrySchema);
