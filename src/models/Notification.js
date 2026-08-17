const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship' },
  type: {
    type: String,
    enum: ['message', 'mood', 'photo', 'diary', 'scheduled', 'capsule', 'milestone',
      'anniversary', 'goodbye', 'music', 'game', 'midnight', 'ai', 'connection',
      'relationship', 'connection_approved', 'relationship_ended', 'discover_invite',
      'archive_expiring', 'custom_question', 'wheel_spin', 'watchTogether',
      'missed_call', 'no_answer'],
    required: true,
  },
  title: { type: String, required: true },
  body: { type: String, required: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} },
  isRead: { type: Boolean, default: false },
  readAt: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('Notification', notificationSchema);
