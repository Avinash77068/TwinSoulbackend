const mongoose = require('mongoose');

/**
 * Single-document app configuration, stored in the DB.
 *
 * Replaces env-var-only switches for things that need to change WITHOUT a
 * redeploy or restart (premium granting, discovery availability). Env vars are
 * still read as a fallback so nothing breaks before this doc exists — see
 * services/appConfig.service.js.
 *
 * Deliberately NOT used for secrets. JWT_SECRET, CONTACT_HASH_PEPPER, Mongo URI,
 * Firebase and Cloudinary credentials stay in env: a DB row is readable by
 * anything with a DB connection and shows up in backups and logs.
 */
const appConfigSchema = new mongoose.Schema({
  // Fixed id so there is exactly one config document, always addressable.
  _id: { type: String, default: 'app' },

  // ── Premium ────────────────────────────────────────────────────────────────
  /**
   * Allows POST /api/premium/dev-activate. DB-controlled so premium can be
   * granted for testing without touching env or restarting.
   * Keep false in production — with it true, any authenticated user can self-grant.
   */
  allowDevPremium: { type: Boolean, default: false },
  /** Default length of a dev/manual premium grant, in days. */
  defaultPremiumDays: { type: Number, default: 30 },

  // ── Partner search ─────────────────────────────────────────────────────────
  /** Master switch: turns partner search off for everyone without a deploy. */
  discoveryEnabled: { type: Boolean, default: true },
  /** Whether browsing partner search requires premium. */
  discoveryRequiresPremium: { type: Boolean, default: true },
  /** Max results per search page. */
  discoveryPageLimit: { type: Number, default: 20 },

  /** Free-form notes for whoever is operating this. */
  notes: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('AppConfig', appConfigSchema);
