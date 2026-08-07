const mongoose = require('mongoose');

const reactionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  emoji: { type: String },
}, { _id: false });

const messageSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  clientMessageId: { type: String, default: null },
  clientSentAt: { type: Date, default: null },
  content: { type: String, default: '' },
  type: { type: String, enum: ['text', 'voice', 'photo', 'note'], default: 'text' },
  mediaUrl: { type: String, default: '' },
  replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  reactions: [reactionSchema],
  isPinned: { type: Boolean, default: false },
  isFavorite: { type: Boolean, default: false },
  isSecret: { type: Boolean, default: false },
  isEdited: { type: Boolean, default: false },
  isRead: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false },
  scheduledAt: { type: Date, default: null },
  isDelivered: { type: Boolean, default: true },
}, { timestamps: true });
messageSchema.index(
  { relationshipId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: 'string' } } },
);

/** Thread reads: newest-first within a relationship, by device time. */
messageSchema.index({ relationshipId: 1, clientSentAt: -1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
