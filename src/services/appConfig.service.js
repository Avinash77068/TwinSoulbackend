const AppConfig = require('../models/AppConfig');

/**
 * Cached access to the DB-backed app config.
 *
 * Config is read on almost every discovery/premium request, so it is cached for a
 * few seconds rather than fetched each time. The TTL is short enough that a change
 * made directly in Mongo takes effect within seconds, with no restart.
 *
 * Env vars remain the fallback for every field, so behaviour is unchanged until an
 * AppConfig document actually exists.
 */

const TTL_MS = 10 * 1000;

let cache = null;
let cachedAt = 0;

/** Env fallbacks, used when the DB has no config document (or no value set). */
const envDefaults = () => ({
  allowDevPremium: process.env.ALLOW_DEV_PREMIUM === 'true',
  defaultPremiumDays: Number(process.env.DEFAULT_PREMIUM_DAYS) || 30,
  discoveryEnabled: process.env.DISCOVERY_ENABLED !== 'false',
  discoveryRequiresPremium: process.env.DISCOVERY_REQUIRES_PREMIUM !== 'false',
  watchTogetherRequiresPremium: process.env.WATCH_TOGETHER_REQUIRES_PREMIUM !== 'false',
  premiumUpiId: process.env.PREMIUM_UPI_ID || '',
  premiumUpiPayeeName: process.env.PREMIUM_UPI_PAYEE_NAME || 'SoulSync',
  premiumAmountInr: Number(process.env.PREMIUM_AMOUNT_INR) || 0,
  premiumPaymentUrl: process.env.PREMIUM_PAYMENT_URL || '',
  discoveryPageLimit: Number(process.env.DISCOVERY_PAGE_LIMIT) || 20,
});

/**
 * Current effective config. Never throws — a DB hiccup falls back to env so a
 * config read can't take down a request path.
 */
const getConfig = async ({ force = false } = {}) => {
  if (!force && cache && Date.now() - cachedAt < TTL_MS) return cache;

  const fallback = envDefaults();
  try {
    const doc = await AppConfig.findById('app').lean();
    // A field explicitly set in the DB wins; anything absent falls back to env.
    cache = doc ? { ...fallback, ...stripUndefined(doc) } : fallback;
  } catch (err) {
    console.error('[AppConfig] read failed, using env fallback:', err.message);
    cache = fallback;
  }
  cachedAt = Date.now();
  return cache;
};

/** Drop null/undefined so they don't override an env fallback with nothing. */
const stripUndefined = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
};

/** Upsert config values and invalidate the cache immediately. */
const setConfig = async (patch, updatedBy = '') => {
  const doc = await AppConfig.findByIdAndUpdate(
    'app',
    { ...patch, updatedBy },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  invalidate();
  return doc;
};

const invalidate = () => {
  cache = null;
  cachedAt = 0;
};

module.exports = { getConfig, setConfig, invalidate, envDefaults, TTL_MS };
