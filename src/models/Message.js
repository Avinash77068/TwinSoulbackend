const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  emoji: { type: String },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, default: '' },
  type: { type: String, enum: ['text', 'voice', 'photo', 'note'], default: 'text' },
  mediaUrl: { type: String, default: '' },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: [reactionSchema],
  isPinned: { type: Boolean, default: false },
  isFavorite: { type: Boolean, default: false },
  isSecret: { type: Boolean, default: false },
  isRead: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  scheduledAt: { type: Date, default: null },
  isDelivered: { type: Boolean, default: true },
}, { timestamps: true });

module.exports = mongoose.model('Message', messageSchema);
