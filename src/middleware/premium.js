const appConfig = require('../services/appConfig.service');

/**
 * Premium entitlement gate.
 *
 * IMPORTANT: this checks an entitlement flag; it does not grant one. There is no
 * billing integration in this codebase — real entitlement requires App Store /
 * Play Billing with server-side receipt validation. Until that exists, `isPremium`
 * is set from the DB (see scripts/setPremium.js) and this middleware is the only
 * thing standing between a free user and a paid feature.
 *
 * Design note: premium gates *browsing* partner search. It never gates being
 * found, and it never gates any safety feature (block, break, export).
 *
 * @param {string} featureName  shown in the 402 message
 * @param {string} [configFlag] optional AppConfig boolean; when it is false the
 *                              gate is skipped entirely, so a paid feature can be
 *                              opened up (or closed) from the DB without a deploy.
 */
const requirePremium = (featureName = 'this feature', configFlag) => async (req, res, next) => {
  const user = req.user;
  if (!user) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }

  // DB-backed override: if the flag exists and is false, this feature is free.
  if (configFlag) {
    try {
      const cfg = await appConfig.getConfig();
      if (cfg[configFlag] === false) return next();
    } catch {
      // Fall through to the entitlement check — never open a paid gate on error.
    }
  }

  const active = typeof user.hasPremium === 'function'
    ? user.hasPremium()
    : !!user.isPremium && (!user.premiumUntil || new Date(user.premiumUntil) > new Date());

  if (!active) {
    return res.status(402).json({
      success: false,
      message: `${featureName} is a Premium feature.`,
      data: {
        reason: 'premium_required',
        feature: featureName,
        // Lets the app render the paywall without a second round trip.
        isPremium: false,
      },
    });
  }

  next();
};

module.exports = { requirePremium };
