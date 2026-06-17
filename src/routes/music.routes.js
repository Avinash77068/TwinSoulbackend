const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/music.controller');

router.get('/session', protect, c.getSession);
router.post('/session/playback', protect, c.updatePlayback);
router.get('/queue', protect, c.getQueue);
router.post('/queue', protect, c.addToQueue);
router.delete('/queue', protect, c.removeFromQueue);
router.delete('/queue/clear', protect, c.clearQueue);
router.get('/history', protect, c.getHistory);
router.get('/recommendations', protect, c.getRecommendations);
router.get('/playlists', protect, c.getPlaylists);
router.post('/playlists', protect, c.createPlaylist);
router.put('/playlists/:id', protect, c.updatePlaylist);
router.delete('/playlists/:id', protect, c.deletePlaylist);
router.post('/playlists/:id/tracks', protect, c.addTrackToPlaylist);

// JioSaavn Search
router.get('/search', protect, c.searchSongs);
router.get('/search/:id', protect, c.getSongDetails);
router.get('/search/:id/lyrics', protect, c.getSongLyrics);

// Audio stream proxy — fetches from JioSaavn CDN with proper headers
router.get('/stream/:id', protect, c.streamSong);

module.exports = router;
