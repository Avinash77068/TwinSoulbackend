const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/music.controller');

router.get('/session', protect, active, c.getSession);
router.post('/session/playback', protect, active, c.updatePlayback);
router.get('/queue', protect, active, c.getQueue);
router.post('/queue', protect, active, c.addToQueue);
router.delete('/queue', protect, active, c.removeFromQueue);
router.delete('/queue/clear', protect, active, c.clearQueue);
router.get('/history', protect, active, c.getHistory);
router.get('/recommendations', protect, active, c.getRecommendations);
router.get('/playlists', protect, active, c.getPlaylists);
router.post('/playlists', protect, active, c.createPlaylist);
router.put('/playlists/:id', protect, active, c.updatePlaylist);
router.delete('/playlists/:id', protect, active, c.deletePlaylist);
router.post('/playlists/:id/tracks', protect, active, c.addTrackToPlaylist);

// JioSaavn catalog — deliberately NOT relationship-gated. These touch no
// relationship data, and adding a DB lookup to the stream endpoint would cost a
// query per audio request.
router.get('/search', protect, c.searchSongs);
router.get('/search/:id', protect, c.getSongDetails);
router.get('/search/:id/lyrics', protect, c.getSongLyrics);
router.get('/stream/:id', protect, c.streamSong);

module.exports = router;
