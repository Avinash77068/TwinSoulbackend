const mongoose = require('mongoose');

/**
 * Per-relationship, per-UTC-day accrual ledger used to enforce the daily caps in
 * constants/progression.js. Without this, a client could spam the award paths
 * and reach Legendary in minutes.
 *
 * Documents auto-expire after 3 days — this is a rate-limit ledger, not history.
 * Long-term totals live on LoveTree / RelationshipLevel.
 */
const progressionLedgerSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  // UTC calendar day, 'YYYY-MM-DD'
  day: { type: String, required: true },

  chatPoints:    { type: Number, default: 0 },
  photoPoints:   { type: Number, default: 0 },
  diaryPoints:   { type: Number, default: 0 },
  musicPoints:   { type: Number, default: 0 },
  checkinPoints: { type: Number, default: 0 },
  xp:            { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 3 },
});

progressionLedgerSchema.index({ relationshipId: 1, day: 1 }, { unique: true });

/** UTC day key for a Date (defaults to now). */
progressionLedgerSchema.statics.dayKey = function (d = new Date()) {
  return d.toISOString().slice(0, 10);
};

module.exports = mongoose.model('ProgressionLedger', progressionLedgerSchema);
