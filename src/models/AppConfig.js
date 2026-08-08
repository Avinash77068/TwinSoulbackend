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
  /** Whether Watch Together (YouTube sync) requires premium. */
  watchTogetherRequiresPremium: { type: Boolean, default: true },

  /**
   * UPI payment details, in structured form rather than one hand-assembled
   * URL — so the person configuring this fills in their real VPA/amount and
   * premium.controller.js builds a correct `upi://pay?...` intent URI from
   * them (proper URL-encoding, required params present), instead of every
   * operator having to know that URI format themselves and getting it wrong.
   *
   * A generic `upi://` link is what makes Android show its OWN chooser of
   * every installed UPI app (GPay/PhonePe/Paytm/...) with the payee already
   * filled in — that behavior is the OS's, not something this app draws;
   * this only has to produce a well-formed link for it to kick in.
   */
  /** Payee VPA, e.g. "yourname@okhdfcbank". */
  premiumUpiId: { type: String, default: '' },
  /** Shown to the payer inside their UPI app as who they're paying. */
  premiumUpiPayeeName: { type: String, default: 'SoulSync' },
  /** Amount in INR. Omit to let the user type their own amount in-app. */
  premiumAmountInr: { type: Number, default: 0 },

  premiumPaymentUrl: { type: String, default: '' },
  /** Max results per search page. */
  discoveryPageLimit: { type: Number, default: 20 },

  /** Free-form notes for whoever is operating this. */
  notes: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('AppConfig', appConfigSchema);
