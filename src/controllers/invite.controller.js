const User = require('../models/User');
const Relationship = require('../models/Relationship');
const InviteToken = require('../models/InviteToken');
const Notification = require('../models/Notification');
const { getIo } = require('../config/socketInstance');
const relService = require('../services/relationship.service');
const {
  INVITE_EXPIRY_DAYS,
  INVITE_MAX_PER_DAY,
  RECONNECT_COOLDOWN_HOURS,
} = require('../constants/lifecycle');

const DAY_MS = 24 * 60 * 60 * 1000;
const APP_LINK_BASE = process.env.APP_LINK_BASE || 'https://twinsoul.app';

const publicInviter = (u) => ({
  _id: u._id,
  name: u.name,
  nickname: u.nickname,
  profilePhoto: u.profilePhoto,
});

/**
 * POST /api/invite
 * Body: { channel?, message?, targetPhone?, targetEmail? }
 *
 * Creates a single-use, expiring invite and returns a shareable link + QR payload.
 * This is the PRIMARY connection mechanism — previously the only way to connect
 * was reading a couple code and a 4-digit password aloud to your partner.
 */
exports.createInvite = async (req, res) => {
  const { channel = 'link', message = '', targetPhone, targetEmail } = req.body || {};

  if (!InviteToken.CHANNELS.includes(channel)) {
    return res.status(400).json({
      success: false,
      message: `channel must be one of: ${InviteToken.CHANNELS.join(', ')}`,
    });
  }

  // Cannot invite while already in a live relationship.
  const blocking = await relService.findBlockingRelationship(req.user._id);
  if (blocking) {
    return res.status(409).json({
      success: false,
      message: 'You are already in a relationship.',
      data: { relationshipId: blocking._id, status: blocking.status },
    });
  }

  // Anti-harassment / anti-spam rate limit.
  const since = new Date(Date.now() - DAY_MS);
  const recentCount = await InviteToken.countDocuments({
    inviterId: req.user._id,
    createdAt: { $gte: since },
  });
  if (recentCount >= INVITE_MAX_PER_DAY) {
    return res.status(429).json({
      success: false,
      message: 'You have created too many invites today. Please try again tomorrow.',
    });
  }

  const targetHash = targetPhone
    ? InviteToken.hashTarget(targetPhone)
    : targetEmail
      ? InviteToken.hashTarget(targetEmail)
      : null;

  const invite = await InviteToken.create({
    token: InviteToken.generateToken(),
    inviterId: req.user._id,
    channel,
    message: String(message || '').slice(0, 200),
    targetHash,
    expiresAt: new Date(Date.now() + INVITE_EXPIRY_DAYS * DAY_MS),
  });

  const url = `${APP_LINK_BASE}/i/${invite.token}`;
  res.status(201).json({
    success: true,
    data: {
      token: invite.token,
      url,
      // Same URL — the app renders this as a QR code for in-person connecting.
      qrPayload: url,
      channel: invite.channel,
      message: invite.message,
      expiresAt: invite.expiresAt,
      shareText: `Join me on TwinSoul 💞 ${url}`,
    },
  });
};

/**
 * GET /api/invite/:token
 * PUBLIC — no auth. Powers the accept preview, including before signup.
 *
 * Records that the link was opened so the inviter gets an honest
 * "your invite was opened" signal instead of silence.
 */
exports.getInvite = async (req, res) => {
  const invite = await InviteToken.findOne({ token: req.params.token }).lean();
  if (!invite) {
    return res.status(404).json({ success: false, message: 'invalid', data: { reason: 'invalid' } });
  }

  const doc = await InviteToken.findById(invite._id);
  const reason = doc.invalidReason();

  // Count the open even for dead tokens — useful for the "expired" screen.
  await InviteToken.updateOne(
    { _id: invite._id },
    { $inc: { openCount: 1 }, ...(invite.openedAt ? {} : { $set: { openedAt: new Date() } }) }
  );

  if (!invite.openedAt) {
    const io = getIo();
    if (io) io.to(`user:${invite.inviterId}`).emit('invite:opened', { token: invite.token });
  }

  const inviter = await User.findById(invite.inviterId)
    .select('name nickname profilePhoto relationshipStartDate')
    .lean();

  if (!inviter) {
    return res.status(404).json({ success: false, message: 'invalid', data: { reason: 'invalid' } });
  }

  res.json({
    success: true,
    data: {
      valid: !reason,
      reason,
      inviter: publicInviter(inviter),
      message: invite.message,
      relationshipStartDate: inviter.relationshipStartDate || null,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      // True when the invite is bound to a specific phone/email.
      isTargeted: !!invite.targetHash,
    },
  });
};

