const User = require('../models/User');
const Relationship = require('../models/Relationship');
const LoveTree = require('../models/LoveTree');
const RelationshipLevel = require('../models/RelationshipLevel');
const TimelineEvent = require('../models/TimelineEvent');
const Notification = require('../models/Notification');
const { getIo } = require('../config/socketInstance');
const sendPushNotification = require('../utils/sendPushNotification');
const { GRACE_PERIOD_DAYS, PURGE_DELAY_DAYS } = require('../constants/lifecycle');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Shared relationship lifecycle operations.
 *
 * Extracted so the couple-code path, the invite-token path, and the cron jobs
 * all run the SAME activation/ending logic instead of three divergent copies.
 */

/**
 * Link both users to a relationship.
 *
 * Also flips `partnerStatus` to `'joined'` and clears `discoveryOptIn`: someone who
 * is now in a relationship must drop out of partner search immediately, both
 * because listing them would be useless and because it would leak their status.
 */
const linkUsers = async (relationship) => {
  const patch = {
    isConnected: true,
    partnerStatus: 'joined',
    discoveryOptIn: false,
  };
  await Promise.all([
    User.findByIdAndUpdate(relationship.user1, {
      ...patch,
      partnerId: relationship.user2,
      relationshipId: relationship._id,
    }),
    User.findByIdAndUpdate(relationship.user2, {
      ...patch,
      partnerId: relationship.user1,
      relationshipId: relationship._id,
    }),
  ]);
};

/**
 * Unlink both users from their current relationship.
 *
 * Guarded so we never clear a user who has already moved on to a NEW
 * relationship — the old code unconditionally nulled both users, which could
 * clobber a newer partnership.
 *
 * Sets `partnerStatus: 'broken_up'` and stamps `lastBreakupAt`, which is what
 * makes partner search possible. `discoveryOptIn` is NOT auto-enabled here:
 * ending a relationship is not consent to be listed to strangers. The user opts
 * in themselves from Settings.
 */
const unlinkUsers = async (relationship) => {
  const clear = {
    isConnected: false,
    partnerId: null,
    relationshipId: null,
    partnerStatus: 'broken_up',
    lastBreakupAt: new Date(),
  };
  await Promise.all([
    User.updateOne({ _id: relationship.user1, relationshipId: relationship._id }, clear),
    User.updateOne({ _id: relationship.user2, relationshipId: relationship._id }, clear),
  ]);
};

/** Join both users' live sockets to the relationship room. */
const joinRoom = (relationship) => {
  const io = getIo();
  if (!io) return;
  const room = `relationship:${relationship._id}`;
  io.in(`user:${relationship.user1}`).socketsJoin(room);
  io.in(`user:${relationship.user2}`).socketsJoin(room);
};

const emitToBoth = (relationship, event, payload = {}) => {
  const io = getIo();
  if (!io) return;
  io.to(`user:${relationship.user1}`).emit(event, payload);
  io.to(`user:${relationship.user2}`).emit(event, payload);
};

/** Notify one user via socket + push + in-app notification record. */
const notifyUser = async (userId, { event, socketPayload, title, body, data = {}, relationshipId }) => {
  const io = getIo();
  if (io && event) io.to(`user:${userId}`).emit(event, socketPayload || {});

  if (title) {
    await Notification.create({
      userId,
      relationshipId: relationshipId || null,
      type: data.type || 'relationship',
      title,
      body: body || '',
      data,
    }).catch(() => {});

    const user = await User.findById(userId).select('fcmToken pushNotificationsEnabled').lean();
    if (user?.fcmToken && user.pushNotificationsEnabled !== false) {
      await sendPushNotification({ fcmToken: user.fcmToken, title, body, data }).catch(() => {});
    }
  }
};

/**
 * Bring a `pending` relationship to `active`.
 * Idempotent: safe to call on an already-active relationship.
 *
 * @param {Relationship} relationship
 * @param {{ continuePrevious?: boolean }} opts
 *        continuePrevious — reunion that keeps the original startDate & Love Tree.
 */
