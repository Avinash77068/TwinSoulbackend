const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userMessageSchema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  content: { type: String, default: '' },
  type: { type: String, enum: ['text', 'voice', 'photo', 'note'], default: 'text' },
  mediaUrl: { type: String, default: '' },
  isSecret: { type: Boolean, default: false },
  sentAt: { type: Date, default: Date.now },
  toRelationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship' },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nickname: { type: String, trim: true, default: '' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  profilePhoto: { type: String, default: '' },
  relationshipStartDate: { type: Date },
  coupleCode: { type: String, unique: true, sparse: true },
  connectionPassword: { type: String },
  connectionPasswordHash: { type: String, default: null },

  /** E.164, verified via OTP. Required for contact-sync discovery. */
  phone: { type: String, default: null, trim: true },
  phoneVerified: { type: Boolean, default: false },
  /**
   * sha256(E.164 + CONTACT_HASH_PEPPER). Raw contact numbers never leave the
   * client and unmatched hashes are never stored.
   */
  phoneHash: { type: String, default: null, index: true, sparse: true },
  /** Whether this user allowed their own number to be discoverable. */
  contactDiscoverable: { type: Boolean, default: true },

  isConnected: { type: Boolean, default: false },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', default: null },


  partnerStatus: {
    type: String,
    enum: ['single', 'joined', 'broken_up'],
    default: 'single',
  },
  lastBreakupAt: { type: Date, default: null },
  relationshipCount: { type: Number, default: 0 },

  discoveryOptIn: { type: Boolean, default: false },
  discoveryOptInAt: { type: Date, default: null },
  discoveryCity: { type: String, default: '', trim: true, maxlength: 60 },
  isPremium: { type: Boolean, default: false },
  premiumUntil: { type: Date, default: null },
  otp: { type: String },
  otpExpiry: { type: Date },
  isVerified: { type: Boolean, default: false },
  resetOtpHash: { type: String, default: null },
  resetOtpExpiry: { type: Date, default: null },
  resetOtpAttempts: { type: Number, default: 0 },
  resetOtpLastSentAt: { type: Date, default: null },
  passwordChangedAt: { type: Date, default: null },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  fcmToken: { type: String, default: '' },
  bubbleColor: { type: String, default: '#EC4899' },
  bio: { type: String, default: '', maxlength: 200 },
  interests: { type: [String], default: [] },
  language: { type: String, default: 'English' },
  pushNotificationsEnabled: { type: Boolean, default: true },
  themeMode: { type: String, enum: ['dark', 'light'], default: 'dark' },
  messages: [userMessageSchema],
}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
/**
 * Partner-search index. Every discovery query filters on the same three fields
 * (status + consent + not-currently-connected) and sorts by recency, so this
 * compound index covers it end to end and keeps the search off a collection scan.
 */
userSchema.index({ partnerStatus: 1, discoveryOptIn: 1, isConnected: 1, lastSeen: -1 });
/** Interest/language faceting within a discovery search. */
userSchema.index({ discoveryOptIn: 1, interests: 1 });
/** Entitlement lookups and premium-expiry sweeps. */
userSchema.index({ isPremium: 1, premiumUntil: 1 });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
  // Stamped here rather than at each call site so no password-changing path can
  // forget it — `protect` uses this to invalidate tokens issued before the change.
  // Skipped on create: a brand-new account has no prior sessions to end, and
  // stamping it would risk invalidating the token issued in the same request.
  if (!this.isNew) {
    this.passwordChangedAt = new Date();
    this.clearResetOtp();
  }
});
userSchema.methods.hasPremium = function () {
  if (!this.isPremium) return false;
  if (!this.premiumUntil) return true; // no expiry set = lifetime/manual grant
  return new Date(this.premiumUntil) > new Date();
};

userSchema.methods.toDiscoveryCard = function () {
  return {
    _id: this._id,
    name: this.name,
    nickname: this.nickname,
    profilePhoto: this.profilePhoto,
    bio: this.bio,
    interests: this.interests,
    language: this.language,
    city: this.discoveryCity || '',
    partnerStatus: this.partnerStatus,
    // Coarse recency only — never the exact breakup timestamp.
    availableSince: this.lastBreakupAt || this.discoveryOptInAt || this.createdAt,
  };
};

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

