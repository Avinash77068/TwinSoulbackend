const User = require('../models/User');
const InviteToken = require('../models/InviteToken');
const relService = require('../services/relationship.service');
const appConfig = require('../services/appConfig.service');
const { INVITE_EXPIRY_DAYS, INVITE_MAX_PER_DAY } = require('../constants/lifecycle');

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_LINK_BASE = process.env.APP_LINK_BASE || 'https://twinsoul.app';

/**
 * Partner discovery.
 *
 * Finds users who are available to connect — primarily people whose previous
 * relationship ended (`partnerStatus: 'broken_up'`) plus users who never had one
 * (`'single'`).
 *
 * TWO SEPARATE GATES, deliberately:
 *   - Browsing   → requires Premium (see middleware/premium.js)
 *   - Being seen → requires the user's own `discoveryOptIn`
 *
 * The second gate is not optional. "Recently broke up" is sensitive personal
 * information, and newly-single people are exactly the population most harmed by
 * being surfaced to strangers without asking. Ending a relationship therefore
 * does NOT auto-list anyone; `unlinkUsers` sets the status but leaves
 * `discoveryOptIn` false.
 *
 * Results use User.toDiscoveryCard(), which excludes email, phone, phoneHash,
 * coupleCode, connectionPassword, partnerId and relationshipId — a search result
 * must never become a way to harvest contact details.
 */

/** Base filter for anyone who may appear in someone else's search. */
const availableFilter = (excludeUserId, statuses) => ({
  _id: { $ne: excludeUserId },
  discoveryOptIn: true,
  isConnected: false,
  partnerStatus: { $in: statuses },
  isVerified: true,
});

/**
 * GET /api/discover/partners
 * Query: status=broken_up|single|any, interest, language, city, q, page, limit
 *
 * Premium-gated at the route level.
 */
exports.findPartners = async (req, res) => {
  // DB-backed master switch — lets partner search be turned off without a deploy.
  const cfg = await appConfig.getConfig();
  if (!cfg.discoveryEnabled) {
    return res.status(503).json({
      success: false,
      message: 'Partner search is temporarily unavailable.',
      data: { reason: 'discovery_disabled' },
    });
  }

  // A user already in a relationship has no business browsing for partners.
  if (req.user.isConnected) {
    return res.status(409).json({
      success: false,
      message: 'You are already connected with a partner.',
      data: { reason: 'already_connected' },
    });
  }

  const {
    status = 'any',
    interest,
    language,
    city,
    q,
    page = 1,
    limit,
  } = req.query;

  const statuses =
    status === 'broken_up' ? ['broken_up']
    : status === 'single' ? ['single']
    : ['broken_up', 'single'];

  const pageNum = Math.max(1, Number(page) || 1);
  const perPage = Math.min(50, Math.max(1, Number(limit) || cfg.discoveryPageLimit || 20));

  const filter = availableFilter(req.user._id, statuses);

  if (interest) filter.interests = interest;
  if (language) filter.language = language;
  if (city) filter.discoveryCity = new RegExp(`^${escapeRegex(String(city))}`, 'i');
  if (q) {
    // Name/bio search only. Email is deliberately NOT searchable — that would
    // turn discovery into an account-enumeration tool.
    const rx = new RegExp(escapeRegex(String(q).slice(0, 50)), 'i');
    filter.$or = [{ name: rx }, { nickname: rx }, { bio: rx }];
  }

  // Exclude anyone either side has blocked.
  const blockedIds = await getBlockedIds(req.user._id);
  if (blockedIds.length) {
    filter._id = { $ne: req.user._id, $nin: blockedIds };
  }

  const [users, total] = await Promise.all([
    User.find(filter)
      .sort({ lastSeen: -1 })
      .skip((pageNum - 1) * perPage)
      .limit(perPage),
    User.countDocuments(filter),
  ]);

  // Which of these have I already invited? Lets the UI show "Invite sent".
  const myOpenInvites = await InviteToken.find({
    inviterId: req.user._id,
    usedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
    targetUserId: { $ne: null },
  })
    .select('targetUserId token')
    .lean();
  const invitedMap = new Map(myOpenInvites.map((i) => [String(i.targetUserId), i.token]));

  res.json({
    success: true,
    data: {
      partners: users.map((u) => {
        const card = u.toDiscoveryCard();
        const inviteToken = invitedMap.get(String(u._id)) || null;
        return { ...card, invitedByMe: !!inviteToken, inviteToken };
      }),
      total,
      page: pageNum,
      hasMore: pageNum * perPage < total,
    },
  });
};

/**
 * POST /api/discover/interest
 * Body: { userId, message? }
 *
 * Sends a connection invite to a discovered user. Reuses InviteToken bound to the
 * recipient, so a leaked link cannot be redeemed by anyone else, and so the
 * receiver still has to explicitly accept — discovery never auto-connects anyone.
 */
