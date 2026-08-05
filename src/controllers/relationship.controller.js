const User = require('../models/User');
const Relationship = require('../models/Relationship');
const LoveTree = require('../models/LoveTree');
const RelationshipLevel = require('../models/RelationshipLevel');
const Notification = require('../models/Notification');
const InviteToken = require('../models/InviteToken');
const { getIo } = require('../config/socketInstance');
const Message = require('../models/Message');
const Photo = require('../models/Photo');
const relService = require('../services/relationship.service');
const statsService = require('../services/stats.service');
const { resolveStageInfo, TREE_STAGES } = require('../constants/progression');
const {
  GRACE_PERIOD_DAYS,
  RECONNECT_COOLDOWN_HOURS,
  END_REASONS,
  PURGE_DELAY_DAYS,
} = require('../constants/lifecycle');

const HOUR_MS = 60 * 60 * 1000;

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

/**
 * POST /decline
 *
 * Fixed: this used to hard-delete the Relationship row. For a REUNION invite
 * (a revived archived relationship) that permanently destroyed the link to the
 * couple's entire history — declining an invite is not consent to erase memories.
 * Reunion rows are now returned to `archived`; only genuinely new pending rows
 * are deleted.
 */
exports.declineConnection = async (req, res) => {
  const { relationshipId } = req.body || {};
  if (!relationshipId) {
    return res.status(400).json({ success: false, message: 'relationshipId required' });
  }

  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) {
    return res.status(404).json({ success: false, message: 'Request not found' });
  }
  if (relationship.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Request already processed' });
  }
  if (!relationship.isMember(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Not part of this request' });
  }

  const requesterId = relationship.user1Approved && !relationship.user2Approved
    ? relationship.user1
    : relationship.user2;

  // Does this row carry history? Then it is a reunion — archive, never delete.
  const hasHistory = !!relationship.startDate;

  if (hasHistory) {
    relationship.status = 'archived';
    relationship.isArchived = true;
    relationship.archivedAt = relationship.archivedAt || new Date();
    relationship.user1Approved = false;
    relationship.user2Approved = false;
    relationship.user1ReconnectChoice = null;
    relationship.user2ReconnectChoice = null;
    await relationship.save();
  } else {
    await Relationship.deleteOne({ _id: relationshipId });
  }
  await Notification.deleteMany({ relationshipId });

  // Declines are SILENT: the requester is told the invite is no longer active,
  // never that they were rejected. A coerced invite must be refusable without
  // confrontation.
  const io = getIo();
  if (io && requesterId) {
    io.to(`user:${requesterId.toString()}`).emit('connection:declined', {
      silent: true,
    });
  }

  res.json({ success: true, message: 'Request declined.' });
};

/**
 * POST /connect  — couple-code fallback.
 *
 * Retained for users who share a code verbally, but invite links (POST /api/invite)
 * are now the primary path. Password comparison is delegated to the User model so
 * hashed and legacy-plaintext values both work during migration.
 */
