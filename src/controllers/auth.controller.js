const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const Relationship = require('../models/Relationship');
const LoveTree = require('../models/LoveTree');
const RelationshipLevel = require('../models/RelationshipLevel');
const TimelineEvent = require('../models/TimelineEvent');
const Presence = require('../models/Presence');
const PendingRegistration = require('../models/PendingRegistration');
const mailer = require('../config/mailer');

const signToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN });

const signPendingToken = (email) =>
  jwt.sign({ email, type: 'pending' }, process.env.JWT_SECRET, { expiresIn: '30m' });

/**
 * Secrets below use crypto.randomInt, not Math.random. Math.random is not a CSPRNG
 * and its output is predictable from observed values — unacceptable for a couple
 * code, a connection password, or an OTP.
 */
const generateCoupleCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(0, chars.length)];
  return code;
};

// 6 digits (was 4 → ~9,000 possibilities). Still only a *request* credential:
// the receiver must explicitly approve, so safety comes from consent, not entropy.
const generateConnectionPassword = () => String(crypto.randomInt(100000, 1000000));

const generateOtp = () => String(crypto.randomInt(100000, 1000000));

// Step 1: collect registration data, generate OTP — user not created yet
exports.register = async (req, res) => {
  const { name, nickname, email, password, relationshipStartDate } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'Name, email and password are required' });
  }

  const existing = await User.findOne({ email });
  if (existing) return res.status(409).json({ success: false, message: 'Email already registered' });

  const otp = generateOtp();

  // Upsert: agar pehle se pending hai toh replace karo (re-register case)
  await PendingRegistration.findOneAndUpdate(
    { email: email.toLowerCase() },
    { name, nickname: nickname || '', email, password, relationshipStartDate: relationshipStartDate || null, otp, otpVerified: false, createdAt: new Date() },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  try {
    await mailer.sendOtpEmail(email, otp, name);

    res.status(200).json({
      success: true,
      message: 'OTP sent to your email',
      otp, // visible in dev — remove in production
    });
  } catch (err) {
    console.error('Failed to send OTP email:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to send OTP email. Please try again later.',
    });
  }
};

// Step 2: verify OTP — still no user created
exports.verifyOtp = async (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and OTP are required' });
  }

  const pending = await PendingRegistration.findOne({ email: email.toLowerCase() });
  if (!pending) {
    return res.status(400).json({ success: false, message: 'No pending registration found. Please register again.' });
  }

  if (pending.otp !== otp.toString()) {
    return res.status(400).json({ success: false, message: 'Invalid OTP' });
  }

  pending.otpVerified = true;
  await pending.save();

  const pendingToken = signPendingToken(email);
  res.json({ success: true, message: 'OTP verified successfully', pendingToken });
};

// Step 3: called right after OTP — this is where the user is actually created
exports.completeRegistration = async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Pending token required' });
  }

  let pendingEmail;
  try {
    const payload = jwt.verify(authHeader.split(' ')[1], process.env.JWT_SECRET);
    if (payload.type !== 'pending') throw new Error('Invalid token type');
    pendingEmail = payload.email;
  } catch (_) {
    return res.status(401).json({ success: false, message: 'Invalid or expired pending token' });
  }

  const pending = await PendingRegistration.findOne({ email: pendingEmail.toLowerCase() });
  if (!pending || !pending.otpVerified) {
    return res.status(400).json({ success: false, message: 'OTP not verified. Please restart registration.' });
  }

  const existing = await User.findOne({ email: pendingEmail });
  if (existing) {
    await PendingRegistration.deleteOne({ email: pendingEmail.toLowerCase() });
    return res.status(409).json({ success: false, message: 'Email already registered' });
  }

  let coupleCode;
  let attempts = 0;
  do {
    coupleCode = generateCoupleCode();
    attempts++;
    if (attempts > 20) return res.status(500).json({ success: false, message: 'Could not generate unique code' });
  } while (await User.findOne({ coupleCode }));

  const connectionPassword = generateConnectionPassword();

  // Stored as a bcrypt hash only. The plaintext is returned in THIS response so
  // the app can show it once; it is never persisted or readable again.
  const user = new User({
    name: pending.name,
    nickname: pending.nickname || pending.name,
    email: pending.email,
    password: pending.password,
    relationshipStartDate: pending.relationshipStartDate || undefined,
    coupleCode,
    isVerified: true,
  });
  await user.setConnectionPassword(connectionPassword);
  await user.save();

  await Presence.create({ userId: user._id });
  await PendingRegistration.deleteOne({ email: pendingEmail.toLowerCase() });

  const token = signToken(user._id);

  res.status(201).json({
    success: true,
    message: 'Account created successfully',
    token,
    data: {
      user: {
        _id: user._id, name: user.name, nickname: user.nickname,
        email: user.email, profilePhoto: user.profilePhoto,
        coupleCode: user.coupleCode,
        // Plaintext is shown ONCE here, at creation. Only the hash is stored, so
        // no later response can return it — regenerate to get a new one.
        connectionPassword,
        connectionPasswordShowOnce: true,
        isConnected: user.isConnected,
      },
    },
  });
};

