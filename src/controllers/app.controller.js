const appConfig = require('../services/appConfig.service');

// GET /api/app/version — public, no auth required
exports.getVersion = async (req, res) => {
  try {
    const { latestVersionCode, latestVersionName, apkUrl, releaseNotes } = await appConfig.getConfig();
    res.json({ success: true, data: { latestVersionCode, latestVersionName, apkUrl, releaseNotes } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
