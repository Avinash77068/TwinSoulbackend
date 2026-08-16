const appConfig = require('../services/appConfig.service');

// GET /api/app/version — public, no auth required
exports.getVersion = async (req, res) => {
  try {
    const {
      latestVersionCode,
      latestVersionName,
      apkUrl,
      releaseNotes,
      iconUrl,
      screenshot0Url,
      screenshot1Url,
    } = await appConfig.getConfig();
    res.json({
      success: true,
      data: {
        latestVersionCode,
        latestVersionName,
        apkUrl,
        releaseNotes,
        iconUrl,
        screenshot0Url,
        screenshot1Url,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
