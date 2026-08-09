/**
 * In-memory TTL cache.
 *
 * Deliberately NOT Redis. This backend runs as a single Node process — the
 * Socket.IO server uses the default in-process adapter, and the cron jobs
 * serialise through a Mongo advisory lock (src/models/CronLock.js) rather than a
 * distributed one — so a process-local Map is sufficient and avoids another
 * service to run, secure and pay for.
 *
 * Generalises the short-TTL approach already used by appConfig.service.js so
 * route middleware and services can share one implementation.
 *
 * Guarantees:
 *   - Never throws. A cache fault must never fail the request that used it, so
 *     every operation is wrapped and degrades to a miss.
 *   - Bounded. Entries are capped and expired keys are swept, so a long-running
 *     process cannot leak memory through an unbounded set of unique keys.
 *   - No stale reads. An entry past its TTL is treated as absent.
 */

// NODE_ENV is not set anywhere in this project today, so logs are on for local
// development and switch off automatically once a deploy sets NODE_ENV=production.
const DEBUG =
  process.env.CACHE_DEBUG === 'true' ||
  (process.env.CACHE_DEBUG !== 'false' && process.env.NODE_ENV !== 'production');

const DEFAULT_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES) || 500;
const SWEEP_INTERVAL_MS = Number(process.env.CACHE_SWEEP_INTERVAL_MS) || 60_000;

const log = (...args) => {
  if (DEBUG) console.log(...args);
};

class TtlCache {
  /**
   * @param {string} name        Label used in logs, e.g. 'youtube'.
   * @param {number} maxEntries  Hard cap; the oldest entry is evicted past it.
   */
  constructor(name, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.name = name;
    this.maxEntries = maxEntries;
    /** @type {Map<string, { value: any, expiresAt: number }>} */
    this.store = new Map();
    this.hits = 0;
    this.misses = 0;

    // Lazy expiry alone would let keys that are never read again sit in memory
    // forever, so sweep periodically too. unref() keeps this timer from holding
    // the process open — seed scripts and one-shot jobs must still exit.
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    if (typeof this.sweepTimer.unref === 'function') this.sweepTimer.unref();
  }

  /** Cached value, or undefined on miss/expiry. Never throws. */
  get(key) {
    try {
      const entry = this.store.get(key);
      if (!entry) {
        this.misses++;
        log(`[CACHE] MISS ${this.name} ${key}`);
        return undefined;
      }
      // Past its TTL — drop it and report a miss rather than serving stale data.
      if (entry.expiresAt <= Date.now()) {
        this.store.delete(key);
        this.misses++;
        log(`[CACHE] MISS ${this.name} ${key} (expired)`);
        return undefined;
      }
      this.hits++;
      log(`[CACHE] HIT ${this.name} ${key}`);
      return entry.value;
    } catch (err) {
      console.error(`[CACHE] get failed for ${this.name}:`, err.message);
      return undefined;
    }
  }

  /** Store a value under `key` for `ttlMs`. Never throws. */
  set(key, value, ttlMs) {
    try {
      if (!Number.isFinite(ttlMs) || ttlMs <= 0) return;

      // Evict the oldest insertion when full. Map preserves insertion order, so
      // this is FIFO; combined with TTLs it keeps the cache bounded without the
      // bookkeeping a true LRU would need.
      if (!this.store.has(key) && this.store.size >= this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest !== undefined) {
          this.store.delete(oldest);
          log(`[CACHE] EVICT ${this.name} ${oldest} (max ${this.maxEntries})`);
        }
      }

      this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
      log(`[CACHE] SET ${this.name} ${key} ttl=${Math.round(ttlMs / 1000)}s`);
    } catch (err) {
      console.error(`[CACHE] set failed for ${this.name}:`, err.message);
    }
  }

  /** Drop one key. */
  del(key) {
    try {
      if (this.store.delete(key)) log(`[CACHE] INVALIDATE ${this.name} ${key}`);
    } catch (err) {
      console.error(`[CACHE] del failed for ${this.name}:`, err.message);
    }
  }

  /**
   * Drop every key starting with `prefix`.
   * Used for invalidation after a write, where one mutation affects a family of
   * cache keys (e.g. all pages of a list belonging to one relationship).
   */
  invalidatePrefix(prefix) {
    try {
      let removed = 0;
      for (const key of this.store.keys()) {
        if (key.startsWith(prefix)) {
          this.store.delete(key);
          removed++;
        }
      }
      if (removed) log(`[CACHE] INVALIDATE ${this.name} ${prefix}* (${removed} entries)`);
      return removed;
    } catch (err) {
      console.error(`[CACHE] invalidatePrefix failed for ${this.name}:`, err.message);
      return 0;
    }
  }

  clear() {
    const size = this.store.size;
    this.store.clear();
    if (size) log(`[CACHE] INVALIDATE ${this.name} (all ${size} entries)`);
  }

  /** Remove expired entries. Called by the sweep timer. */
  sweep() {
    try {
      const now = Date.now();
      let removed = 0;
      for (const [key, entry] of this.store) {
        if (entry.expiresAt <= now) {
          this.store.delete(key);
          removed++;
        }
      }
      if (removed) log(`[CACHE] SWEEP ${this.name} removed ${removed} expired`);
    } catch (err) {
      console.error(`[CACHE] sweep failed for ${this.name}:`, err.message);
    }
  }

  stats() {
    return {
      name: this.name,
      size: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
    };
  }
}

/** Named caches, so each area can be inspected and invalidated independently. */
const caches = new Map();

const getCache = (name, maxEntries) => {
  let cache = caches.get(name);
  if (!cache) {
    cache = new TtlCache(name, maxEntries);
    caches.set(name, cache);
  }
  return cache;
};

const allStats = () => [...caches.values()].map((c) => c.stats());

module.exports = { TtlCache, getCache, allStats, DEBUG };