exports.connectWithCode = async (req, res) => {
  const { coupleCode, connectionPassword } = req.body || {};
  if (!coupleCode || !connectionPassword) {
    return res.status(400).json({ success: false, message: 'Couple code and password required' });
  }

  const partner = await User.findOne({ coupleCode: String(coupleCode).trim().toUpperCase() });
  // Uniform failure for unknown code vs wrong password — prevents code enumeration.
  const badCreds = () =>
    res.status(401).json({ success: false, message: 'Invalid couple code or password' });

  if (!partner) return badCreds();
  if (partner._id.toString() === req.user._id.toString()) {
    return res.status(400).json({ success: false, message: 'Cannot connect with yourself' });
  }

  const ok = typeof partner.verifyConnectionPassword === 'function'
    ? await partner.verifyConnectionPassword(connectionPassword)
    : partner.connectionPassword === connectionPassword;
  if (!ok) return badCreds();

  const [myBlocking, theirBlocking] = await Promise.all([
    relService.findBlockingRelationship(req.user._id),
    relService.findBlockingRelationship(partner._id),
  ]);
  if (myBlocking) {
    return res.status(409).json({ success: false, message: 'You are already in a relationship' });
  }
  if (theirBlocking) {
    return res.status(409).json({ success: false, message: 'This user is already in a relationship' });
  }

  // Existing pending request between the two.
  const existingPending = await Relationship.findOne({
    $or: [
      { user1: partner._id, user2: req.user._id },
      { user1: req.user._id, user2: partner._id },
    ],
    status: 'pending',
  });
  if (existingPending) {
    const slot = existingPending.slotFor(req.user._id);
    const iAmRequester = slot === 1 ? existingPending.user1Approved : existingPending.user2Approved;
    if (iAmRequester) {
      // Re-send: reset the pending row rather than deleting history-bearing rows.
      if (existingPending.startDate) {
        return res.json({
          success: true,
          message: 'Your request is already waiting for them.',
          data: { relationshipId: existingPending._id },
        });
      }
      await Relationship.deleteOne({ _id: existingPending._id });
      await Notification.deleteMany({ relationshipId: existingPending._id });
    } else {
      return res.status(409).json({
        success: false,
        message: 'This user already sent you a connection request. Check your pending requests.',
      });
    }
  }

  // Previous chapter between these two → reunion, with an explicit choice.
  const archived = await relService.findArchivedBetween(partner._id, req.user._id);

  let relationship;
  let isReunion = false;

  if (archived) {
    const cooldownUntil = new Date(
      new Date(archived.archivedAt || archived.updatedAt).getTime() + RECONNECT_COOLDOWN_HOURS * HOUR_MS
    );
    if (cooldownUntil > new Date()) {
      return res.status(409).json({
        success: false,
        message: 'You can reconnect a little later — take a moment first.',
        data: { reason: 'cooldown', cooldownUntil },
      });
    }

    isReunion = true;
    archived.status = 'pending';
    archived.isArchived = false;
    archived.archivedAt = null;
    archived.purgeScheduledAt = null;
    archived.purgeRequestedBy = null;
    const slot = archived.slotFor(req.user._id);
    archived.user1Approved = slot === 1;
    archived.user2Approved = slot === 2;
    archived.user1ReconnectChoice = null;
    archived.user2ReconnectChoice = null;
    await archived.save();
    relationship = archived;
  } else {
    relationship = await Relationship.create({
      user1: partner._id,
      user2: req.user._id,
      status: 'pending',
      user1Approved: false,
      user2Approved: true,
    });
  }

  await relService.notifyUser(partner._id, {
    event: 'connection:request',
    socketPayload: {
      relationshipId: relationship._id,
      requesterName: req.user.nickname || req.user.name || 'Someone',
      isReunion,
    },
    title: 'Connection Request 💕',
    body: `${req.user.name || 'Someone'} wants to connect with you!`,
    data: { type: 'connection', relationshipId: String(relationship._id) },
    relationshipId: relationship._id,
  });

  res.json({
    success: true,
    message: 'Connection request sent. Waiting for your partner to approve.',
    data: {
      relationshipId: relationship._id,
      partnerId: partner._id,
      partnerName: partner.name,
      isReunion,
      needsReconnectChoice: isReunion,
    },
  });
};

/**
 * GET /pending
 * Returns ALL pending requests. Previously returned only one even though the
 * schema permits several, so a second invite was invisible.
 * `pending` (singular) is kept for backward compatibility with the current app.
 */
exports.getPendingRequest = async (req, res) => {
  const rows = await Relationship.find({
    $or: [{ user1: req.user._id }, { user2: req.user._id }],
    status: 'pending',
  })
    .populate('user1', 'name nickname profilePhoto')
    .populate('user2', 'name nickname profilePhoto')
    .sort({ updatedAt: -1 });

  const mapped = rows
    .filter((r) => r.user1 && r.user2)
    .map((r) => {
      const slot = r.slotFor(req.user._id);
      const other = slot === 1 ? r.user2 : r.user1;
      const myApproved = slot === 1 ? r.user1Approved : r.user2Approved;
      const myChoice = slot === 1 ? r.user1ReconnectChoice : r.user2ReconnectChoice;
      return {
        relationshipId: r._id,
        requesterName: other?.nickname || other?.name || 'Partner',
        requesterPhoto: other?.profilePhoto || '',
        myApproved,
        needsMyApproval: !myApproved,
        isReunion: !!r.startDate,
        needsReconnectChoice: !!r.startDate && !myChoice,
        previousStartDate: r.startDate || null,
        reconciliationCount: r.reconciliationCount || 0,
        createdAt: r.createdAt,
      };
    });

  res.json({
    success: true,
    data: { pending: mapped[0] || null, requests: mapped },
  });
};

