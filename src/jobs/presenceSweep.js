const Presence = require('../models/Presence');

/**
 * Mark users offline after 2 min without a heartbeat.
 * The client sends presence:heartbeat every 60 s, so active users always have a
 * recent one; the 2-minute cutoff leaves room for reconnects.
 */
module.exports = (scheduleLocked) => {
  scheduleLocked('presenceSweep', '*/2 * * * *', async () => {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    await Presence.updateMany(
      { isOnline: true, lastHeartbeat: { $lt: cutoff } },
      { isOnline: false, lastSeen: new Date() }
    );
  });
};
