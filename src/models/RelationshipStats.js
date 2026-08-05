const mongoose = require('mongoose');

/**
 * Cached rollup of relationship statistics.
 *
 * getDashboard previously computed exactly ONE statistic (daysTogether) while the
 * app's Dashboard type already declared `streak`, `moodToday` and `partnerMood`
 * that the server never sent. Computing all the counts on every dashboard open
 * would mean ~8 collection scans per request, so they are rolled up here and
 * recomputed lazily when stale (see services/stats.service.js).
 */
const relationshipStatsSchema = new mongoose.Schema({
  relationshipId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Relationship',
    required: true,
    unique: true,
    index: true,
  },

  daysTogether: { type: Number, default: 0 },

  messages: {
    total:   { type: Number, default: 0 },
    last7d:  { type: Number, default: 0 },
    last30d: { type: Number, default: 0 },
  },
  calls: {
    count:          { type: Number, default: 0 },
    totalSeconds:   { type: Number, default: 0 },
    longestSeconds: { type: Number, default: 0 },
    last7d:         { type: Number, default: 0 },
  },
  photos: {
    total:   { type: Number, default: 0 },
    albums:  { type: Number, default: 0 },
    last30d: { type: Number, default: 0 },
  },
  memories: {
    diaryEntries:   { type: Number, default: 0 },
    capsules:       { type: Number, default: 0 },
    timelineEvents: { type: Number, default: 0 },
  },
  goals: {
    active:         { type: Number, default: 0 },
    completed:      { type: Number, default: 0 },
    completionRate: { type: Number, default: 0 },
  },
  games: {
    played: { type: Number, default: 0 },
  },
  loveTree: {
    points: { type: Number, default: 0 },
    stage:  { type: String, default: 'seed' },
  },
  level: {
    level: { type: Number, default: 1 },
    xp:    { type: Number, default: 0 },
    title: { type: String, default: '' },
  },
  mood: {
    compatibility:   { type: Number, default: null },
    trend:           { type: String, default: null },
    overlappingDays: { type: Number, default: 0 },
    dominantUser1:   { type: String, default: null },
    dominantUser2:   { type: String, default: null },
  },
  streaks: {
    current:        { type: Number, default: 0 },
    longest:        { type: Number, default: 0 },
    lastActiveDate: { type: String, default: null },
  },
  weeklyScore: {
    score:     { type: Number, default: null },
    breakdown: { type: mongoose.Schema.Types.Mixed, default: null },
    trend:     { type: String, default: null },
  },

  computedAt: { type: Date, default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('RelationshipStats', relationshipStatsSchema);