/**
 * POST /api/invite/:token/accept
 * Auth required. Redeems the invite and creates (or revives) the relationship.
 *
 * Still a TWO-SIDED handshake: the inviter already consented by creating the
 * invite, and the accepter consents here. Reunions require an explicit
 * reconnectChoice from BOTH sides (see relationship.controller reconnectChoose).
 *
 * Body: { reconnectChoice?: 'continue' | 'fresh' }
 */
exports.acceptInvite = async (req, res) => {
  const invite = await InviteToken.findOne({ token: req.params.token });
  if (!invite) {
    return res.status(404).json({ success: false, message: 'This invite is not valid.' });
  }

  const reason = invite.invalidReason();
  if (reason) {
    const copy = {
      expired: 'This invite has expired — ask them to send a new one.',
      used:    'This invite has already been used.',
      revoked: 'This invite was cancelled.',
    };
    return res.status(410).json({ success: false, message: copy[reason], data: { reason } });
  }

  const inviterId = invite.inviterId;
  if (String(inviterId) === String(req.user._id)) {
    return res.status(400).json({ success: false, message: "That's your own invite 🙂" });
  }

  // Invites created from partner discovery are bound to one specific user, so a
  // forwarded link cannot be redeemed by a third party.
  if (invite.targetUserId && String(invite.targetUserId) !== String(req.user._id)) {
    return res.status(403).json({
      success: false,
      message: 'This invite was sent to someone else.',
    });
  }

  // Targeted invites may only be redeemed by the intended recipient.
  if (invite.targetHash) {
    const mine = [
      req.user.email ? InviteToken.hashTarget(req.user.email) : null,
      req.user.phone ? InviteToken.hashTarget(req.user.phone) : null,
    ].filter(Boolean);
    if (!mine.includes(invite.targetHash)) {
      return res.status(403).json({
        success: false,
        message: 'This invite was sent to someone else.',
      });
    }
  }

  // Neither side may already be in a live relationship.
  const [myBlocking, theirBlocking] = await Promise.all([
    relService.findBlockingRelationship(req.user._id),
    relService.findBlockingRelationship(inviterId),
  ]);
  if (myBlocking) {
    return res.status(409).json({ success: false, message: 'You are already in a relationship.' });
  }
  if (theirBlocking) {
    return res.status(409).json({
      success: false,
      message: 'They are already in a relationship.',
    });
  }

  const inviter = await User.findById(inviterId).select('name nickname fcmToken pushNotificationsEnabled');
  if (!inviter) {
    return res.status(404).json({ success: false, message: 'This invite is not valid.' });
  }

  // Had these two been together before? Offer continue-vs-fresh instead of deciding for them.
  const archived = await relService.findArchivedBetween(inviterId, req.user._id);

  if (archived) {
    const cooldownUntil = new Date(
      new Date(archived.archivedAt || archived.updatedAt).getTime() + RECONNECT_COOLDOWN_HOURS * 60 * 60 * 1000
    );
    if (cooldownUntil > new Date()) {
      return res.status(409).json({
        success: false,
        message: 'You can reconnect a little later — take a moment first.',
        data: { reason: 'cooldown', cooldownUntil },
      });
    }

    // Revive as pending and record BOTH sides' choice before activating.
    const choice = req.body?.reconnectChoice;
    if (choice && !['continue', 'fresh'].includes(choice)) {
      return res.status(400).json({ success: false, message: "reconnectChoice must be 'continue' or 'fresh'" });
    }

    archived.status = 'pending';
    archived.isArchived = false;
    archived.archivedAt = null;
    archived.purgeScheduledAt = null;
    archived.purgeRequestedBy = null;
    const mySlot = archived.slotFor(req.user._id);
    if (mySlot === 1) {
      archived.user1Approved = true;
      archived.user1ReconnectChoice = choice || null;
      archived.user2Approved = false;
    } else {
      archived.user2Approved = true;
      archived.user2ReconnectChoice = choice || null;
      archived.user1Approved = false;
    }
    await archived.save();

    invite.usedAt = new Date();
    invite.usedBy = req.user._id;
    invite.relationshipId = archived._id;
    await invite.save();

    await relService.notifyUser(inviterId, {
      event: 'connection:request',
      socketPayload: {
        relationshipId: archived._id,
        requesterName: req.user.nickname || req.user.name || 'Someone',
        isReunion: true,
      },
      title: 'They accepted your invite 💞',
      body: `${req.user.name || 'Someone'} wants to pick up where you left off. Choose how to continue.`,
      data: { type: 'connection', relationshipId: String(archived._id) },
      relationshipId: archived._id,
    });

    return res.json({
      success: true,
      message: 'You were together before — choose how to continue.',
      data: {
        relationshipId: archived._id,
        isReunion: true,
        needsReconnectChoice: true,
        previous: {
          startDate: archived.startDate,
          archivedAt: archived.archivedAt,
          reconciliationCount: archived.reconciliationCount,
        },
      },
    });
  }

  // Fresh pair: the inviter consented by creating the invite, the accepter just did.
  const relationship = await Relationship.create({
    user1: inviterId,
    user2: req.user._id,
    status: 'pending',
    user1Approved: true,
    user2Approved: true,
  });

  invite.usedAt = new Date();
  invite.usedBy = req.user._id;
  invite.relationshipId = relationship._id;
  await invite.save();

  // Revoke the inviter's other outstanding invites — they are now connected.
  await InviteToken.updateMany(
    { inviterId, usedAt: null, revokedAt: null, _id: { $ne: invite._id } },
    { revokedAt: new Date() }
  );

  await relService.activateRelationship(relationship, { continuePrevious: false });

  await relService.notifyUser(inviterId, {
    title: "You're connected 💞",
    body: `${req.user.name || 'Someone'} joined you on TwinSoul!`,
    data: { type: 'connection_approved', relationshipId: String(relationship._id) },
    relationshipId: relationship._id,
  });

  res.json({
    success: true,
    message: "You're connected 💞",
    data: { relationshipId: relationship._id, isReunion: false, needsReconnectChoice: false },
  });
};

