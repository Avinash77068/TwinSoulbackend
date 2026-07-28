const mongoose = require('mongoose');

const milestoneSchema = new mongoose.Schema({
  title: { type: String, required: true },
  done: { type: Boolean, default: false },
}, { timestamps: false });

const activitySchema = new mongoose.Schema({
  text: { type: String, required: true },
  at: { type: Date, default: Date.now },
}, { _id: false });

const goalSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ['fitness', 'travel', 'relationship', 'career', 'finance', 'learning', 'spiritual', 'fun'],
    required: true,
  },
  targetDate: { type: Date, default: null },
  notes: { type: String, default: '' },
  reminder: { type: Boolean, default: false },
  progress: { type: Number, default: 0, min: 0, max: 100 },
  milestones: [milestoneSchema],
  activity: [activitySchema],
}, { timestamps: true });

module.exports = mongoose.model('Goal', goalSchema);