const activateRelationship = async (relationship, opts = {}) => {
  const hadHistory = !!relationship.startDate;
  const continuePrevious = opts.continuePrevious ?? hadHistory;

  relationship.status = 'active';
  relationship.user1Approved = true;
  relationship.user2Approved = true;
  relationship.user1WantsLeave = false;
  relationship.user2WantsLeave = false;
  relationship.endedBy = null;
  relationship.endedAt = null;
  relationship.gracePeriodEndsAt = null;
  relationship.endReason = null;
  relationship.isArchived = false;
  relationship.archivedAt = null;
  relationship.purgeScheduledAt = null;
  relationship.purgeRequestedBy = null;
  relationship.pausedAt = null;
  relationship.pausedBy = null;
  relationship.pauseUntil = null;
  relationship.hiddenForUsers = [];
  relationship.user1ReconnectChoice = null;
  relationship.user2ReconnectChoice = null;

  if (continuePrevious && hadHistory) {
    relationship.reconciliationCount = (relationship.reconciliationCount || 0) + 1;
  } else {
    // Fresh start: new day-count from today.
    relationship.startDate = new Date();
  }

  await relationship.save();
  await linkUsers(relationship);

  // Create progression docs if absent. On a "continue" reunion the existing
  // LoveTree/level are reused untouched, so the tree resumes where it froze.
  const [tree, level] = await Promise.all([
    LoveTree.findOne({ relationshipId: relationship._id }),
    RelationshipLevel.findOne({ relationshipId: relationship._id }),
  ]);
  if (!tree) await LoveTree.create({ relationshipId: relationship._id });
  if (!level) await RelationshipLevel.create({ relationshipId: relationship._id });

  const isReunion = hadHistory && continuePrevious;
  await TimelineEvent.create({
    relationshipId: relationship._id,
    eventType: isReunion ? 'reunion' : 'first_connection',
    title: isReunion ? 'Reunion 💞' : 'First Connection ❤️',
    description: isReunion ? 'Back together again!' : 'Two souls connected!',
    eventDate: new Date(),
    isAutoGenerated: true,
  }).catch(() => {});

  joinRoom(relationship);
  emitToBoth(relationship, 'connection:approved', {
    relationshipId: relationship._id,
    isReunion,
  });

  return relationship;
};

/**
 * Move an active relationship into the `ending` grace period.
 *
 * This REPLACES the old immediate, unilateral, irreversible teardown:
 *   - data is untouched (nothing deleted, nothing orphaned)
 *   - both users drop to solo but the relationship remains fully restorable
 *   - `gracePeriodEndsAt` drives the archive cron
 */