/**
 * GET /api/invite/mine
 * The inviter's outstanding invites — powers the "Waiting for…" card that
 * replaces the old one-shot "Request Sent!" alert.
 */
exports.getMyInvites = async (req, res) => {
  const invites = await InviteToken.find({
    inviterId: req.user._id,
    revokedAt: null,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  })
    .sort({ createdAt: -1 })
    .lean();

  res.json({
    success: true,
    data: {
      invites: invites.map((i) => ({
        token: i.token,
        url: `${APP_LINK_BASE}/i/${i.token}`,
        channel: i.channel,
        message: i.message,
        createdAt: i.createdAt,
        expiresAt: i.expiresAt,
        openedAt: i.openedAt,
        openCount: i.openCount,
      })),
    },
  });
};

/** DELETE /api/invite/:token — cancel an outstanding invite. */
exports.revokeInvite = async (req, res) => {
  const invite = await InviteToken.findOne({ token: req.params.token, inviterId: req.user._id });
  if (!invite) return res.status(404).json({ success: false, message: 'Invite not found' });
  if (invite.usedAt) {
    return res.status(400).json({ success: false, message: 'This invite has already been used.' });
  }
  invite.revokedAt = new Date();
  await invite.save();
  res.json({ success: true, message: 'Invite cancelled.' });
};

/**
 * POST /api/invite/contacts/match
 * Body: { hashes: string[] }
 *
 * Privacy-preserving contact discovery. The CLIENT hashes each normalised E.164
 * number with the server pepper; raw numbers never leave the device and
 * unmatched hashes are never stored or logged.
 *
 * Only users who are themselves unpartnered are returned — surfacing someone
 * already in a relationship would leak their relationship status.
 */
exports.matchContacts = async (req, res) => {
  const { hashes } = req.body || {};
  if (!Array.isArray(hashes) || hashes.length === 0) {
    return res.status(400).json({ success: false, message: 'hashes must be a non-empty array' });
  }
  if (hashes.length > 2000) {
    return res.status(413).json({ success: false, message: 'Too many contacts in one batch (max 2000)' });
  }

  const clean = hashes.filter((h) => typeof h === 'string' && /^[a-f0-9]{64}$/i.test(h)).slice(0, 2000);
  if (!clean.length) return res.json({ success: true, data: { matches: [] } });

  const users = await User.find({
    phoneHash: { $in: clean },
    _id: { $ne: req.user._id },
    isConnected: false,
  })
    .select('name nickname profilePhoto phoneHash')
    .limit(500)
    .lean();

  res.json({
    success: true,
    data: {
      matches: users.map((u) => ({
        ...publicInviter(u),
        phoneHash: u.phoneHash,
      })),
    },
  });
};

/** GET /api/invite/contacts/pepper — the pepper the client must hash with. */
exports.getContactPepper = async (req, res) => {
  const pepper = process.env.CONTACT_HASH_PEPPER;
  if (!pepper) {
    return res.status(503).json({
      success: false,
      message: 'Contact matching is not configured on this server.',
    });
  }
  res.json({ success: true, data: { pepper } });
};
