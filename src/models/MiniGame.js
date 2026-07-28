const mongoose = require('mongoose');

const miniGameSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  gameType: {
    type: String,
    enum: ['truth_dare', 'who_knows_better', 'this_or_that', 'love_quiz', 'memory_challenge', 'spin_wheel'],
    required: true,
  },
  status: { type: String, enum: ['active', 'completed', 'abandoned'], default: 'active' },
  currentRound: { type: Number, default: 1 },
  scores: {
    user1: { type: Number, default: 0 },
    user2: { type: Number, default: 0 },
  },
  rounds: [{
    question: String,
    user1Answer: String,
    user2Answer: String,
    correctAnswer: String,
    roundWinner: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  }],
  winner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  // Solo local-mechanic games (memory_challenge) don't use rounds/answers —
  // just record the finishing stats when the client reports completion.
  moves: { type: Number, default: null },
  timeSeconds: { type: Number, default: null },
}, { timestamps: true });

module.exports = mongoose.model('MiniGame', miniGameSchema);
