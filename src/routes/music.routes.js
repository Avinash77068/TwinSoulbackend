const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');
const { cacheResponse } = require('../middleware/cache');

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
//
// Cached: each of these is an outbound HTTP call to JioSaavn returning public
// catalogue data that is identical for every user, so one upstream fetch can
// serve everyone. Lyrics and song details are effectively immutable, hence the
// much longer TTLs. Cache sits after `protect`, so auth still runs every time.
// `/stream/:id` is NOT cached — it proxies audio bytes, not JSON.
const catalogCache = (ttlMs, keyBuilder) =>
  cacheResponse({ name: 'jiosaavn', ttlMs, keyBuilder });

const SEARCH_TTL_MS  = Number(process.env.CACHE_TTL_MUSIC_SEARCH_MS)  || 10 * 60 * 1000;
const DETAILS_TTL_MS = Number(process.env.CACHE_TTL_MUSIC_DETAILS_MS) || 60 * 60 * 1000;
const LYRICS_TTL_MS  = Number(process.env.CACHE_TTL_MUSIC_LYRICS_MS)  || 24 * 60 * 60 * 1000;

// Bounded so an oversized param cannot bloat a cache key.
const songId = (req) => {
  const id = String(req.params.id ?? '').trim();
  return id ? id.slice(0, 120) : null;
};

router.get('/search', protect,
  catalogCache(SEARCH_TTL_MS, (req) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    return q ? `search:${q.slice(0, 200)}` : null; // no q → let the 400 through uncached
  }),
  c.searchSongs);

router.get('/search/:id', protect,
  catalogCache(DETAILS_TTL_MS, (req) => {
    const id = songId(req);
    return id ? `song:${id}` : null;
  }),
  c.getSongDetails);

router.get('/search/:id/lyrics', protect,
  catalogCache(LYRICS_TTL_MS, (req) => {
    const id = songId(req);
    return id ? `lyrics:${id}` : null;
  }),
  c.getSongLyrics);

router.get('/stream/:id', protect, c.streamSong);

module.exports = router;
