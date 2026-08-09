/**
 * Response caching middleware backed by the in-memory TTL cache.
 *
 *   Request → this middleware → hit?  → cached JSON response
 *                             → miss? → route handler → Mongo/upstream
 *                                        → response captured → cached → sent
 *
 * Safety rules baked in rather than left to each call site:
 *   - GET only. A cached POST/PUT/DELETE would swallow a write.
 *   - Successful responses only (2xx). A 400/500 must never be cached, or one
 *     upstream blip would be replayed for the whole TTL.
 *   - The key is always explicit. There is no "cache everything" default,
 *     because a key that omits the user/relationship id would leak one user's
 *     data to another. Anything user-specific must say so via keyBuilder.
 *   - Mount AFTER auth/permission middleware so every request is still
 *     authenticated and authorised; a cache hit must never bypass a gate.
 *   - A cache fault falls through to the handler; the request still succeeds.
 */

const { getCache } = require('../utils/ttlCache');

/**
 * @param {object}   opts
 * @param {string}   opts.name        Cache bucket name, used in logs.
 * @param {number}   opts.ttlMs       How long a response stays fresh.
 * @param {Function} opts.keyBuilder  (req) => string | null. Return null to skip
 *                                    caching this request entirely.
 * @param {number}   [opts.maxEntries]
 */
const cacheResponse = ({ name, ttlMs, keyBuilder, maxEntries }) => {
  if (typeof keyBuilder !== 'function') {
    throw new Error('cacheResponse requires a keyBuilder — keys must be explicit');
  }
  const cache = getCache(name, maxEntries);

  return (req, res, next) => {
    // Never serve a write from cache.
    if (req.method !== 'GET') return next();

    let key;
    try {
      key = keyBuilder(req);
    } catch (err) {
      console.error(`[CACHE] keyBuilder failed for ${name}:`, err.message);
      return next();
    }
    if (!key) return next();

    const cached = cache.get(key);
    if (cached !== undefined) {
      return res.json(cached);
    }

    // Capture the handler's payload on its way out, then store it. res.json is
    // wrapped (not res.send) because every controller in this project replies
    // with res.json, and the cached value stays a plain object rather than a
    // serialised buffer.
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      try {
        const status = res.statusCode || 200;
        if (status >= 200 && status < 300 && body?.success !== false) {
          cache.set(key, body, ttlMs);
        }
      } catch (err) {
        console.error(`[CACHE] store failed for ${name}:`, err.message);
      }
      return originalJson(body);
    };

    next();
  };
};

module.exports = { cacheResponse };
