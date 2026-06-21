const User = require('../models/User');
const Relationship = require('../models/Relationship');
const LoveTree = require('../models/LoveTree');
const RelationshipLevel = require('../models/RelationshipLevel');
const TimelineEvent = require('../models/TimelineEvent');
const { getIo } = require('../config/socketInstance');
const Message = require('../models/Message');
const Photo = require('../models/Photo');
const Notification = require('../models/Notification');

exports.declineConnection = async (req, res) => {
  const { relationshipId } = req.body;
  if (!relationshipId) {
    return res.status(400).json({ success: false, message: 'relationshipId required' });
  }

  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) {
    return res.status(404).json({ success: false, message: 'Request not found' });
  }
  if (relationship.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Request already processed' });
  }

  const uid = req.user._id.toString();
  const isUser1 = relationship.user1.toString() === uid;
  const isUser2 = relationship.user2.toString() === uid;
  if (!isUser1 && !isUser2) {
    return res.status(403).json({ success: false, message: 'Not part of this request' });
  }

  // The requester is the one who auto-approved (user2Approved: true at creation)
  const requesterId = relationship.user2Approved && !relationship.user1Approved
    ? relationship.user2
    : relationship.user1;

  await Relationship.deleteOne({ _id: relationshipId });
  await Notification.deleteMany({ relationshipId });

  const io = getIo();
  if (io) {
    io.to(`user:${requesterId.toString()}`).emit('connection:declined');
  }

  res.json({ success: true, message: 'Connection request declined.' });
};

exports.connectWithCode = async (req, res) => {
  const { coupleCode, connectionPassword } = req.body;
  if (!coupleCode || !connectionPassword) {
    return res.status(400).json({ success: false, message: 'Couple code and password required' });
  }

  const partner = await User.findOne({ coupleCode });
  if (!partner) return res.status(404).json({ success: false, message: 'Invalid couple code' });
  if (partner._id.toString() === req.user._id.toString()) {
    return res.status(400).json({ success: false, message: 'Cannot connect with yourself' });
  }
  if (partner.connectionPassword !== connectionPassword) {
    return res.status(401).json({ success: false, message: 'Invalid connection password' });
  }
  if (partner.isConnected) {
    return res.status(409).json({ success: false, message: 'This user is already in a relationship' });
  }
  if (req.user.isConnected) {
    return res.status(409).json({ success: false, message: 'You are already in a relationship' });
  }

  // If requester already has a pending request to this partner, delete it and allow re-send
  const existingPending = await Relationship.findOne({
    $or: [
      { user1: partner._id, user2: req.user._id },
      { user1: req.user._id, user2: partner._id },
    ],
    status: 'pending',
  });
  if (existingPending) {
    const iAmRequester =
      (existingPending.user2.toString() === req.user._id.toString() && existingPending.user2Approved) ||
      (existingPending.user1.toString() === req.user._id.toString() && existingPending.user1Approved);
    if (iAmRequester) {
      await Relationship.deleteOne({ _id: existingPending._id });
      await Notification.deleteMany({ relationshipId: existingPending._id });
    } else {
      return res.status(409).json({
        success: false,
        message: 'This user already sent you a connection request. Please check your pending requests.',
      });
    }
  }

  // Check if these two users had a previous relationship — reuse it to restore all data
  const oldRelationship = await Relationship.findOne({
    $or: [
      { user1: partner._id, user2: req.user._id },
      { user1: req.user._id, user2: partner._id },
    ],
    status: 'ended',
  }).sort({ updatedAt: -1 });

  let relationship;
  if (oldRelationship) {
    // Reunion — restore old relationship so photos/diary/albums come back
    const uid = req.user._id.toString();
    const iAmUser1 = oldRelationship.user1.toString() === uid;
    oldRelationship.status = 'pending';
    oldRelationship.user1Approved = iAmUser1 ? true : false;
    oldRelationship.user2Approved = iAmUser1 ? false : true;
    await oldRelationship.save();
    relationship = oldRelationship;
  } else {
    relationship = await Relationship.create({
      user1: partner._id,
      user2: req.user._id,
      status: 'pending',
      user1Approved: false,
      user2Approved: true,
    });
  }

  await Notification.create({
    userId: partner._id,
    relationshipId: relationship._id,
    type: 'connection',
    title: 'Connection Request 💕',
    body: `${req.user.name || 'Someone'} wants to connect with you!`,
    data: { relationshipId: relationship._id, requesterName: req.user.name },
  });

  const io = getIo();
  if (io) {
    io.to(`user:${partner._id}`).emit('connection:request', {
      relationshipId: relationship._id,
      requesterName: req.user.nickname || req.user.name || 'Someone',
    });
  }

  res.json({
    success: true,
    message: 'Connection request sent. Waiting for both partners to approve.',
    data: { relationshipId: relationship._id, partnerId: partner._id, partnerName: partner.name },
  });
};

