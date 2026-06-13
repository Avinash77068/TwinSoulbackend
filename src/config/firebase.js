const { initializeApp, getApps, cert } = require('firebase-admin/app');

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  // Production: use environment variable (Vercel, Railway, etc.)
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else if (process.env.FIREBASE_SERVICE_ACCOUNT_B64) {
  // Alternative: Base64 encoded (if needed)
  serviceAccount = JSON.parse(
    Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_B64, 'base64').toString()
  );
} else {
  // Development: use local file (only if env var not set)
  try {
    serviceAccount = require('./firebase-service-account.json');
  } catch (error) {
    console.error('[Firebase] Error: FIREBASE_SERVICE_ACCOUNT env var not set and local JSON file not found');
    process.exit(1);
  }
}

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
  console.log('[Firebase] Admin SDK initialized successfully');
} else {
  console.log('[Firebase] Admin SDK already initialized');
}