const beginEnding = async (relationship, byUserId, reason = null) => {
  const now = new Date();
  relationship.status = 'ending';
  relationship.endedBy = byUserId;
  relationship.endedAt = now;
  relationship.gracePeriodEndsAt = new Date(now.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
  relationship.endReason = reason || null;
  relationship.user1WantsLeave = false;
  relationship.user2WantsLeave = false;
  await relationship.save();

  await unlinkUsers(relationship);

  const partnerId = relationship.partnerOf(byUserId);
  const initiator = await User.findById(byUserId).select('name nickname').lean();
  const initiatorName = initiator?.nickname || initiator?.name || 'Your partner';

  if (partnerId) {
    await notifyUser(partnerId, {
      event: 'relationship:left',
      socketPayload: {
        leaverName: initiatorName,
        relationshipId: relationship._id,
        gracePeriodEndsAt: relationship.gracePeriodEndsAt,
      },
      title: 'Your relationship has ended',
      body: `Everything you shared is safe in your Archive.`,
      data: { type: 'relationship_ended', relationshipId: String(relationship._id) },
      relationshipId: relationship._id,
    });
  }

  // Tell the initiator's other devices too.
  const io = getIo();
  if (io) {
    io.to(`user:${byUserId}`).emit('relationship:ending', {
      relationshipId: relationship._id,
      gracePeriodEndsAt: relationship.gracePeriodEndsAt,
    });
  }

  return relationship;
};

/** Undo an `ending` during the grace period, restoring the relationship intact. */
const undoEnding = async (relationship) => {
  await activateRelationship(relationship, { continuePrevious: true });
  // activateRelationship bumps reconciliationCount; an undo is not a reconciliation.
  relationship.reconciliationCount = Math.max(0, (relationship.reconciliationCount || 1) - 1);
  await relationship.save();
  emitToBoth(relationship, 'relationship:restored', { relationshipId: relationship._id });
  return relationship;
};

/** Grace period expired → durable read-only archive. */
const archiveRelationship = async (relationship) => {
  const wasAlreadyArchived = relationship.isArchived;

  relationship.status = 'archived';
  relationship.isArchived = true;
  relationship.archivedAt = new Date();
  relationship.gracePeriodEndsAt = null;
  await relationship.save();
  await unlinkUsers(relationship);

  // Counted here, not in unlinkUsers: unlinkUsers also runs during beginEnding,
  // and an undo inside the grace period must not leave a phantom count behind.
  // This is the point the breakup becomes final.
  if (!wasAlreadyArchived) {
    await User.updateMany(
      { _id: { $in: [relationship.user1, relationship.user2].filter(Boolean) } },
      { $inc: { relationshipCount: 1 }, $set: { partnerStatus: 'broken_up' } },
    ).catch(() => {});
  }

  emitToBoth(relationship, 'relationship:archived', { relationshipId: relationship._id });
  return relationship;
};

/** Pause ("Take a Break") — read-only both sides, streaks frozen, resumable. */
const pauseRelationship = async (relationship, byUserId, until = null) => {
  relationship.status = 'paused';
  relationship.pausedAt = new Date();
  relationship.pausedBy = byUserId;
  relationship.pauseUntil = until || null;
  await relationship.save();
  // Users stay LINKED while paused — this is not a breakup.
  emitToBoth(relationship, 'relationship:paused', {
    relationshipId: relationship._id,
    pauseUntil: relationship.pauseUntil,
  });
  return relationship;
};

const resumeRelationship = async (relationship) => {
  relationship.status = 'active';
  relationship.pausedAt = null;
  relationship.pausedBy = null;
  relationship.pauseUntil = null;
  await relationship.save();
  await linkUsers(relationship);
  joinRoom(relationship);
  emitToBoth(relationship, 'relationship:resumed', { relationshipId: relationship._id });
  return relationship;
};

/** Schedule permanent deletion. Cancellable until the cron fires. */
const schedulePurge = async (relationship, byUserId) => {
  relationship.purgeScheduledAt = new Date(Date.now() + PURGE_DELAY_DAYS * DAY_MS);
  relationship.purgeRequestedBy = byUserId;
  await relationship.save();
  return relationship;
};

const cancelPurge = async (relationship) => {
  relationship.purgeScheduledAt = null;
  relationship.purgeRequestedBy = null;
  await relationship.save();
  return relationship;
};

/**
 * Find the relationship a user is currently a member of, in any live state.
 * Used to block starting a new relationship while one is still active/ending.
 */
const findBlockingRelationship = async (userId) =>
  Relationship.findOne({
    $or: [{ user1: userId }, { user2: userId }],
    status: { $in: ['active', 'paused', 'ending'] },
  });

/** Most recent archived (or legacy `ended`) relationship between two users. */
const findArchivedBetween = async (a, b) =>
  Relationship.findOne({
    $or: [
      { user1: a, user2: b },
      { user1: b, user2: a },
    ],
    status: { $in: ['archived', 'ended'] },
  }).sort({ updatedAt: -1 });

module.exports = {
  DAY_MS,
  linkUsers,
  unlinkUsers,
  joinRoom,
  emitToBoth,
  notifyUser,
  activateRelationship,
  beginEnding,
  undoEnding,
  archiveRelationship,
  pauseRelationship,
  resumeRelationship,
  schedulePurge,
  cancelPurge,
  findBlockingRelationship,
  findArchivedBetween,
};
