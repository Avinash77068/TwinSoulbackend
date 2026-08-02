const mongoose = require('mongoose');

const customQuestionSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  askedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  question: { type: String, required: true, trim: true },
  questionPhoto: { type: String, default: '' },
  answer: { type: String, default: '' },
  answerPhoto: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'answered'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('CustomQuestion', customQuestionSchema);
