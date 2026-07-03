const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userMessageSchema = new mongoose.Schema({
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message' },
  content: { type: String, default: '' },
  type: { type: String, enum: ['text', 'voice', 'photo', 'note'], default: 'text' },
  mediaUrl: { type: String, default: '' },
  isSecret: { type: Boolean, default: false },
  sentAt: { type: Date, default: Date.now },
  toRelationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship' },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  nickname: { type: String, trim: true, default: '' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true, minlength: 6 },
  profilePhoto: { type: String, default: '' },
  relationshipStartDate: { type: Date },
  coupleCode: { type: String, unique: true, sparse: true },
  connectionPassword: { type: String },
  isConnected: { type: Boolean, default: false },
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', default: null },
  otp: { type: String },
  otpExpiry: { type: Date },
  isVerified: { type: Boolean, default: false },
  lastSeen: { type: Date, default: Date.now },
  isOnline: { type: Boolean, default: false },
  fcmToken: { type: String, default: '' },
  bubbleColor: { type: String, default: '#EC4899' },
  messages: [userMessageSchema],
}, { timestamps: true });

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.comparePassword = async function (candidate) {
  return bcrypt.compare(candidate, this.password);
};

module.exports = mongoose.model('User', userSchema);
