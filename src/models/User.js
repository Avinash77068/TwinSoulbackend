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

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

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