exports.getPendingRequest = async (req, res) => {
  const pending = await Relationship.findOne({
    $or: [{ user1: req.user._id }, { user2: req.user._id }],
    status: 'pending',
  }).populate('user1', 'name nickname').populate('user2', 'name nickname');

  if (!pending || !pending.user1 || !pending.user2) {
    return res.json({ success: true, data: { pending: null } });
  }

  const isUser1 = pending.user1._id.toString() === req.user._id.toString();
  const otherUser = isUser1 ? pending.user2 : pending.user1;
  const myApproved = isUser1 ? pending.user1Approved : pending.user2Approved;

  res.json({
    success: true,
    data: {
      pending: {
        relationshipId: pending._id,
        requesterName: otherUser?.nickname || otherUser?.name || 'Partner',
        myApproved,
        needsMyApproval: !myApproved,
      },
    },
  });
};

exports.approveConnection = async (req, res) => {
  const { relationshipId } = req.body;
  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Relationship not found' });
  if (relationship.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Connection already processed' });
  }

  const uid = req.user._id.toString();
  if (relationship.user1.toString() === uid) relationship.user1Approved = true;
  else if (relationship.user2.toString() === uid) relationship.user2Approved = true;
  else return res.status(403).json({ success: false, message: 'Not part of this relationship' });

  if (relationship.user1Approved && relationship.user2Approved) {
    const isReunion = !!relationship.startDate; // had a previous active period
    relationship.status = 'active';
    if (!isReunion) relationship.startDate = new Date();
    await relationship.save();

    await User.findByIdAndUpdate(relationship.user1, {
      isConnected: true, partnerId: relationship.user2, relationshipId: relationship._id,
    });
    await User.findByIdAndUpdate(relationship.user2, {
      isConnected: true, partnerId: relationship.user1, relationshipId: relationship._id,
    });

    const [existingTree, existingLevel] = await Promise.all([
      LoveTree.findOne({ relationshipId: relationship._id }),
      RelationshipLevel.findOne({ relationshipId: relationship._id }),
    ]);
    if (!existingTree) await LoveTree.create({ relationshipId: relationship._id });
    if (!existingLevel) await RelationshipLevel.create({ relationshipId: relationship._id });

    await TimelineEvent.create({
      relationshipId: relationship._id,
      eventType: isReunion ? 'reunion' : 'first_connection',
      title: isReunion ? 'Reunion 💞' : 'First Connection ❤️',
      description: isReunion ? 'Back together again!' : 'Two souls connected!',
      eventDate: new Date(),
      isAutoGenerated: true,
    });

    const io = getIo();
    if (io) {
      const room = `relationship:${relationship._id}`;
      // Add both users' live sockets into the relationship room so future events reach them
      io.in(`user:${relationship.user1}`).socketsJoin(room);
      io.in(`user:${relationship.user2}`).socketsJoin(room);
      io.to(`user:${relationship.user1}`).emit('connection:approved', {});
      io.to(`user:${relationship.user2}`).emit('connection:approved', {});
    }

    return res.json({ success: true, message: 'Connection approved! Your private space is ready.', data: { relationship } });
  }

  await relationship.save();
  res.json({ success: true, message: 'Approval recorded. Waiting for partner.', data: { relationship } });
};

exports.getDashboard = async (req, res) => {
  if (!req.user.relationshipId) {
    return res.status(400).json({ success: false, message: 'Not in a relationship' });
  }

  const [relationship, partner, tree, level, recentPhotos, recentMessages] = await Promise.all([
    Relationship.findById(req.user.relationshipId),
    User.findById(req.user.partnerId).select('name nickname profilePhoto isOnline lastSeen'),
    LoveTree.findOne({ relationshipId: req.user.relationshipId }),
    RelationshipLevel.findOne({ relationshipId: req.user.relationshipId }),
    Photo.find({ relationshipId: req.user.relationshipId, isDeleted: false }).sort({ createdAt: -1 }).limit(5),
    Message.find({ relationshipId: req.user.relationshipId, isDeleted: false }).sort({ createdAt: -1 }).limit(5),
  ]);

  const startDate = relationship.startDate || relationship.createdAt;
  const daysTogether = Math.floor((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));

  const defaultFeatures = {
    voiceCall: true, videoCall: true, chat: true,
    memories: true, music: true, loveTree: true, watchTogether: true,
  };

  res.json({
    success: true,
    data: {
      daysTogether,
      partner,
      loveTree: tree,
      level,
      recentPhotos,
      recentMessages,
      relationship: { status: relationship.status, startDate: relationship.startDate },
      features: { ...defaultFeatures, ...(relationship.features?.toObject?.() ?? relationship.features ?? {}) },
    },
  });
};

