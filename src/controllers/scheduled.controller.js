const ScheduledMessage = require('../models/ScheduledMessage');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

exports.getScheduled = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const messages = await ScheduledMessage.find({
    relationshipId: req.user.relationshipId,
    senderId: req.user._id,
    isCancelled: false,
  }).sort({ scheduledAt: 1 });
  res.json({ success: true, data: { messages } });
};

exports.createScheduled = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { content, type = 'text', scheduledAt } = req.body;
  if (!content || !scheduledAt) {
    return res.status(400).json({ success: false, message: 'Content and scheduled time required' });
  }
  if (new Date(scheduledAt) <= new Date()) {
    return res.status(400).json({ success: false, message: 'Scheduled time must be in the future' });
  }
  const message = await ScheduledMessage.create({
    relationshipId: req.user.relationshipId,
    senderId: req.user._id,
    content, type,
    mediaUrl: req.file ? `/uploads/${req.file.filename}` : '',
    scheduledAt: new Date(scheduledAt),
  });
  res.status(201).json({ success: true, message: 'Message scheduled', data: { message } });
};

exports.updateScheduled = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const message = await ScheduledMessage.findOne({
    _id: req.params.id, senderId: req.user._id, isDelivered: false, isCancelled: false,
  });
  if (!message) return res.status(404).json({ success: false, message: 'Scheduled message not found' });
  const { content, scheduledAt } = req.body;
  if (content) message.content = content;
  if (scheduledAt) {
    if (new Date(scheduledAt) <= new Date()) {
      return res.status(400).json({ success: false, message: 'Scheduled time must be in the future' });
    }
    message.scheduledAt = new Date(scheduledAt);
  }
  await message.save();
  res.json({ success: true, message: 'Scheduled message updated', data: { message } });
};

exports.cancelScheduled = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const message = await ScheduledMessage.findOne({
    _id: req.params.id, senderId: req.user._id, isDelivered: false,
  });
  if (!message) return res.status(404).json({ success: false, message: 'Scheduled message not found' });
  message.isCancelled = true;
  await message.save();
  res.json({ success: true, message: 'Scheduled message cancelled' });
};

exports.getUpcoming = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const messages = await ScheduledMessage.find({
    relationshipId: req.user.relationshipId,
    isDelivered: false,
    isCancelled: false,
    scheduledAt: { $gte: new Date() },
  }).sort({ scheduledAt: 1 }).limit(10);
  res.json({ success: true, data: { messages } });
};