exports.login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password required' });
  }

  const user = await User.findOne({ email });
  if (!user || !(await user.comparePassword(password))) {
    return res.status(401).json({ success: false, message: 'Invalid credentials' });
  }

  await Presence.findOneAndUpdate(
    { userId: user._id },
    { isOnline: true, lastHeartbeat: new Date() },
    { upsert: true }
  );

  const token = signToken(user._id);
  res.json({
    success: true,
    message: 'Login successful',
    token,
    data: {
      user: {
        _id: user._id, name: user.name, nickname: user.nickname,
        email: user.email, profilePhoto: user.profilePhoto,
        coupleCode: user.coupleCode,
        // Never returned on login — only the hash is stored. The app shows the
        // couple code (an identifier) and offers "Regenerate" for a new password.
        hasConnectionPassword: !!(user.connectionPasswordHash || user.connectionPassword),
        isConnected: user.isConnected, partnerId: user.partnerId,
        relationshipId: user.relationshipId,
      },
    },
  });
};

exports.getProfile = async (req, res) => {
  const user = await User.findById(req.user._id).select('-password -connectionPassword');
  res.json({ success: true, data: { user } });
};

exports.updateProfile = async (req, res) => {
  const { name, nickname, relationshipStartDate, fcmToken, bio, interests } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (nickname) updates.nickname = nickname;
  if (relationshipStartDate) updates.relationshipStartDate = relationshipStartDate;
  if (fcmToken) updates.fcmToken = fcmToken;
  if (bio !== undefined) updates.bio = String(bio).slice(0, 200);
  if (Array.isArray(interests)) updates.interests = interests.map(String).slice(0, 20);
  if (req.file) updates.profilePhoto = req.file.cloudUrl;

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
  res.json({ success: true, message: 'Profile updated', data: { user } });
};

// Personal, per-device-independent preferences — NOT shared with the partner
// (unlike bubbleColor/Theme, which are relationship-scoped).
exports.updatePreferences = async (req, res) => {
  const { language, pushNotificationsEnabled, themeMode } = req.body;
  const updates = {};
  if (language !== undefined) updates.language = String(language);
  if (pushNotificationsEnabled !== undefined) updates.pushNotificationsEnabled = !!pushNotificationsEnabled;
  if (themeMode !== undefined) {
    if (!['dark', 'light'].includes(themeMode)) {
      return res.status(400).json({ success: false, message: 'themeMode must be "dark" or "light"' });
    }
    updates.themeMode = themeMode;
  }

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
  res.json({ success: true, message: 'Preferences updated', data: { user } });
};

exports.changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ success: false, message: 'Current and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
  }

  const user = await User.findById(req.user._id);
  const matches = await user.comparePassword(currentPassword);
  if (!matches) {
    return res.status(401).json({ success: false, message: 'Current password is incorrect' });
  }

  user.password = newPassword; // re-hashed by the pre('save') hook
  await user.save();

  res.json({ success: true, message: 'Password changed successfully' });
};

exports.regenerateCodes = async (req, res) => {
  if (req.user.isConnected) {
    return res.status(400).json({ success: false, message: 'Cannot regenerate codes while connected' });
  }

  let coupleCode;
  do { coupleCode = generateCoupleCode(); }
  while (await User.findOne({ coupleCode, _id: { $ne: req.user._id } }));

  const connectionPassword = generateConnectionPassword();

  const user = await User.findById(req.user._id).select('-password');
  user.coupleCode = coupleCode;
  await user.setConnectionPassword(connectionPassword);
  // Regenerating invalidates any outstanding invite that carried the old code.
  await user.save();

  res.json({
    success: true,
    message: 'New codes generated',
    data: {
      coupleCode: user.coupleCode,
      // Shown once — only the hash is stored.
      connectionPassword,
      showOnce: true,
    },
  });
};

exports.saveFcmToken = async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken) return res.status(400).json({ success: false, message: 'FCM token required' });
  await User.findByIdAndUpdate(req.user._id, { fcmToken });
  res.json({ success: true, message: 'FCM token saved' });
};

exports.logout = async (req, res) => {
  await Presence.findOneAndUpdate(
    { userId: req.user._id },
    { isOnline: false, lastSeen: new Date() }
  );
  res.json({ success: true, message: 'Logged out successfully' });
};
