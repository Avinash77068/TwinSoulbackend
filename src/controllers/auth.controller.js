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
const { invalidate } = require('../cache/cacheMiddleware');

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

// The connection password has been removed entirely — connecting takes only a
// couple code, and safety comes from the recipient approving the request.

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
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );

  try {
    await mailer.sendOtpEmail(email, otp, name);

    /**
     * The OTP is NEVER returned in the response.
     *
     * It used to be included unconditionally "for dev", which meant email
     * ownership was not actually verified by anything: register with someone
     * else's address, read the code out of this 200, and complete signup as
     * them. Set OTP_DEBUG=true locally if you need it without a mailbox.
     */
    res.status(200).json({
      success: true,
      message: 'OTP sent to your email',
      ...(process.env.OTP_DEBUG === 'true' ? { otp } : {}),
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

  // No connection password is generated any more: connecting needs only the
  // couple code, and consent comes from the recipient approving the request.
  // The `connectionPassword`/`connectionPasswordHash` fields remain on the schema
  // for existing accounts but are no longer written or read.
  const user = new User({
    name: pending.name,
    nickname: pending.nickname || pending.name,
    email: pending.email,
    password: pending.password,
    relationshipStartDate: pending.relationshipStartDate || undefined,
    coupleCode,
    isVerified: true,
  });
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
        // Kept null so older app builds that read this field render an empty
        // value instead of crashing on a missing key.
        connectionPassword: null,
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
        // No connection password exists any more — connecting uses the couple code
        // alone. Null (rather than omitted) so older builds reading it don't break.
        connectionPassword: null,
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

  const user = await User.findByIdAndUpdate(req.user._id, updates, { returnDocument: 'after' }).select('-password');
  await invalidate('profile', req.user._id);
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

  const user = await User.findByIdAndUpdate(req.user._id, updates, { returnDocument: 'after' }).select('-password');
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

  // The pre-save hook stamps passwordChangedAt, which invalidates every existing
  // token — including the one this request used. Issue a fresh one so the user
  // isn't logged out by their own password change.
  const token = signToken(user._id);

  res.json({ success: true, message: 'Password changed successfully', token });
};

// ─── Forgot password ─────────────────────────────────────────────────────────

const RESET_TTL_MIN = Math.round(User.RESET_OTP_TTL_MS / 60000);
/** Minimum gap between reset emails to the same account. */
const RESEND_COOLDOWN_MS = 60 * 1000;

/**
 * POST /auth/forgot-password
 * Body: { email }
 *
 * Always answers with the same success message whether or not the address exists.
 * A different response for "no such user" turns this endpoint into an account
 * enumeration oracle — anyone could test which emails are registered.
 */
exports.forgotPassword = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'A valid email is required' });
  }

  // Identical response on every path below.
  const uniform = () =>
    res.json({
      success: true,
      message: 'If an account exists for that email, we\'ve sent a reset code.',
      data: { email, expiresInMinutes: RESET_TTL_MIN, cooldownSeconds: RESEND_COOLDOWN_MS / 1000 },
    });

  try {
    const user = await User.findOne({ email });
    if (!user) return uniform();

    // Resend cooldown, enforced per account rather than per IP so someone else's
    // inbox can't be flooded by rotating IPs.
    if (
      user.resetOtpLastSentAt &&
      Date.now() - new Date(user.resetOtpLastSentAt).getTime() < RESEND_COOLDOWN_MS
    ) {
      return uniform();
    }

    const otp = generateOtp();
    user.setResetOtp(otp); // stores only a hash
    await user.save();

    try {
      await mailer.sendPasswordResetEmail(email, otp, user.name, RESET_TTL_MIN);
    } catch (mailErr) {
      // Don't leak mail-infrastructure state to the caller, but do log it —
      // a silently broken mailer here looks identical to "no such account".
      console.error('[ForgotPassword] mail send failed:', mailErr.message);
    }

    return uniform();
  } catch (err) {
    console.error('[ForgotPassword] error:', err.message);
    return uniform();
  }
};

/**
 * POST /auth/verify-reset-otp
 * Body: { email, otp }
 *
 * On success returns a short-lived, single-purpose reset token. The OTP itself is
 * never accepted by the reset endpoint — separating "prove you have the code" from
 * "set the new password" keeps the code out of the second request (and out of any
 * retry of it).
 */
