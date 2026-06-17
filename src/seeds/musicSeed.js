require('dotenv').config();
const mongoose = require('mongoose');
const MusicSession = require('../models/MusicSession');

const SAMPLE_TRACKS = [
  { title: 'Perfect', artist: 'Ed Sheeran', album: '÷', duration: 263, coverArt: '' },
  { title: 'A Thousand Years', artist: 'Christina Perri', album: 'Breaking Dawn', duration: 285, coverArt: '' },
  { title: 'All of Me', artist: 'John Legend', album: 'Love in the Future', duration: 269, coverArt: '' },
  { title: 'Thinking Out Loud', artist: 'Ed Sheeran', album: 'x', duration: 281, coverArt: '' },
  { title: 'Can\'t Help Falling in Love', artist: 'Elvis Presley', album: 'Blue Hawaii', duration: 182, coverArt: '' },
  { title: 'Love Story', artist: 'Taylor Swift', album: 'Fearless', duration: 235, coverArt: '' },
  { title: 'Make You Feel My Love', artist: 'Adele', album: '19', duration: 213, coverArt: '' },
  { title: 'Endless Love', artist: 'Diana Ross & Lionel Richie', album: 'Endless Love', duration: 268, coverArt: '' },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  await mongoose.disconnect();
}

seed().catch(console.error);
