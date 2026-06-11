const mongoose = require('mongoose');

const diarySchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  content: { type: String, required: true },
  mood: { type: String, enum: ['happy', 'loved', 'missing', 'sad', 'relaxed', 'excited', 'grateful'], default: 'happy' },
  isPrivate: { type: Boolean, default: false },
  isFavorite: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  tags: [{ type: String }],
}, { timestamps: true });

module.exports = mongoose.model('Diary', diarySchema);
