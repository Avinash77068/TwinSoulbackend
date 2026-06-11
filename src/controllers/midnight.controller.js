const MidnightMemory = require('../models/MidnightMemory');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

exports.createEntry = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { content } = req.body;
  if (!content) return res.status(400).json({ success: false, message: 'Content required' });
  const date = new Date().toISOString().split('T')[0];

  const entry = await MidnightMemory.findOneAndUpdate(
    { userId: req.user._id, date },
    { content, relationshipId: req.user.relationshipId },
    { upsert: true, new: true }
  );
  res.json({ success: true, message: "Tonight's smile saved ✨", data: { entry } });
};

exports.getTodayEntry = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const date = new Date().toISOString().split('T')[0];
  const [myEntry, partnerEntry] = await Promise.all([
    MidnightMemory.findOne({ userId: req.user._id, date }),
    MidnightMemory.findOne({ userId: req.user.partnerId, date }),
  ]);
  res.json({ success: true, data: { myEntry, partnerEntry } });
};

exports.getHistory = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { page = 1, limit = 30 } = req.query;
  const [myHistory, partnerHistory] = await Promise.all([
    MidnightMemory.find({ userId: req.user._id, relationshipId: req.user.relationshipId })
      .sort({ date: -1 }).skip((page - 1) * limit).limit(Number(limit)),
    MidnightMemory.find({ userId: req.user.partnerId, relationshipId: req.user.relationshipId })
      .sort({ date: -1 }).skip((page - 1) * limit).limit(Number(limit)),
  ]);
  res.json({ success: true, data: { myHistory, partnerHistory } });
};

exports.getThisDateMemory = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { date } = req.params;
  const [myEntry, partnerEntry] = await Promise.all([
    MidnightMemory.findOne({ userId: req.user._id, date }),
    MidnightMemory.findOne({ userId: req.user.partnerId, date }),
  ]);
  res.json({ success: true, data: { myEntry, partnerEntry, date } });
};
