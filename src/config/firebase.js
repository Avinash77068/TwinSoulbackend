const { initializeApp, getApps, cert } = require('firebase-admin/app');
const serviceAccount = require('./firebase-service-account.json');

if (!getApps().length) {
  initializeApp({
    credential: cert(serviceAccount),
  });
}
