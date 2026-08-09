const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requirePremium } = require('../middleware/premium');
const { cacheResponse } = require('../middleware/cache');
const c = require('../controllers/youtube.controller');

const watchTogetherGate = requirePremium('Watch Together', 'watchTogetherRequiresPremium');


const SEARCH_TTL_MS = Number(process.env.CACHE_TTL_YOUTUBE_SEARCH_MS) || 10 * 60 * 1000;
const TRENDING_TTL_MS = Number(process.env.CACHE_TTL_YOUTUBE_TRENDING_MS) || 30 * 60 * 1000;

const searchCache = cacheResponse({
  name: 'youtube',
  ttlMs: SEARCH_TTL_MS,
  keyBuilder: (req) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();
    if (!q) return null;
    return `search:${q.slice(0, 200)}`;
  },
});

const trendingCache = cacheResponse({
  name: 'youtube',
  ttlMs: TRENDING_TTL_MS,
  keyBuilder: () => 'trending',
});

router.get('/search', protect, watchTogetherGate, searchCache, c.search);
router.get('/trending', protect, watchTogetherGate, trendingCache, c.trending);

module.exports = router;