exports.verifyResetOtp = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const otp = String(req.body?.otp || '').trim();

  if (!email || !otp) {
    return res.status(400).json({ success: false, message: 'Email and code are required' });
  }

  const user = await User.findOne({ email });

  // Same message for "no such user" and "wrong code" — see forgotPassword.
  const invalid = (message = 'That code is invalid or has expired.', extra = {}) =>
    res.status(400).json({ success: false, message, data: { reason: 'invalid_code', ...extra } });

  if (!user) return invalid();

  const result = user.verifyResetOtp(otp);

  if (!result.ok) {
    // verifyResetOtp increments the attempt counter but does not persist.
    await user.save().catch(() => {});

    if (result.reason === 'too_many_attempts') {
      return res.status(429).json({
        success: false,
        message: 'Too many incorrect attempts. Please request a new code.',
        data: { reason: 'too_many_attempts' },
      });
    }
    return invalid(
      'That code is invalid or has expired.',
      result.attemptsLeft !== undefined ? { attemptsLeft: result.attemptsLeft } : {},
    );
  }

  // Bind the reset token to the current password hash: if the password changes by
  // any other route in the meantime, this token stops working.
  const resetToken = jwt.sign(
    {
      id: user._id,
      type: 'password_reset',
      pv: crypto.createHash('sha256').update(user.password).digest('hex').slice(0, 16),
    },
    process.env.JWT_SECRET,
    { expiresIn: `${RESET_TTL_MIN}m` },
  );

  res.json({
    success: true,
    message: 'Code verified. You can now set a new password.',
    data: { resetToken, expiresInMinutes: RESET_TTL_MIN },
  });
};

/**
 * POST /auth/reset-password
 * Body: { resetToken, newPassword }
 *
 * Consumes the reset token, sets the password, and returns a normal auth token so
 * the user lands straight in the app instead of having to log in again.
 */
exports.resetPassword = async (req, res) => {
  const { resetToken, newPassword } = req.body || {};

  if (!resetToken || !newPassword) {
    return res
      .status(400)
      .json({ success: false, message: 'Reset token and new password are required' });
  }
  if (String(newPassword).length < 6) {
    return res
      .status(400)
      .json({ success: false, message: 'Password must be at least 6 characters' });
  }

  let payload;
  try {
    payload = jwt.verify(resetToken, process.env.JWT_SECRET);
  } catch {
    return res.status(401).json({
      success: false,
      message: 'This reset link has expired. Please request a new code.',
      data: { reason: 'token_expired' },
    });
  }

  // A login token must not be usable here.
  if (payload.type !== 'password_reset') {
    return res.status(401).json({ success: false, message: 'Invalid reset token' });
  }

  const user = await User.findById(payload.id);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Account not found' });
  }

  // Single use: the code must still be outstanding. Once the password changes the
  // pre-save hook clears it, so a replayed token finds nothing to consume.
  if (!user.resetOtpHash) {
    return res.status(409).json({
      success: false,
      message: 'This code has already been used. Please request a new one.',
      data: { reason: 'already_used' },
    });
  }

  // Password-version binding — invalidated if the password changed elsewhere.
  const currentPv = crypto.createHash('sha256').update(user.password).digest('hex').slice(0, 16);
  if (payload.pv && payload.pv !== currentPv) {
    return res.status(409).json({
      success: false,
      message: 'Your password has already been changed. Please request a new code.',
      data: { reason: 'stale_token' },
    });
  }

  const sameAsOld = await user.comparePassword(String(newPassword));
  if (sameAsOld) {
    return res.status(400).json({
      success: false,
      message: 'Please choose a password you haven\'t used before.',
    });
  }

  user.password = String(newPassword); // hashed by pre('save'), which also
  await user.save();                   // stamps passwordChangedAt and clears the OTP

  console.log(`[ResetPassword] password reset for ${user.email}`);

  // Every previously-issued token is now stale (passwordChangedAt), so hand back a
  // fresh one — resetting signs out other devices but not the one doing the reset.
  const token = signToken(user._id);

  res.json({
    success: true,
    message: 'Password updated. You\'re signed in.',
    token,
    data: {
      user: {
        _id: user._id,
        name: user.name,
        nickname: user.nickname,
        email: user.email,
        profilePhoto: user.profilePhoto,
        isConnected: user.isConnected,
        partnerId: user.partnerId,
        relationshipId: user.relationshipId,
      },
      // Told plainly, because it is surprising otherwise.
      otherSessionsSignedOut: true,
    },
  });
};

/**
 * POST /auth/regenerate-codes
 *
 * Regenerates the couple code only. The connection password is no longer part of
 * connecting (see relationship.controller connectWithCode), so there is nothing to
 * reissue — regenerating the code is the whole "my code leaked" remedy, because a
 * stale code simply stops resolving to this account.
 */
exports.regenerateCodes = async (req, res) => {
  if (req.user.isConnected) {
    return res.status(400).json({ success: false, message: 'Cannot regenerate your code while connected' });
  }

  let coupleCode;
  let attempts = 0;
  do {
    coupleCode = generateCoupleCode();
    attempts++;
    if (attempts > 20) {
      return res.status(500).json({ success: false, message: 'Could not generate a unique code' });
    }
  } while (await User.findOne({ coupleCode, _id: { $ne: req.user._id } }));

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { coupleCode },
    { returnDocument: 'after' },
  ).select('-password');

  res.json({
    success: true,
    message: 'New couple code generated',
    data: {
      coupleCode: user.coupleCode,
      // Kept null for older app builds that still read this field, so they render
      // an empty value rather than crashing on a missing key.
      connectionPassword: null,
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
  await Promise.all([
    Presence.findOneAndUpdate(
      { userId: req.user._id },
      { isOnline: false, lastSeen: new Date() }
    ),
    User.findByIdAndUpdate(req.user._id, { fcmToken: '' }),
  ]);
  res.json({ success: true, message: 'Logged out successfully' });
};
