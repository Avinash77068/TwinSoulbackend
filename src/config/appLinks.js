/**
 * Android App Links / iOS Universal Links association files.
 *
 * These make `https://twinsoul.app/i/<token>` open the app directly instead of a
 * browser. Without them the invite link falls back to the web page every time,
 * which is the single most common way invite flows break.
 *
 * Required env:
 *   ANDROID_PACKAGE_NAME   e.g. com.twinsoul
 *   ANDROID_SHA256_CERTS   comma-separated SHA-256 signing-cert fingerprints
 *                          (get with: keytool -list -v -keystore <release.keystore>)
 *   IOS_TEAM_ID            Apple Developer Team ID
 *   IOS_BUNDLE_ID          e.g. com.twinsoul
 */

const assetLinks = () => {
  const pkg = process.env.ANDROID_PACKAGE_NAME || 'com.twinsoul';
  const certs = (process.env.ANDROID_SHA256_CERTS || '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  return JSON.stringify(
    [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: pkg,
          sha256_cert_fingerprints: certs,
        },
      },
    ],
    null,
    2
  );
};

const appleAppSiteAssociation = () => {
  const teamId = process.env.IOS_TEAM_ID || 'TEAMID';
  const bundleId = process.env.IOS_BUNDLE_ID || 'com.twinsoul';
  const appId = `${teamId}.${bundleId}`;

  return JSON.stringify(
    {
      applinks: {
        apps: [],
        details: [{ appID: appId, paths: ['/i/*'] }],
      },
    },
    null,
    2
  );
};

module.exports = { assetLinks, appleAppSiteAssociation };
