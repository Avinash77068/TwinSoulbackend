const TimeCapsule = require('../models/TimeCapsule');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

exports.getCapsules = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const capsules = await TimeCapsule.find({
    relationshipId: req.user.relationshipId,
    isDeleted: false,
  }).populate('creatorId', 'name nickname').sort({ createdAt: -1 });

  const now = new Date();
  const result = capsules.map(c => {
    const obj = c.toObject();
    if (!c.isUnlocked && c.unlockAt <= now) {
      obj.canUnlock = true;
    }
    if (!c.isUnlocked) {
      delete obj.note;
      delete obj.mediaUrl;
    }
    return obj;
  });

  res.json({ success: true, data: { capsules: result } });
};

exports.createCapsule = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { title, note, unlockAfter, customDate } = req.body;
  if (!title) return res.status(400).json({ success: false, message: 'Title required' });

  let unlockAt;
  if (customDate) {
    unlockAt = new Date(customDate);
  } else {
    const days = { '7d': 7, '30d': 30, '1y': 365 }[unlockAfter] || 7;
    unlockAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  if (unlockAt <= new Date()) {
    return res.status(400).json({ success: false, message: 'Unlock date must be in the future' });
  }

  const capsule = await TimeCapsule.create({
    relationshipId: req.user.relationshipId,
    creatorId: req.user._id,
    title,
    note: note || '',
    mediaUrl: req.file ? req.file.cloudUrl : '',
    unlockAt,
  });

  const safeReturn = capsule.toObject();
  delete safeReturn.note;
  delete safeReturn.mediaUrl;

  res.status(201).json({ success: true, message: 'Time capsule created and locked 🔒', data: { capsule: safeReturn } });
};

exports.unlockCapsule = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const capsule = await TimeCapsule.findOne({
    _id: req.params.id,
    relationshipId: req.user.relationshipId,
    isDeleted: false,
  });
  if (!capsule) return res.status(404).json({ success: false, message: 'Capsule not found' });
  if (capsule.isUnlocked) return res.json({ success: true, message: 'Already unlocked', data: { capsule } });
  if (capsule.unlockAt > new Date()) {
    const remaining = Math.ceil((capsule.unlockAt - new Date()) / (1000 * 60 * 60 * 24));
    return res.status(403).json({
      success: false,
      message: `Capsule is still locked for ${remaining} more day(s)`,
      data: { unlockAt: capsule.unlockAt },
    });
  }
  capsule.isUnlocked = true;
  capsule.unlockedAt = new Date();
  await capsule.save();
  res.json({ success: true, message: 'Time capsule unlocked! 🎉', data: { capsule } });
};

exports.deleteCapsule = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const capsule = await TimeCapsule.findOne({
    _id: req.params.id,
    creatorId: req.user._id,
    relationshipId: req.user.relationshipId,
  });
  if (!capsule) return res.status(404).json({ success: false, message: 'Capsule not found or not yours' });
  capsule.isDeleted = true;
  await capsule.save();
  res.json({ success: true, message: 'Capsule deleted' });
};
