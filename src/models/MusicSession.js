const mongoose = require('mongoose');

const trackFields = {
  title: { type: String, default: '' },
  artist: { type: String, default: '' },
  album: { type: String, default: '' },
  url: { type: String, default: '' },
  duration: { type: Number, default: 0 },
  coverArt: { type: String, default: '' },
};

const musicSessionSchema = new mongoose.Schema({
  relationshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Relationship', required: true, unique: true },
  currentTrack: {
    title: { type: String, default: '' },
    artist: { type: String, default: '' },
    album: { type: String, default: '' },
    url: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    coverArt: { type: String, default: '' },
  },
  queue: [{ ...trackFields, _id: false }],
  isPlaying: { type: Boolean, default: false },
  position: { type: Number, default: 0 },
  lastUpdatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  history: [{
    title: { type: String, default: '' },
    artist: { type: String, default: '' },
    album: { type: String, default: '' },
    url: { type: String, default: '' },
    duration: { type: Number, default: 0 },
    coverArt: { type: String, default: '' },
    playedAt: { type: Date, default: Date.now },
    _id: false,
  }],
}, { timestamps: true });

module.exports = mongoose.model('MusicSession', musicSessionSchema);
