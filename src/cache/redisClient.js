const { createClient } = require('redis');

let client = null;
let ready = false;

/**
 * Create and connect the shared Redis client. Called once from server.js at
 * boot. If REDIS_URL is missing or the connection never comes up, the app
 * keeps running on direct Mongo reads — Redis is a cache, not a dependency.
 */
const initRedis = () => {
  if (!process.env.REDIS_URL) {
    console.warn('[redis] REDIS_URL not set — caching disabled');
    return null;
  }

  client = createClient({
    url: process.env.REDIS_URL,
    socket: {
      // Reconnect with backoff instead of giving up after one drop; capped so a
      // dead Redis doesn't retry forever in a tight loop.
      reconnectStrategy: (retries) => (retries > 10 ? false : Math.min(retries * 200, 3000)),
    },
  });

  // node-redis throws on unhandled 'error' events, which would crash the
  // process on a network blip. Logging here is what keeps a Redis outage
  // from taking the API down with it.
  client.on('error', (err) => {
    ready = false;
    console.error('[redis] error:', err.message);
  });
  client.on('ready', () => {
    ready = true;
    console.log('[redis] connected');
  });
  client.on('end', () => {
    ready = false;
  });

  client.connect().catch((err) => console.error('[redis] initial connect failed:', err.message));

  return client;
};

const getClient = () => client;

/** Callers must check this before touching the client — never assume it's up. */
const isRedisReady = () => ready && !!client;

module.exports = { initRedis, getClient, isRedisReady };
