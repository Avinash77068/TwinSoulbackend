const CustomQuestion = require('../models/CustomQuestion');
const User = require('../models/User');
const Presence = require('../models/Presence');
const sendPushNotification = require('../utils/sendPushNotification');
const { getIo } = require('../config/socketInstance');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

const notifyPartner = async (partnerId, senderName, event, payload, pushTitle, pushBody) => {
  const io = getIo();
  if (io && partnerId) {
    io.to(`user:${partnerId}`).emit(event, payload);
  }
  if (!partnerId) return;
  try {
    const presence = await Presence.findOne({ userId: partnerId });
    if (presence?.isOnline) return;
    const partner = await User.findById(partnerId).select('fcmToken');
    if (partner?.fcmToken) {
      await sendPushNotification({
        fcmToken: partner.fcmToken,
        title: pushTitle,
        body: pushBody,
        data: { type: 'custom_question', id: String(payload.id) },
      });
    }
  } catch (err) {
    console.error('[CustomQuestion] Push failed:', err.message);
  }
};

exports.getCustomQuestions = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const items = await CustomQuestion.find({ relationshipId: req.user.relationshipId })
    .sort({ createdAt: -1 })
    .limit(30);
  res.json({ success: true, data: { items } });
};

exports.askQuestion = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { question } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ success: false, message: 'Question is required' });
  }

  const item = await CustomQuestion.create({
    relationshipId: req.user.relationshipId,
    askedBy: req.user._id,
    question: question.trim(),
    questionPhoto: req.file?.cloudUrl || '',
  });

  const askerName = req.user.nickname || req.user.name || 'Partner';
  await notifyPartner(
    req.user.partnerId,
    askerName,
    'customQuestion:asked',
    { id: item._id, question: item.question, questionPhoto: item.questionPhoto, askerName },
    `💌 ${askerName} asked you something`,
    item.question,
  );

  res.status(201).json({ success: true, message: 'Question sent!', data: { item } });
};

exports.editQuestion = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { question } = req.body;
  if (!question || !question.trim()) {
    return res.status(400).json({ success: false, message: 'Question is required' });
  }

  const item = await CustomQuestion.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!item) return res.status(404).json({ success: false, message: 'Question not found' });
  if (String(item.askedBy) !== String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You can't edit someone else's question" });
  }
  if (item.status === 'answered') {
    return res.status(400).json({ success: false, message: 'Already answered — cannot edit' });
  }

  item.question = question.trim();
  if (req.file?.cloudUrl) item.questionPhoto = req.file.cloudUrl;
  await item.save();

  const askerName = req.user.nickname || req.user.name || 'Partner';
  await notifyPartner(
    req.user.partnerId,
    askerName,
    'customQuestion:edited',
    { id: item._id, question: item.question, questionPhoto: item.questionPhoto, askerName },
    `💌 ${askerName} edited their question`,
    item.question,
  );

  res.json({ success: true, message: 'Question updated!', data: { item } });
};

exports.answerQuestion = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { answer } = req.body;
  const hasPhoto = !!req.file?.cloudUrl;
  if ((!answer || !answer.trim()) && !hasPhoto) {
    return res.status(400).json({ success: false, message: 'Answer or photo required' });
  }

  const item = await CustomQuestion.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!item) return res.status(404).json({ success: false, message: 'Question not found' });
  if (item.status === 'answered') {
    return res.status(400).json({ success: false, message: 'Already answered' });
  }
  if (String(item.askedBy) === String(req.user._id)) {
    return res.status(403).json({ success: false, message: "You can't answer your own question" });
  }

  item.answer = answer ? answer.trim() : '';
  item.answerPhoto = req.file?.cloudUrl || '';
  item.status = 'answered';
  await item.save();

  const answererName = req.user.nickname || req.user.name || 'Partner';
  await notifyPartner(
    req.user.partnerId,
    answererName,
    'customQuestion:answered',
    { id: item._id, answer: item.answer, answerPhoto: item.answerPhoto, answererName },
    `💌 ${answererName} answered your question`,
    item.answer || '📷 Sent a photo',
  );

  res.json({ success: true, message: 'Answer sent!', data: { item } });
};
