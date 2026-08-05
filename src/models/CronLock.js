const mongoose = require('mongoose');

/**
 * Mongo-backed advisory lock for scheduled jobs.
 *
 * The existing crons in server.js run in-process with no coordination, so the
 * moment a second instance starts they both fire — meaning duplicate scheduled
 * messages and (once anniversary jobs exist) duplicate anniversary pushes, which
 * is a very visible failure. Cheap to run and sufficient for a single Mongo primary.
 */
const cronLockSchema = new mongoose.Schema({
  /** Job name, e.g. 'lifecycle:grace'. */
  _id: { type: String, required: true },
  lockedBy: { type: String, required: true },
  lockedAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
});

// Stale locks self-clean, so a crashed worker cannot block a job forever.
cronLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Try to acquire `name` for `ttlMs`. Returns true if this process won the race.
 * The upsert filter only matches an expired (or absent) lock, so exactly one
 * caller can succeed.
 */
cronLockSchema.statics.acquire = async function (name, ttlMs, owner) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  try {
    await this.findOneAndUpdate(
      { _id: name, expiresAt: { $lt: now } },
      { $set: { lockedBy: owner, lockedAt: now, expiresAt } },
      { upsert: true, new: true }
    );
    return true;
  } catch (err) {
    // Duplicate key = someone else holds a live lock.
    if (err.code === 11000) return false;
    throw err;
  }
};

cronLockSchema.statics.release = async function (name, owner) {
  await this.deleteOne({ _id: name, lockedBy: owner }).catch(() => {});
};

module.exports = mongoose.model('CronLock', cronLockSchema);
