const { initializeApp, getApps, cert } = require('firebase-admin/app');

/**
 * Firebase Admin bootstrap.
 *
 * Deliberately NEVER exits the process. Push notifications are an enhancement,
 * not a prerequisite for serving the API — the previous `process.exit(1)` meant
 * a missing credential took the whole backend down at require time (before
 * server.listen), which is exactly what happens on a fresh deploy: the local
 * fallback file is gitignored, so a host without FIREBASE_SERVICE_ACCOUNT set
 * could never boot. Now the API starts and only push degrades.
 *
 * `isFirebaseReady()` lets senders skip cleanly instead of throwing per request.
 */

let serviceAccount = null;
let ready = false;

const parseServiceAccount = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch {
      // Pasting service-account JSON into a dashboard field very often mangles
      // the embedded newlines — report it plainly rather than crashing.
      console.error('[Firebase] FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON — push disabled');
      return null;
    }
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
    try {
      return JSON.parse(Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString());
    } catch {
      console.error('[Firebase] FIREBASE_SERVICE_ACCOUNT_B64 could not be decoded — push disabled');
      return null;
    }
  }

  try {
    // Local development convenience only; this file is gitignored.
    return require('./firebase-service-account.json');
  } catch {
    console.warn('[Firebase] No credentials found — push notifications are disabled for this process');
    return null;
  }
};

serviceAccount = parseServiceAccount();

if (serviceAccount) {
  try {
    if (!getApps().length) {
      initializeApp({ credential: cert(serviceAccount) });
      console.log('[Firebase] Admin SDK initialized successfully');
    } else {
      console.log('[Firebase] Admin SDK already initialized');
    }
    ready = true;
  } catch (err) {
    console.error('[Firebase] Admin SDK failed to initialize — push disabled:', err.message);
  }
}

const isFirebaseReady = () => ready;

module.exports = { isFirebaseReady };
