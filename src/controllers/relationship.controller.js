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
  const existing = await Relationship.findOne({
    $or: [
      { user1: partner._id, user2: req.user._id },
      { user1: req.user._id, user2: partner._id },
    ],
    status: 'pending',
  });
  if (existing) {
    const iAmRequester =
      (existing.user2.toString() === req.user._id.toString() && existing.user2Approved) ||
      (existing.user1.toString() === req.user._id.toString() && existing.user1Approved);
    if (iAmRequester) {
      // Stale pending from a previous attempt — clean up and allow re-send
      await Relationship.deleteOne({ _id: existing._id });
      await Notification.deleteMany({ relationshipId: existing._id });
    } else {
      // Partner already sent us a request — tell user to approve instead
      return res.status(409).json({
        success: false,
        message: 'This user already sent you a connection request. Please check your pending requests.',
      });
    }
  }

  const relationship = await Relationship.create({
    user1: partner._id,
    user2: req.user._id,
    status: 'pending',
    user1Approved: false,
    user2Approved: true, // requester auto-approves by initiating
  });

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
    relationship.status = 'active';
    relationship.startDate = new Date();
    await relationship.save();

    await User.findByIdAndUpdate(relationship.user1, {
      isConnected: true, partnerId: relationship.user2, relationshipId: relationship._id,
    });
    await User.findByIdAndUpdate(relationship.user2, {
      isConnected: true, partnerId: relationship.user1, relationshipId: relationship._id,
    });

    await LoveTree.create({ relationshipId: relationship._id });
    await RelationshipLevel.create({ relationshipId: relationship._id });
    await TimelineEvent.create({
      relationshipId: relationship._id,
      eventType: 'first_connection',
      title: 'First Connection ❤️',
      description: 'Two souls connected!',
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
    console.log(`[Leave] emitting relationship:left → ${partnerRoom}, leaverName: ${leaverName}`);
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
