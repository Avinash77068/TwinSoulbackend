const mongoose = require('mongoose');

const wheelConfigSchema = new mongoose.Schema({
  relationshipId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Relationship',
    required: true,
    unique: true,
  },
  activities: [{ type: String, trim: true, maxlength: 60 }],
}, { timestamps: true });

module.exports = mongoose.model('WheelConfig', wheelConfigSchema);
