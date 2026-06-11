const Notification = require('../models/Notification');

exports.getNotifications = async (req, res) => {
  const { page = 1, limit = 20, unreadOnly } = req.query;
  const query = { userId: req.user._id };
  if (unreadOnly === 'true') query.isRead = false;

  const notifications = await Notification.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(Number(limit));

  const unreadCount = await Notification.countDocuments({ userId: req.user._id, isRead: false });
  res.json({ success: true, data: { notifications, unreadCount } });
};

exports.markRead = async (req, res) => {
  const notification = await Notification.findOne({ _id: req.params.id, userId: req.user._id });
  if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
  notification.isRead = true;
  notification.readAt = new Date();
  await notification.save();
  res.json({ success: true, message: 'Marked as read' });
};

exports.markAllRead = async (req, res) => {
  await Notification.updateMany(
    { userId: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  res.json({ success: true, message: 'All notifications marked as read' });
};

exports.deleteNotification = async (req, res) => {
  const result = await Notification.deleteOne({ _id: req.params.id, userId: req.user._id });
  if (result.deletedCount === 0) return res.status(404).json({ success: false, message: 'Notification not found' });
  res.json({ success: true, message: 'Notification deleted' });
};

exports.clearAll = async (req, res) => {
  await Notification.deleteMany({ userId: req.user._id });
  res.json({ success: true, message: 'All notifications cleared' });
};