exports.sendInterest = async (req, res) => {
  const { userId, message = '' } = req.body || {};
  if (!userId) {
    return res.status(400).json({ success: false, message: 'userId required' });
  }
  if (String(userId) === String(req.user._id)) {
    return res.status(400).json({ success: false, message: 'That is you 🙂' });
  }

  const blocking = await relService.findBlockingRelationship(req.user._id);
  if (blocking) {
    return res.status(409).json({ success: false, message: 'You are already in a relationship.' });
  }

  // Target must still be listed and available — never confirm anything about a
  // user who is not discoverable.
  const target = await User.findOne({
    _id: userId,
    discoveryOptIn: true,
    isConnected: false,
    partnerStatus: { $in: ['broken_up', 'single'] },
  }).select('name nickname');
  if (!target) {
    return res.status(404).json({
      success: false,
      message: 'This person is no longer available to connect.',
    });
  }

  const blockedIds = await getBlockedIds(req.user._id);
  if (blockedIds.some((id) => String(id) === String(userId))) {
    return res.status(403).json({ success: false, message: 'Not available.' });
  }

  // Rate limit, shared with the normal invite flow.
  const recentCount = await InviteToken.countDocuments({
    inviterId: req.user._id,
    createdAt: { $gte: new Date(Date.now() - DAY_MS) },
  });
  if (recentCount >= INVITE_MAX_PER_DAY) {
    return res.status(429).json({
      success: false,
      message: 'You have sent too many invites today. Please try again tomorrow.',
    });
  }

  // One open invite per recipient — no repeat-pinging.
  const existing = await InviteToken.findOne({
    inviterId: req.user._id,
    targetUserId: userId,
    usedAt: null,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (existing) {
    return res.json({
      success: true,
      message: 'You have already sent them an invite.',
      data: { token: existing.token, alreadySent: true },
    });
  }

  const invite = await InviteToken.create({
    token: InviteToken.generateToken(),
    inviterId: req.user._id,
    channel: 'discover',
    targetUserId: userId,
    message: String(message || '').slice(0, 200),
    expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * DAY_MS),
  });

  await relService.notifyUser(userId, {
    event: 'invite:received',
    socketPayload: {
      token: invite.token,
      fromName: req.user.nickname || req.user.name || 'Someone',
    },
    title: 'Someone would like to connect 💞',
    body: `${req.user.name || 'Someone'} sent you an invite on TwinSoul.`,
    data: { type: 'discover_invite', token: invite.token },
  });

  res.status(201).json({
    success: true,
    message: 'Invite sent.',
    data: {
      token: invite.token,
      url: `${APP_LINK_BASE}/i/${invite.token}`,
      expiresAt: invite.expiresAt,
      alreadySent: false,
    },
  });
};

/**
 * GET /api/discover/me
 * The caller's own discovery settings + entitlement. Not premium-gated: a user
 * must always be able to see and change whether they are listed.
 */
exports.getMyDiscoverySettings = async (req, res) => {
  const u = req.user;
  res.json({
    success: true,
    data: {
      partnerStatus: u.partnerStatus,
      discoveryOptIn: !!u.discoveryOptIn,
      discoveryOptInAt: u.discoveryOptInAt,
      discoveryCity: u.discoveryCity || '',
      lastBreakupAt: u.lastBreakupAt,
      relationshipCount: u.relationshipCount || 0,
      isConnected: !!u.isConnected,
      isPremium: typeof u.hasPremium === 'function' ? u.hasPremium() : !!u.isPremium,
      premiumUntil: u.premiumUntil,
    },
  });
};

/**
 * PATCH /api/discover/me
 * Body: { discoveryOptIn?: boolean, discoveryCity?: string }
 *
 * The consent switch. Explicit, reversible, and never set on the user's behalf.
 */
exports.updateMyDiscoverySettings = async (req, res) => {
  const { discoveryOptIn, discoveryCity } = req.body || {};
  const update = {};

  if (discoveryOptIn !== undefined) {
    if (typeof discoveryOptIn !== 'boolean') {
      return res.status(400).json({ success: false, message: 'discoveryOptIn must be boolean' });
    }
    if (discoveryOptIn && req.user.isConnected) {
      return res.status(409).json({
        success: false,
        message: 'You are currently in a relationship, so you cannot appear in partner search.',
      });
    }
    update.discoveryOptIn = discoveryOptIn;
    // Stamp only on the first opt-in, so ordering is stable across toggles.
    if (discoveryOptIn && !req.user.discoveryOptInAt) {
      update.discoveryOptInAt = new Date();
    }
  }

  if (discoveryCity !== undefined) {
    update.discoveryCity = String(discoveryCity || '').trim().slice(0, 60);
  }

  if (!Object.keys(update).length) {
    return res.status(400).json({ success: false, message: 'Nothing to update' });
  }

  const user = await User.findByIdAndUpdate(req.user._id, update, { new: true });

  res.json({
    success: true,
    message: update.discoveryOptIn === true
      ? "You're now visible in partner search."
      : update.discoveryOptIn === false
        ? "You're hidden from partner search."
        : 'Saved.',
    data: {
      discoveryOptIn: user.discoveryOptIn,
      discoveryOptInAt: user.discoveryOptInAt,
      discoveryCity: user.discoveryCity,
    },
  });
};

// ── helpers ──────────────────────────────────────────────────────────────────

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * IDs to exclude because of a block in either direction.
 * The Block model may not exist yet (the BlockedUsers screen is currently UI
 * only), so this degrades to "no blocks" rather than failing the search.
 */
const getBlockedIds = async (userId) => {
  try {
    const Block = require('../models/Block');
    const rows = await Block.find({
      $or: [{ blockerId: userId }, { blockedId: userId }],
    })
      .select('blockerId blockedId')
      .lean();
    return rows.map((r) =>
      String(r.blockerId) === String(userId) ? r.blockedId : r.blockerId,
    );
  } catch {
    return [];
  }
};