/**
 * POST /approve
 * Body: { relationshipId, reconnectChoice? }
 *
 * For a reunion, BOTH partners must choose continue-vs-fresh. Any disagreement
 * resolves to `fresh` — the safer default, since it never surfaces old content
 * to someone who did not ask for it.
 */
exports.approveConnection = async (req, res) => {
  const { relationshipId, reconnectChoice } = req.body || {};
  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Relationship not found' });
  if (relationship.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Connection already processed' });
  }

  const slot = relationship.slotFor(req.user._id);
  if (!slot) return res.status(403).json({ success: false, message: 'Not part of this relationship' });

  const isReunion = !!relationship.startDate;
  if (isReunion) {
    if (!reconnectChoice || !['continue', 'fresh'].includes(reconnectChoice)) {
      return res.status(400).json({
        success: false,
        message: "This is a reunion — reconnectChoice must be 'continue' or 'fresh'",
        data: { needsReconnectChoice: true, previousStartDate: relationship.startDate },
      });
    }
    if (slot === 1) relationship.user1ReconnectChoice = reconnectChoice;
    else relationship.user2ReconnectChoice = reconnectChoice;
  }

  if (slot === 1) relationship.user1Approved = true;
  else relationship.user2Approved = true;

  if (!(relationship.user1Approved && relationship.user2Approved)) {
    await relationship.save();
    return res.json({
      success: true,
      message: 'Approval recorded. Waiting for partner.',
      data: { relationship },
    });
  }

  // Both approved. Only "continue" from BOTH sides continues the old chapter.
  const bothWantContinue =
    relationship.user1ReconnectChoice === 'continue' &&
    relationship.user2ReconnectChoice === 'continue';
  const continuePrevious = isReunion && bothWantContinue;

  if (isReunion && !continuePrevious) {
    // Fresh start: archive the old chapter as its own row so its content is
    // never mixed into the new relationship, then begin a brand-new one.
    const fresh = await Relationship.create({
      user1: relationship.user1,
      user2: relationship.user2,
      status: 'pending',
      user1Approved: true,
      user2Approved: true,
    });

    relationship.status = 'archived';
    relationship.isArchived = true;
    relationship.archivedAt = relationship.archivedAt || new Date();
    relationship.user1Approved = false;
    relationship.user2Approved = false;
    relationship.user1ReconnectChoice = null;
    relationship.user2ReconnectChoice = null;
    await relationship.save();

    await relService.activateRelationship(fresh, { continuePrevious: false });
    return res.json({
      success: true,
      message: 'Starting fresh 🌱 Your previous chapter is safe in your Archive.',
      data: { relationship: fresh, startedFresh: true, archivedRelationshipId: relationship._id },
    });
  }

  await relService.activateRelationship(relationship, { continuePrevious });
  await InviteToken.updateMany(
    { inviterId: { $in: [relationship.user1, relationship.user2] }, usedAt: null, revokedAt: null },
    { revokedAt: new Date() }
  );

  res.json({
    success: true,
    message: continuePrevious
      ? 'Back together 💞 Everything is where you left it.'
      : 'Connection approved! Your private space is ready.',
    data: { relationship, continuedPrevious: continuePrevious },
  });
};

/**
 * POST /reconnect-choice
 * Record continue-vs-fresh without also approving, so the choice screen can be
 * answered separately from the accept action.
 */
exports.reconnectChoose = async (req, res) => {
  const { relationshipId, choice } = req.body || {};
  if (!['continue', 'fresh'].includes(choice)) {
    return res.status(400).json({ success: false, message: "choice must be 'continue' or 'fresh'" });
  }
  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Not found' });
  if (relationship.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Already processed' });
  }
  const slot = relationship.slotFor(req.user._id);
  if (!slot) return res.status(403).json({ success: false, message: 'Not authorized' });

  if (slot === 1) relationship.user1ReconnectChoice = choice;
  else relationship.user2ReconnectChoice = choice;
  await relationship.save();

  const bothChosen = relationship.user1ReconnectChoice && relationship.user2ReconnectChoice;
  res.json({
    success: true,
    message: 'Choice saved.',
    data: { bothChosen, myChoice: choice },
  });
};