exports.getRelationshipInfo = async (req, res) => {
  if (!req.user.relationshipId) {
    return res.status(400).json({ success: false, message: 'Not in a relationship' });
  }
  const relationship = await Relationship.findById(req.user.relationshipId)
    .populate('user1', 'name nickname profilePhoto email')
    .populate('user2', 'name nickname profilePhoto email');
  res.json({ success: true, data: { relationship } });
};

exports.requestLeave = async (req, res) => {
  if (!req.user.relationshipId) {
    return res.status(400).json({ success: false, message: 'Not in a relationship' });
  }
  const relationship = await Relationship.findById(req.user.relationshipId);
  const uid = req.user._id.toString();
  const partnerId = relationship.user1.toString() === uid ? relationship.user2 : relationship.user1;

  relationship.status = 'ended';
  relationship.user1WantsLeave = false;
  relationship.user2WantsLeave = false;
  await relationship.save();

  await User.findByIdAndUpdate(relationship.user1, { isConnected: false, partnerId: null, relationshipId: null });
  await User.findByIdAndUpdate(relationship.user2, { isConnected: false, partnerId: null, relationshipId: null });

  const io = getIo();
  if (io) {
    const leaverName = req.user.nickname || req.user.name || 'Your partner';
    const partnerRoom = `user:${partnerId.toString()}`;
    io.to(partnerRoom).emit('relationship:left', { leaverName });
  } else {
    console.warn('[Leave] io not available');
  }

  res.json({ success: true, message: 'Connection ended.' });
};

exports.cancelLeave = async (req, res) => {
  if (!req.user.relationshipId) {
    return res.status(400).json({ success: false, message: 'Not in a relationship' });
  }
  const relationship = await Relationship.findById(req.user.relationshipId);
  const uid = req.user._id.toString();

  if (relationship.user1.toString() === uid) relationship.user1WantsLeave = false;
  else relationship.user2WantsLeave = false;

  await relationship.save();
  res.json({ success: true, message: 'Leave request cancelled. Stay together! ❤️' });
};

exports.updateFeatures = async (req, res) => {
  if (!req.user.relationshipId) {
    return res.status(400).json({ success: false, message: 'Not in a relationship' });
  }

  const VALID_KEYS = ['voiceCall', 'videoCall', 'chat', 'memories', 'music', 'loveTree', 'watchTogether'];
  const { featureKey, enabled } = req.body;

  if (!VALID_KEYS.includes(featureKey)) {
    return res.status(400).json({ success: false, message: `Invalid featureKey. Valid: ${VALID_KEYS.join(', ')}` });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled must be boolean' });
  }

  const relationship = await Relationship.findByIdAndUpdate(
    req.user.relationshipId,
    { [`features.${featureKey}`]: enabled },
    { new: true },
  );

  // Live update — partner ko bhi bata do features change hui
  const { getIo } = require('../config/socketInstance');
  const io = getIo();
  if (io) {
    const room = `relationship:${relationship._id}`;
    io.to(room).emit('features:updated', relationship.features);
  }

  res.json({ success: true, data: { features: relationship.features } });
};

exports.restoreRelationship = async (req, res) => {
  const { relationshipId } = req.body;
  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Relationship not found' });

  const uid = req.user._id.toString();
  const isPartner =
    relationship.user1.toString() === uid || relationship.user2.toString() === uid;
  if (!isPartner) return res.status(403).json({ success: false, message: 'Not authorized' });

  if (relationship.status !== 'ended') {
    return res.status(400).json({ success: false, message: 'Relationship is not ended' });
  }

  relationship.status = 'active';
  relationship.user1WantsLeave = false;
  relationship.user2WantsLeave = false;
  await relationship.save();

  await User.findByIdAndUpdate(relationship.user1, {
    isConnected: true, partnerId: relationship.user2, relationshipId: relationship._id,
  });
  await User.findByIdAndUpdate(relationship.user2, {
    isConnected: true, partnerId: relationship.user1, relationshipId: relationship._id,
  });

  res.json({ success: true, message: 'Relationship restored successfully ❤️', data: { relationship } });
};
