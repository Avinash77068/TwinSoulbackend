const mongoose = require('mongoose');

/**
 * Persisted record of a completed call.
 *
 * Call state previously lived ONLY in the in-memory registry in
 * services/call.service.js, which is lost on restart and invisible across
 * instances — so total call time could never be reported. The dashboard's
 * "Call Hours" statistic depends on this collection.
 */
const callLogSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  callerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  calleeId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

  type: { type: String, enum: ['audio', 'video', 'watchTogether'], default: 'audio' },
  /**
   * completed — connected then ended normally
   * missed    — rang out with no answer
   * rejected  — actively declined
   * failed    — signalling/connection error
   */
  outcome: {
    type: String,
    enum: ['completed', 'missed', 'rejected', 'failed'],
    default: 'completed',
  },

  startedAt: { type: Date, required: true },
  answeredAt: { type: Date, default: null },
  endedAt: { type: Date, default: null },
  /** Answered → ended. 0 for missed/rejected calls. */
  durationSeconds: { type: Number, default: 0 },

  endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

callLogSchema.index({ relationshipId: 1, createdAt: -1 });
callLogSchema.index({ relationshipId: 1, outcome: 1 });

module.exports = mongoose.model('CallLog', callLogSchema);