exports.getDashboard = async (req, res) => {
  if (!requireRelationship(req, res)) return;

  const [relationship, partner, tree, level, recentPhotos, recentMessages, stats] = await Promise.all([
    Relationship.findById(req.user.relationshipId),
    User.findById(req.user.partnerId).select('name nickname profilePhoto isOnline lastSeen bubbleColor'),
    LoveTree.findOne({ relationshipId: req.user.relationshipId }),
    RelationshipLevel.findOne({ relationshipId: req.user.relationshipId }),
    Photo.find({ relationshipId: req.user.relationshipId, isDeleted: false }).sort({ createdAt: -1 }).limit(5),
    Message.find({ relationshipId: req.user.relationshipId, isDeleted: false }).sort({ createdAt: -1 }).limit(5),
    statsService.getStats(req.user.relationshipId),
  ]);

  if (!relationship) {
    return res.status(404).json({ success: false, message: 'Relationship not found' });
  }

  const stageInfo = resolveStageInfo(tree?.points);

  res.json({
    success: true,
    data: {
      daysTogether: stats?.daysTogether ?? 0,
      partner,
      loveTree: tree,
      // Server-computed so the app stops using its own divergent thresholds.
      treeStages: TREE_STAGES,
      treeStageInfo: stageInfo,
      level,
      recentPhotos,
      recentMessages,
      relationship: {
        _id: relationship._id,
        status: Relationship.normalizeStatus(relationship.status),
        rawStatus: relationship.status,
        startDate: relationship.startDate,
        pauseUntil: relationship.pauseUntil,
        gracePeriodEndsAt: relationship.gracePeriodEndsAt,
        reconciliationCount: relationship.reconciliationCount,
      },
      // Defaults now come from the schema instead of a hardcoded object that
      // disagreed with it about watchTogether.
      features: relationship.features?.toObject?.() ?? relationship.features ?? {},
      stats: stats
        ? {
            messages: stats.messages,
            calls: stats.calls,
            photos: stats.photos,
            memories: stats.memories,
            goals: stats.goals,
            games: stats.games,
            mood: stats.mood,
            streaks: stats.streaks,
            weeklyScore: stats.weeklyScore,
            computedAt: stats.computedAt,
          }
        : null,
      // Kept flat for the existing app, which reads dashboard.streak.
      streak: stats?.streaks?.current ?? 0,
    },
  });
};

/** GET /stats — full rollup, force-refreshable. */
exports.getStats = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const stats = await statsService.getStats(req.user.relationshipId, {
    force: req.query.refresh === '1',
  });
  res.json({ success: true, data: { stats } });
};

exports.getRelationshipInfo = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const relationship = await Relationship.findById(req.user.relationshipId)
    .populate('user1', 'name nickname profilePhoto email')
    .populate('user2', 'name nickname profilePhoto email');
  if (!relationship) {
    return res.status(404).json({ success: false, message: 'Relationship not found' });
  }
  res.json({
    success: true,
    data: {
      relationship: {
        ...relationship.toObject(),
        status: Relationship.normalizeStatus(relationship.status),
        rawStatus: relationship.status,
      },
    },
  });
};

/**
 * POST /leave
 * Body: { reason? }
 *
 * Begins a 7-day GRACE PERIOD instead of ending the relationship instantly.
 *
 * Previously this was immediate, unilateral and irreversible: it flipped status
 * to 'ended', nulled both users' links, deleted nothing, and left every
 * LoveTree/Message/Photo/Diary row orphaned behind a relationshipId no
 * controller could reach again. Nothing is deleted now, and either partner can
 * undo for 7 days.
 */
