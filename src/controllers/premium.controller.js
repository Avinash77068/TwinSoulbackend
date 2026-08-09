const User = require('../models/User');
const appConfig = require('../services/appConfig.service');

/**
 * Premium entitlement.
 *
 * There is NO billing integration in this codebase — no App Store / Play Billing,
 * no receipt validation, no subscription webhooks. These endpoints expose and
 * manage the entitlement *flag* only.
 *
 * To ship this for real you need:
 *   1. `react-native-iap` (or StoreKit / Play Billing directly) in the app
 *   2. A server endpoint that validates the store receipt and only then sets
 *      isPremium/premiumUntil
 *   3. Webhook/polling for renewals, cancellations and refunds
 *
 * Per the design doc, premium is intended to be COUPLE-level once a relationship
 * exists (one partner pays, both benefit) — every premium feature is shared, so
 * per-user entitlement creates asymmetries the shared features cannot model.
 * Partner search is the exception: it only applies while a user is single, so it
 * is genuinely per-user.
 */

/** GET /api/premium/status */
exports.getStatus = async (req, res) => {
  const u = req.user;
  const active = typeof u.hasPremium === 'function' ? u.hasPremium() : !!u.isPremium;
  const cfg = await appConfig.getConfig();

  const paymentUrl = (cfg.premiumPaymentUrl || '').trim();

  res.json({
    success: true,
    data: {
      isPremium: active,
      premiumUntil: u.premiumUntil,
      // Advertised so the paywall copy can be driven from the server.
      features: {
        partnerSearch: 'Find a new partner from people open to connecting',
        watchTogether: 'Watch YouTube together with your partner in sync',
        unlimitedCapsules: 'Unlimited time capsules and future letters',
        fullThemes: 'The complete theme library',
        hdExport: 'HD memory book and relationship movie export',
        deepInsights: 'Deeper mood and relationship insights',
        foreverArchive: 'Keep archived chapters forever',
      },
      // DB-backed gates — flip without a deploy via AppConfig.
      watchTogetherRequiresPremium: cfg.watchTogetherRequiresPremium !== false,
      paymentUrl: paymentUrl || null,
      billingAvailable: !!paymentUrl,
      devActivationEnabled: cfg.allowDevPremium,
    },
  });
};

/**
 * POST /api/premium/dev-activate
 * Body: { days?: number }
 *
 * Testing helper. Gated on `allowDevPremium` in the AppConfig document (falling
 * back to the ALLOW_DEV_PREMIUM env var), because without that guard it would be
 * a free "make me premium" endpoint for anyone holding a token.
 *
 * Because the gate is now DB-backed it can be turned on for a testing session and
 * off again in seconds, with no restart:
 *   npm run config:set -- --allowDevPremium true
 */
exports.devActivate = async (req, res) => {
  const cfg = await appConfig.getConfig();
  if (!cfg.allowDevPremium) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }

  const fallbackDays = cfg.defaultPremiumDays || 30;
  const days = Math.min(3650, Math.max(1, Number(req.body?.days) || fallbackDays));
  const premiumUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { isPremium: true, premiumUntil },
    { returnDocument: 'after' },
  );

  console.warn(`[Premium] DEV activation for ${user.email} until ${premiumUntil.toISOString()}`);

  res.json({
    success: true,
    message: `Premium activated for ${days} day(s) (dev mode).`,
    data: { isPremium: true, premiumUntil: user.premiumUntil },
  });
};

/** POST /api/premium/dev-deactivate — dev-only, same DB-backed guard. */
exports.devDeactivate = async (req, res) => {
  const cfg = await appConfig.getConfig();
  if (!cfg.allowDevPremium) {
    return res.status(404).json({ success: false, message: 'Not found' });
  }
  await User.findByIdAndUpdate(req.user._id, { isPremium: false, premiumUntil: null });
  res.json({ success: true, message: 'Premium deactivated (dev mode).', data: { isPremium: false } });
};
