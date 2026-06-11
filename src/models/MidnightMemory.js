const mongoose = require('mongoose');

const midnightMemorySchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content: { type: String, required: true },
  date: { type: String, required: true },
}, { timestamps: true });

midnightMemorySchema.index({ userId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('MidnightMemory', midnightMemorySchema);
