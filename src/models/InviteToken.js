const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * A single-use, expiring invitation to connect.
 *
 * Replaces the old scheme as the PRIMARY connection mechanism. Previously the
 * only way to connect was a 6-char couple code plus a 4-digit numeric password
 * (~9,000 combinations, stored in plaintext, never expiring, no attempt
 * throttling) which the user had to read aloud to their partner — there was no
 * share sheet, no link, and no deep linking anywhere in the app.
 *
 * The couple code is retained as a manual fallback; tokens are what the share
 * sheet, QR code, SMS and email invites all carry.
 */

const CHANNELS = ['link', 'qr', 'sms', 'email', 'contact', 'code'];

const inviteTokenSchema = new mongoose.Schema({
  token: { type: String, required: true, unique: true, index: true },
  inviterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channel: { type: String, enum: CHANNELS, default: 'link' },

  /**
   * Optional binding to one recipient (sha256 of E.164 phone or lowercased email).
   * When set, only a user whose own hash matches may accept — so a leaked link
   * cannot be redeemed by a stranger.
   */
  targetHash: { type: String, default: null },
  /** Optional personal note shown on the accept screen. */
  message: { type: String, default: '', maxlength: 200 },

  expiresAt: { type: Date, required: true },
  /** Set the moment the token is redeemed — enforces single use. */
  usedAt: { type: Date, default: null },
  usedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  revokedAt: { type: Date, default: null },

  /** Telemetry: proves to the inviter that the link was at least opened. */
  openedAt: { type: Date, default: null },
  openCount: { type: Number, default: 0 },

  /** Relationship row created when this token was accepted. */
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', default: null },
}, { timestamps: true });

inviteTokenSchema.index({ inviterId: 1, createdAt: -1 });
inviteTokenSchema.index({ inviterId: 1, usedAt: 1, revokedAt: 1, expiresAt: 1 });
// Sweep long-dead tokens 30 days past expiry; the app enforces expiry itself so
// analytics can still see recently-expired invites.
inviteTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

/** Cryptographically random, URL-safe, 22 chars (~131 bits). */
inviteTokenSchema.statics.generateToken = function () {
  return crypto.randomBytes(16).toString('base64url');
};

/** Stable hash for binding an invite to a phone/email. Requires a server pepper. */
inviteTokenSchema.statics.hashTarget = function (value) {
  if (!value) return null;
  const pepper = process.env.CONTACT_HASH_PEPPER || '';
  return crypto
    .createHash('sha256')
    .update(String(value).trim().toLowerCase() + pepper)
    .digest('hex');
};

inviteTokenSchema.methods.isRedeemable = function () {
  return !this.usedAt && !this.revokedAt && this.expiresAt > new Date();
};

/** Why a token cannot be redeemed — drives the accept screen's error copy. */
inviteTokenSchema.methods.invalidReason = function () {
  if (this.revokedAt) return 'revoked';
  if (this.usedAt) return 'used';
  if (this.expiresAt <= new Date()) return 'expired';
  return null;
};

module.exports = mongoose.model('InviteToken', inviteTokenSchema);
module.exports.CHANNELS = CHANNELS;