exports.requestLeave = async (req, res) => {
  if (!requireRelationship(req, res)) return;

  const relationship = await Relationship.findById(req.user.relationshipId);
  if (!relationship) {
    return res.status(404).json({ success: false, message: 'Relationship not found' });
  }
  if (!['active', 'paused'].includes(relationship.status)) {
    return res.status(400).json({ success: false, message: 'Relationship is not active' });
  }

  const reason = req.body?.reason;
  if (reason && !END_REASONS.includes(reason)) {
    return res.status(400).json({
      success: false,
      message: `reason must be one of: ${END_REASONS.join(', ')}`,
    });
  }

  await relService.beginEnding(relationship, req.user._id, reason);

  res.json({
    success: true,
    message: 'Your relationship has ended. Everything you shared is safe in your Archive.',
    data: {
      relationshipId: relationship._id,
      gracePeriodEndsAt: relationship.gracePeriodEndsAt,
      gracePeriodDays: GRACE_PERIOD_DAYS,
      canUndo: true,
    },
  });
};

/**
 * POST /undo-leave  (alias: POST /cancel-leave)
 *
 * Replaces the old cancelLeave, which was dead code: nothing ever set the
 * *WantsLeave flags it cleared, and after a leave the caller's relationshipId
 * was already null so it always 400'd.
 */
