const mongoose = require('mongoose');

const scheduledMessageSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  type: { type: String, enum: ['text', 'photo', 'note'], default: 'text' },
  mediaUrl: { type: String, default: '' },
  scheduledAt: { type: Date, required: true },
  isDelivered: { type: Boolean, default: false },
  deliveredAt: { type: Date },
  isCancelled: { type: Boolean, default: false },
}, { timestamps: true });

module.exports = mongoose.model('ScheduledMessage', scheduledMessageSchema);
