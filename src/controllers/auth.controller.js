const jwt = require('jsonwebtoken');
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

const generateCoupleCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
};

const generateConnectionPassword = () =>
  Math.floor(1000 + Math.random() * 9000).toString();

const generateOtp = () =>
  Math.floor(100000 + Math.random() * 900000).toString();

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

  // Send OTP to email via configured email service (fallback to Ethereal in dev)
  // Do not block registration on email delivery.
  mailer.sendOtpEmail(email, otp, name).catch((err) => {
    console.error('Failed to send OTP email:', err);
  });

  res.status(200).json({
    success: true,
    message: 'OTP sent to your email',
    otp, // visible in dev — remove in production
  });
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

  const user = await User.create({
    name: pending.name,
    nickname: pending.nickname || pending.name,
    email: pending.email,
    password: pending.password,
    relationshipStartDate: pending.relationshipStartDate || undefined,
    coupleCode,
    connectionPassword,
    isVerified: true,
  });

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
        coupleCode: user.coupleCode, connectionPassword: user.connectionPassword,
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
        coupleCode: user.coupleCode, connectionPassword: user.connectionPassword,
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
  const { name, nickname, relationshipStartDate, fcmToken } = req.body;
  const updates = {};
  if (name) updates.name = name;
  if (nickname) updates.nickname = nickname;
  if (relationshipStartDate) updates.relationshipStartDate = relationshipStartDate;
  if (fcmToken) updates.fcmToken = fcmToken;
  if (req.file) updates.profilePhoto = req.file.cloudUrl;

  const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-password');
  res.json({ success: true, message: 'Profile updated', data: { user } });
};

exports.regenerateCodes = async (req, res) => {
  if (req.user.isConnected) {
    return res.status(400).json({ success: false, message: 'Cannot regenerate codes while connected' });
  }

  let coupleCode;
  do { coupleCode = generateCoupleCode(); }
  while (await User.findOne({ coupleCode, _id: { $ne: req.user._id } }));

  const connectionPassword = generateConnectionPassword();
  const user = await User.findByIdAndUpdate(
    req.user._id,
    { coupleCode, connectionPassword },
    { new: true }
  ).select('-password');

  res.json({
    success: true,
    message: 'New codes generated',
    data: { coupleCode: user.coupleCode, connectionPassword: user.connectionPassword },
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