exports.undoLeave = async (req, res) => {
  const bodyId = req.body?.relationshipId;

  // After a leave the user has no relationshipId, so find their ending row.
  const relationship = bodyId
    ? await Relationship.findById(bodyId)
    : await Relationship.findOne({
        $or: [{ user1: req.user._id }, { user2: req.user._id }],
        status: 'ending',
      }).sort({ endedAt: -1 });

  if (!relationship) {
    return res.status(404).json({ success: false, message: 'Nothing to undo' });
  }
  if (!relationship.isMember(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  if (relationship.status !== 'ending') {
    return res.status(400).json({
      success: false,
      message: relationship.status === 'archived'
        ? 'The grace period has passed. You can reconnect from your Archive.'
        : 'This relationship is not ending.',
    });
  }
  if (relationship.gracePeriodEndsAt && relationship.gracePeriodEndsAt < new Date()) {
    return res.status(400).json({ success: false, message: 'The grace period has passed.' });
  }

  // Refuse if either person has already started a new relationship.
  const [b1, b2] = await Promise.all([
    relService.findBlockingRelationship(relationship.user1),
    relService.findBlockingRelationship(relationship.user2),
  ]);
  const blocking = [b1, b2].find((b) => b && String(b._id) !== String(relationship._id));
  if (blocking) {
    return res.status(409).json({
      success: false,
      message: 'This can no longer be undone — one of you has since connected with someone else.',
    });
  }

  await relService.undoEnding(relationship);
  res.json({
    success: true,
    message: 'Welcome back ❤️ Nothing was lost.',
    data: { relationship },
  });
};
// Backward compatibility: the app still calls POST /relationship/cancel-leave.
exports.cancelLeave = exports.undoLeave;

/**
 * POST /pause  — "Take a Break".
 * Implements the `paused` status, which existed in the enum but was never
 * written or read anywhere. Users stay linked; streaks freeze; nothing is lost.
 */
exports.pauseRelationship = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const relationship = await Relationship.findById(req.user.relationshipId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Relationship not found' });
  if (relationship.status !== 'active') {
    return res.status(400).json({ success: false, message: 'Relationship is not active' });
  }

  const { days } = req.body || {};
  let until = null;
  if (days != null) {
    const n = Number(days);
    if (!Number.isFinite(n) || n <= 0 || n > 365) {
      return res.status(400).json({ success: false, message: 'days must be between 1 and 365' });
    }
    until = new Date(Date.now() + n * 24 * HOUR_MS);
  }

  await relService.pauseRelationship(relationship, req.user._id, until);
  res.json({
    success: true,
    message: 'Taking space is healthy. Everything will be here. 🌙',
    data: { relationship },
  });
};

/** POST /resume — either partner may resume a break. */
exports.resumeRelationship = async (req, res) => {
  const bodyId = req.body?.relationshipId || req.user.relationshipId;
  const relationship = await Relationship.findById(bodyId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Relationship not found' });
  if (!relationship.isMember(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }
  if (relationship.status !== 'paused') {
    return res.status(400).json({ success: false, message: 'Relationship is not paused' });
  }

  await relService.resumeRelationship(relationship);
  res.json({ success: true, message: 'Welcome back ❤️', data: { relationship } });
};

/**
 * POST /restore
 *
 * Reviving an ARCHIVED relationship now requires the partner's consent: it moves
 * the row to `pending` and notifies them. Previously either ex-partner could
 * unilaterally re-link BOTH accounts with no consent, no cooldown and no check
 * for whether the other person had since partnered with someone else.
 */
exports.restoreRelationship = async (req, res) => {
  const { relationshipId } = req.body || {};
  const relationship = await Relationship.findById(relationshipId);
  if (!relationship) return res.status(404).json({ success: false, message: 'Relationship not found' });
  if (!relationship.isMember(req.user._id)) {
    return res.status(403).json({ success: false, message: 'Not authorized' });
  }

  // Grace period → a plain undo, no partner consent needed.
  if (relationship.status === 'ending') return exports.undoLeave(req, res);

  if (!['archived', 'ended'].includes(relationship.status)) {
    return res.status(400).json({ success: false, message: 'This relationship is not archived' });
  }

  const cooldownUntil = new Date(
    new Date(relationship.archivedAt || relationship.updatedAt).getTime() + RECONNECT_COOLDOWN_HOURS * HOUR_MS
  );
  if (cooldownUntil > new Date()) {
    return res.status(409).json({
      success: false,
      message: 'You can reconnect a little later — take a moment first.',
      data: { reason: 'cooldown', cooldownUntil },
    });
  }

  const [b1, b2] = await Promise.all([
    relService.findBlockingRelationship(relationship.user1),
    relService.findBlockingRelationship(relationship.user2),
  ]);
  if (b1 || b2) {
    return res.status(409).json({
      success: false,
      message: 'One of you is already in a relationship.',
    });
  }

  const slot = relationship.slotFor(req.user._id);
  relationship.status = 'pending';
  relationship.isArchived = false;
  relationship.archivedAt = null;
  relationship.purgeScheduledAt = null;
  relationship.purgeRequestedBy = null;
  relationship.user1Approved = slot === 1;
  relationship.user2Approved = slot === 2;
  relationship.user1ReconnectChoice = null;
  relationship.user2ReconnectChoice = null;
  await relationship.save();

  const partnerId = relationship.partnerOf(req.user._id);
  if (partnerId) {
    await relService.notifyUser(partnerId, {
      event: 'connection:request',
      socketPayload: {
        relationshipId: relationship._id,
        requesterName: req.user.nickname || req.user.name || 'Someone',
        isReunion: true,
      },
      title: 'They want to reconnect 💞',
      body: `${req.user.name || 'Someone'} would like to pick things back up.`,
      data: { type: 'connection', relationshipId: String(relationship._id) },
      relationshipId: relationship._id,
    });
  }

  res.json({
    success: true,
    message: 'Reconnect request sent. Waiting for your partner.',
    data: { relationship, needsPartnerApproval: true, needsReconnectChoice: true },
  });
};

exports.updateFeatures = async (req, res) => {
  if (!requireRelationship(req, res)) return;

  const VALID_KEYS = ['voiceCall', 'videoCall', 'chat', 'memories', 'music', 'loveTree', 'watchTogether', 'goals'];
  const { featureKey, enabled } = req.body || {};

  if (!VALID_KEYS.includes(featureKey)) {
    return res.status(400).json({ success: false, message: `Invalid featureKey. Valid: ${VALID_KEYS.join(', ')}` });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, message: 'enabled must be boolean' });
  }

  const relationship = await Relationship.findByIdAndUpdate(
    req.user.relationshipId,
    { [`features.${featureKey}`]: enabled },
    { new: true },
  );
  if (!relationship) {
    return res.status(404).json({ success: false, message: 'Relationship not found' });
  }

  const io = getIo();
  if (io) {
    io.to(`relationship:${relationship._id}`).emit('features:updated', relationship.features);
  }

  res.json({ success: true, data: { features: relationship.features } });
};

/** GET /end-reasons — the private reason list offered when ending. */
exports.getEndReasons = async (_req, res) => {
  res.json({
    success: true,
    data: {
      reasons: END_REASONS,
      gracePeriodDays: GRACE_PERIOD_DAYS,
      purgeDelayDays: PURGE_DELAY_DAYS,
    },
  });
};
