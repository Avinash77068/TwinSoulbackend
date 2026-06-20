const MoodEntry = require('../models/MoodEntry');
const LoveTree = require('../models/LoveTree');
const { getIo } = require('../config/socketInstance');
const awardXP = require('../utils/awardXP');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

const todayStr = () => new Date().toISOString().split('T')[0];

exports.checkin = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { mood, note } = req.body;
  if (!mood) return res.status(400).json({ success: false, message: 'Mood required' });
  const valid = ['loved', 'happy', 'neutral', 'sad', 'anxious', 'angry'];
  if (!valid.includes(mood)) {
    return res.status(400).json({ success: false, message: `Mood must be one of: ${valid.join(', ')}` });
  }

  const date = todayStr();
  const entry = await MoodEntry.findOneAndUpdate(
    { userId: req.user._id, date },
    { mood, note: note || '', relationshipId: req.user.relationshipId },
    { upsert: true, new: true }
  );

  const tree = await LoveTree.findOne({ relationshipId: req.user.relationshipId });
  if (tree) { tree.checkinPoints += 2; tree.points += 2; tree.lastWatered = new Date(); await tree.save(); }

  // Notify partner in real-time
  if (req.user.partnerId) {
    const io = getIo();
    if (io) {
      io.to(`user:${req.user.partnerId.toString()}`).emit('partner:mood', {
        mood: entry.mood,
        note: entry.note,
        updaterName: req.user.nickname || req.user.name || 'Your partner',
      });
    }
  }

  awardXP(req.user.relationshipId, 8); // +8 XP per mood check-in
  res.json({ success: true, message: 'Mood checked in ❤️', data: { mood: entry } });
};

exports.getTodayMood = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const date = todayStr();
  const [myMood, partnerMood] = await Promise.all([
    MoodEntry.findOne({ userId: req.user._id, date }),
    MoodEntry.findOne({ userId: req.user.partnerId, date }),
  ]);
  res.json({ success: true, data: { myMood, partnerMood } });
};

exports.getMoodHistory = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { days = 30 } = req.query;
  const from = new Date();
  from.setDate(from.getDate() - Number(days));
  const fromStr = from.toISOString().split('T')[0];

  const [myHistory, partnerHistory] = await Promise.all([
    MoodEntry.find({ userId: req.user._id, date: { $gte: fromStr } }).sort({ date: 1 }),
    MoodEntry.find({ userId: req.user.partnerId, date: { $gte: fromStr } }).sort({ date: 1 }),
  ]);
  res.json({ success: true, data: { myHistory, partnerHistory } });
};

exports.getPartnerMood = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const entry = await MoodEntry.findOne({ userId: req.user.partnerId, date: todayStr() });
  res.json({ success: true, data: { partnerMood: entry } });
};
