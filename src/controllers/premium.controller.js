const User = require('../models/User');
const appConfig = require('../services/appConfig.service');

const buildUpiUri = ({ vpa, payeeName, amountInr, transactionRef }) => {
  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName || 'SoulSync',
    cu: 'INR',
    tr: transactionRef,
    tn: 'SoulSync Premium',
  });
  if (amountInr > 0) params.set('am', String(amountInr));
  return `upi://pay?${params.toString()}`;
};

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

  /**
   * The explicit override (a full URL/URI, e.g. a hosted checkout page) wins
   * if set. Otherwise, build a proper `upi://pay?...` link from the
   * structured VPA/name/amount fields — this is the path that makes
   * Android's UPI app chooser appear with the payee already filled in.
   * Neither configured → null, i.e. billing genuinely is not set up, same as
   * before.
   */
  const upiId = (cfg.premiumUpiId || '').trim();
  const overrideUrl = (cfg.premiumPaymentUrl || '').trim();
  const paymentUrl = overrideUrl || (upiId
    ? buildUpiUri({
        vpa: upiId,
        payeeName: cfg.premiumUpiPayeeName,
        amountInr: Number(cfg.premiumAmountInr) || 0,
        // Short and reconciliation-friendly: which user, and when. There is
        // no payment webhook to match this against automatically (see the
        // file-level note) — it is read by a human off the bank statement.
        transactionRef: `SS-${String(u._id).slice(-8)}-${Date.now()}`,
      })
    : '');

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
    { new: true },
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
