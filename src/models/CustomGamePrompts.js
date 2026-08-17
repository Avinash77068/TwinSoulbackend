const mongoose = require('mongoose');

const promptSchema = new mongoose.Schema({
  question: { type: String, required: true, trim: true, maxlength: 200 },
  optionA: { type: String, trim: true, maxlength: 40 },
  optionB: { type: String, trim: true, maxlength: 40 },
}, { _id: false });

const customGamePromptsSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  gameType: {
    type: String,
    enum: ['truth_dare', 'who_knows_better', 'this_or_that', 'love_quiz'],
    required: true,
  },
  prompts: [promptSchema],
}, { timestamps: true });

customGamePromptsSchema.index({ relationshipId: 1, gameType: 1 }, { unique: true });

module.exports = mongoose.model('CustomGamePrompts', customGamePromptsSchema);
