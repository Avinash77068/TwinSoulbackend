const mongoose = require('mongoose');

const featuresSchema = new mongoose.Schema({
  voiceCall:     { type: Boolean, default: true },
  videoCall:     { type: Boolean, default: true },
  chat:          { type: Boolean, default: true },
  memories:      { type: Boolean, default: true },
  music:         { type: Boolean, default: true },
  loveTree:      { type: Boolean, default: true },
  // Was `false` here while getDashboard hardcoded `true`, so availability
  // depended on which endpoint you asked. Watch Together is a shipped feature.
  watchTogether: { type: Boolean, default: true },
  goals:         { type: Boolean, default: true },
}, { _id: false });

/**
 * Relationship lifecycle states.
 *
 *   pending   — invite sent, awaiting both approvals
 *   active    — live relationship, full feature access
 *   paused    — "Take a Break": read-only both sides, streaks frozen, resumable
 *   ending    — grace period after one partner ended it; fully undoable
 *   archived  — durable read-only chapter; frozen Love Tree, export available
 *   purged    — scheduled for permanent deletion
 *
 * `ended` is the LEGACY value for what is now `ending`/`archived`. It is kept in
 * the enum so existing documents continue to validate; scripts/migrateRelationshipStatus.js
 * migrates them, and isTerminal()/isReadable() below treat it as archived.
 */
const STATUSES = ['pending', 'active', 'paused', 'ending', 'archived', 'purged', 'ended'];

const relationshipSchema = new mongoose.Schema({
  user1: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  user2: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  status: { type: String, enum: STATUSES, default: 'pending' },
  startDate: { type: Date },
  user1Approved: { type: Boolean, default: false },
  user2Approved: { type: Boolean, default: false },

  // ── Ending / grace period ──────────────────────────────────────────────────
  user1WantsLeave: { type: Boolean, default: false },
  user2WantsLeave: { type: Boolean, default: false },
  /** Who initiated the ending (for copy, and to know who may not undo alone). */
  endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  endedAt: { type: Date },
  /** When `ending` becomes `archived`. Nulled on undo. */
  gracePeriodEndsAt: { type: Date },
  /** Optional, private, product-learning only. Never shown to the partner. */
  endReason: {
    type: String,
    enum: ['broke_up', 'need_space', 'too_much_pressure', 'wrong_person', 'just_testing', 'other', null],
    default: null,
  },

  // ── Archive ────────────────────────────────────────────────────────────────
  isArchived: { type: Boolean, default: false },
  archivedAt: { type: Date },
  /** Per-user "hide this chapter" — does not delete anything. */
  hiddenForUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  /** Set when a permanent delete is scheduled; cancellable until it fires. */
  purgeScheduledAt: { type: Date },
  purgeRequestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // ── Pause ("Take a Break") ─────────────────────────────────────────────────
  pausedAt: { type: Date },
  pausedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  /** Optional auto-resume; null = indefinite. */
  pauseUntil: { type: Date },

  // ── Reconnect ──────────────────────────────────────────────────────────────
  /** How many times this couple has reconnected. Used to stop gamifying churn. */
  reconciliationCount: { type: Number, default: 0 },
  /** Each side's choice when reviving an archived relationship. */
  user1ReconnectChoice: { type: String, enum: ['continue', 'fresh', null], default: null },
  user2ReconnectChoice: { type: String, enum: ['continue', 'fresh', null], default: null },

  features: { type: featuresSchema, default: () => ({}) },
}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
// There were previously NO indexes on this collection, so every membership
// lookup was a full scan.
relationshipSchema.index({ user1: 1, status: 1 });
relationshipSchema.index({ user2: 1, status: 1 });
relationshipSchema.index({ user1: 1, user2: 1, status: 1 });
relationshipSchema.index({ status: 1, gracePeriodEndsAt: 1 });
relationshipSchema.index({ status: 1, purgeScheduledAt: 1 });
relationshipSchema.index({ status: 1, pauseUntil: 1 });

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Treat the legacy `ended` value as `archived`. */
relationshipSchema.statics.normalizeStatus = (status) => (status === 'ended' ? 'archived' : status);

/** Statuses whose content is still readable (read-only for the non-active ones). */
relationshipSchema.statics.READABLE = ['active', 'paused', 'ending', 'archived', 'ended'];

/** Statuses in which new content may be written. */
relationshipSchema.statics.WRITABLE = ['active'];

relationshipSchema.methods.isMember = function (userId) {
  const id = String(userId);
  return String(this.user1) === id || (this.user2 && String(this.user2) === id);
};

/** Which approval/choice slot a given user occupies. */
relationshipSchema.methods.slotFor = function (userId) {
  if (String(this.user1) === String(userId)) return 1;
  if (this.user2 && String(this.user2) === String(userId)) return 2;
  return null;
};

relationshipSchema.methods.partnerOf = function (userId) {
  const slot = this.slotFor(userId);
  if (slot === 1) return this.user2;
  if (slot === 2) return this.user1;
  return null;
};

module.exports = mongoose.model('Relationship', relationshipSchema);
module.exports.STATUSES = STATUSES;
