const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

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
  /**
   * DEPRECATED as a stored secret. Historically held the 4-digit connection
   * password in PLAINTEXT and was string-compared on connect (~9,000
   * possibilities, no expiry, no attempt throttling). New writes go to
   * `connectionPasswordHash`; this field is retained only so existing users can
   * still connect and be lazily upgraded on first successful use.
   * See scripts/migrateConnectionPassword.js.
   */
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

module.exports = mongoose.model('User', userSchema);