/** Store a connection password as a hash and clear any plaintext copy. */
userSchema.methods.setConnectionPassword = async function (plain) {
  this.connectionPasswordHash = await bcrypt.hash(String(plain), 10);
  this.connectionPassword = undefined;
  return this.connectionPasswordHash;
};

/**
 * Verify a connection password against the hash, falling back to the legacy
 * plaintext column for users created before hashing existed. A successful
 * legacy match is transparently upgraded to a hash (lazy migration), so no
 * existing user is locked out and no separate backfill is required.
 */
userSchema.methods.verifyConnectionPassword = async function (candidate) {
  const given = String(candidate ?? '');
  if (!given) return false;

  if (this.connectionPasswordHash) {
    return bcrypt.compare(given, this.connectionPasswordHash);
  }

  if (this.connectionPassword && this.connectionPassword === given) {
    try {
      await this.setConnectionPassword(given);
      await this.save();
    } catch (_) {
      /* upgrade is best-effort; never fail the connect because of it */
    }
    return true;
  }

  return false;
};

// ── Password reset ───────────────────────────────────────────────────────────

const RESET_OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const RESET_OTP_MAX_ATTEMPTS = 5;

/** SHA-256 of a reset code. Fast by design — the code is short-lived and rate-limited. */
const hashResetOtp = (otp) =>
  crypto.createHash('sha256').update(String(otp)).digest('hex');

/** Store a freshly generated reset code (hashed) and reset the attempt counter. */
userSchema.methods.setResetOtp = function (otp) {
  this.resetOtpHash = hashResetOtp(otp);
  this.resetOtpExpiry = new Date(Date.now() + RESET_OTP_TTL_MS);
  this.resetOtpAttempts = 0;
  this.resetOtpLastSentAt = new Date();
  return this.resetOtpHash;
};

/**
 * Verify a reset code.
 *
 * Returns { ok, reason } rather than a bare boolean so the caller can distinguish
 * expiry from a wrong code from too many attempts. Comparison is constant-time to
 * avoid leaking how much of the code matched.
 *
 * NOTE: the caller must `save()` — this mutates the attempt counter but does not
 * persist, so a single failed guess is one write, not two.
 */
userSchema.methods.verifyResetOtp = function (candidate) {
  if (!this.resetOtpHash || !this.resetOtpExpiry) {
    return { ok: false, reason: 'not_requested' };
  }
  if (this.resetOtpExpiry < new Date()) {
    return { ok: false, reason: 'expired' };
  }
  if ((this.resetOtpAttempts || 0) >= RESET_OTP_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' };
  }

  const given = hashResetOtp(String(candidate ?? ''));
  const a = Buffer.from(given, 'hex');
  const b = Buffer.from(this.resetOtpHash, 'hex');
  const match = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!match) {
    this.resetOtpAttempts = (this.resetOtpAttempts || 0) + 1;
    const left = Math.max(0, RESET_OTP_MAX_ATTEMPTS - this.resetOtpAttempts);
    return { ok: false, reason: 'invalid', attemptsLeft: left };
  }
  return { ok: true };
};

/** Clear reset state. Called after a successful reset, and on password change. */
userSchema.methods.clearResetOtp = function () {
  this.resetOtpHash = null;
  this.resetOtpExpiry = null;
  this.resetOtpAttempts = 0;
};

/**
 * True when a JWT issued at `iat` (seconds) predates the last password change,
 * i.e. the token belongs to a session that a reset should have ended.
 */
userSchema.methods.isTokenStale = function (iatSeconds) {
  if (!this.passwordChangedAt || !iatSeconds) return false;
  // Allow 1s of slack: the token is signed a moment before passwordChangedAt is
  // written, and second-level `iat` rounding can otherwise invalidate the very
  // token we just issued.
  return Math.floor(new Date(this.passwordChangedAt).getTime() / 1000) - 1 > iatSeconds;
};

module.exports = mongoose.model('User', userSchema);
module.exports.RESET_OTP_TTL_MS = RESET_OTP_TTL_MS;
module.exports.RESET_OTP_MAX_ATTEMPTS = RESET_OTP_MAX_ATTEMPTS;
