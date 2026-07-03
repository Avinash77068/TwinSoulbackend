const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', default: null },
  category: { type: String, enum: ['bug', 'suggestion', 'compliment', 'other'], default: 'other' },
  rating: { type: Number, min: 1, max: 5, default: null },
  message: { type: String, required: true, trim: true },
}, { timestamps: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
