const { getClient, isRedisReady } = require('./redisClient');

/**
 * Cache-aside GET middleware, keyed per authenticated user. Must run after
 * `protect` (needs req.user._id).
 *
 * Fails open on every Redis error/timeout/outage by falling through to the
 * real handler — a cache problem must never turn into a request failure.
 *
 * @param {string} keyPrefix   short resource name, e.g. 'profile', 'dashboard'
 * @param {number} ttlSeconds  cache lifetime — also the max staleness window,
 *                              since invalidation here is TTL-driven, not event-driven
 */
const cache = (keyPrefix, ttlSeconds) => async (req, res, next) => {
  if (!isRedisReady() || !req.user?._id) return next();

  const client = getClient();
  const key = `cache:${keyPrefix}:${req.user._id}`;

  try {
    const cached = await client.get(key);
    if (cached) {
      res.set('X-Cache', 'HIT');
      return res.json(JSON.parse(cached));
    }
  } catch (err) {
    console.error(`[redis] GET ${key} failed:`, err.message);
    return next();
  }

  // Populate the cache on a miss by wrapping res.json — the controller stays
  // unaware caching exists. Only success responses are cached; error bodies
  // (success: false) are left alone so a transient 4xx/5xx doesn't get replayed.
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.set('X-Cache', 'MISS');
    if (body?.success !== false) {
      client.set(key, JSON.stringify(body), { EX: ttlSeconds }).catch((err) => {
        console.error(`[redis] SET ${key} failed:`, err.message);
      });
    }
    return originalJson(body);
  };

  next();
};

/**
 * Drop one user's cached entry for a resource. Call from write endpoints that
 * would otherwise keep serving stale data for up to `ttlSeconds`.
 *
 * Note: for resources shared across a couple (dashboard, levels, partner
 * mood), only the acting user's own key is cleared — the partner's copy still
 * expires on its own TTL. That's an intentional tradeoff for per-user keys:
 * bounded staleness instead of tracking couple membership for invalidation.
 */
const invalidate = async (keyPrefix, userId) => {
  if (!isRedisReady() || !userId) return;
  try {
    await getClient().del(`cache:${keyPrefix}:${userId}`);
  } catch (err) {
    console.error(`[redis] DEL cache:${keyPrefix}:${userId} failed:`, err.message);
  }
};

module.exports = { cache, invalidate };
