const Presence = require('../models/Presence');
const User = require('../models/User');

exports.heartbeat = async (req, res) => {
  await Presence.findOneAndUpdate(
    { userId: req.user._id },
    { isOnline: true, lastHeartbeat: new Date() },
    { upsert: true, new: true }
  );
  await User.findByIdAndUpdate(req.user._id, { isOnline: true, lastSeen: new Date() });
  res.json({ success: true, message: 'Heartbeat received' });
};

exports.getStatus = async (req, res) => {
  const [myPresence, partnerPresence] = await Promise.all([
    Presence.findOne({ userId: req.user._id }),
    req.user.partnerId ? Presence.findOne({ userId: req.user.partnerId }) : Promise.resolve(null),
  ]);

  const OFFLINE_THRESHOLD = 2 * 60 * 1000;
  const now = Date.now();

  const isPartnerOnline = partnerPresence
    ? (partnerPresence.isOnline && (now - new Date(partnerPresence.lastHeartbeat).getTime()) < OFFLINE_THRESHOLD)
    : false;

  res.json({
    success: true,
    data: {
      isOnline: myPresence?.isOnline || false,
      lastSeen: myPresence?.lastSeen,
      partner: req.user.partnerId ? {
        isOnline: isPartnerOnline,
        lastSeen: partnerPresence?.lastSeen,
        lastHeartbeat: partnerPresence?.lastHeartbeat,
      } : null,
    },
  });
};

exports.setOffline = async (req, res) => {
  await Presence.findOneAndUpdate(
    { userId: req.user._id },
    { isOnline: false, lastSeen: new Date() },
    { upsert: true }
  );
  await User.findByIdAndUpdate(req.user._id, { isOnline: false, lastSeen: new Date() });
  res.json({ success: true, message: 'Status set to offline' });
};

exports.touchPresence = async (req, res) => {
  if (!req.user.partnerId) {
    return res.status(400).json({ success: false, message: 'Not connected to a partner' });
  }
  res.json({
    success: true,
    message: 'Touch sent to partner ❤️',
    data: { sentTo: req.user.partnerId, sentAt: new Date() },
  });
};

exports.heartbeatSync = async (req, res) => {
  if (!req.user.partnerId) {
    return res.status(400).json({ success: false, message: 'Not connected to a partner' });
  }
  res.json({
    success: true,
    message: 'Heartbeat sync initiated ❤️',
    data: { syncId: `sync_${Date.now()}`, participants: [req.user._id, req.user.partnerId] },
  });
};
