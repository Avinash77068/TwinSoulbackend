const Relationship = require('../models/Relationship');
const relService = require('../services/relationship.service');
const {
  ARCHIVE_RETENTION_MONTHS,
  ARCHIVE_WARNING_DAYS_BEFORE,
} = require('../constants/lifecycle');

/**
 * Relationship lifecycle transitions that happen on a timer.
 * None of this existed: nothing advanced `ending` → `archived`, nothing acted on
 * `pauseUntil`, and no purge was ever executed.
 */
module.exports = (scheduleLocked) => {
  // ── legacy `ending` rows → archived ─────────────────────────────────────────
  // Grace-period countdown/undo was removed — leaving a relationship now
  // archives it immediately (see relService.endRelationship) — but any
  // relationship that was already mid-countdown when this shipped would
  // otherwise be stranded in `ending` forever with no cron left to finish the
  // job. This sweep drains those legacy rows; going forward nothing creates
  // new `ending` rows, so it should settle to a permanent no-op.
  scheduleLocked('lifecycle:sweepLegacyEnding', '*/10 * * * *', async () => {
    const due = await Relationship.find({ status: 'ending' }).limit(200);

    for (const rel of due) {
      try {
        await relService.archiveRelationship(rel);
        console.log(`[Cron:lifecycle] Archived legacy ending relationship ${rel._id}`);
      } catch (err) {
        console.error(`[Cron:lifecycle] archive ${rel._id} failed:`, err.message);
      }
    }
  });

  // ── paused → active, when an auto-resume date passes ──────────────────────
  scheduleLocked('lifecycle:resume', '*/15 * * * *', async () => {
    const due = await Relationship.find({
      status: 'paused',
      pauseUntil: { $ne: null, $lte: new Date() },
    }).limit(200);

    for (const rel of due) {
      try {
        await relService.resumeRelationship(rel);
        console.log(`[Cron:lifecycle] Auto-resumed relationship ${rel._id}`);
      } catch (err) {
        console.error(`[Cron:lifecycle] resume ${rel._id} failed:`, err.message);
      }
    }
  });

  // ── Execute scheduled permanent deletions ─────────────────────────────────
  scheduleLocked('lifecycle:purge', '17 3 * * *', async () => {
    const due = await Relationship.find({
      purgeScheduledAt: { $ne: null, $lte: new Date() },
      status: { $in: ['archived', 'ended'] },
    }).limit(50);

    for (const rel of due) {
      try {
        await purgeRelationshipData(rel);
        console.log(`[Cron:lifecycle] Purged relationship ${rel._id}`);
      } catch (err) {
        console.error(`[Cron:lifecycle] purge ${rel._id} failed:`, err.message);
      }
    }
  }, 15 * 60 * 1000);

  // ── Warn before archive retention expires — never delete memories silently ─
  scheduleLocked('lifecycle:retentionWarning', '23 4 * * *', async () => {
    const now = Date.now();
    const cutoff = new Date(
      now - (ARCHIVE_RETENTION_MONTHS * 30 - ARCHIVE_WARNING_DAYS_BEFORE) * 24 * 60 * 60 * 1000
    );
    const due = await Relationship.find({
      status: { $in: ['archived', 'ended'] },
      archivedAt: { $ne: null, $lte: cutoff },
      purgeScheduledAt: null,
    }).limit(100);

    for (const rel of due) {
      for (const userId of [rel.user1, rel.user2].filter(Boolean)) {
        await relService.notifyUser(userId, {
          title: 'Your archived memories expire soon',
          body: `Download them or keep them longer — nothing is deleted without your say.`,
          data: { type: 'archive_expiring', relationshipId: String(rel._id) },
          relationshipId: rel._id,
        }).catch(() => {});
      }
    }
  });
};

/**
 * Permanently delete every document belonging to a relationship.
 *
 * Only ever called for a purge the user explicitly scheduled and did not cancel
 * within the delay window.
 */
const purgeRelationshipData = async (rel) => {
  const relationshipId = rel._id;
  const models = [
    'Message', 'Photo', 'Album', 'Diary', 'TimeCapsule', 'TimelineEvent',
    'Goal', 'MiniGame', 'MoodEntry', 'MidnightMemory', 'MusicSession',
    'Playlist', 'Notification', 'ScheduledMessage', 'CustomQuestion',
    'LoveTree', 'RelationshipLevel', 'RelationshipStats', 'Theme',
    'WheelConfig', 'CallLog', 'ProgressionLedger',
  ];

  for (const name of models) {
    try {
      const Model = require(`../models/${name}`);
      await Model.deleteMany({ relationshipId });
    } catch (err) {
      // A model that does not exist or lacks relationshipId is not fatal.
      if (err.code !== 'MODULE_NOT_FOUND') {
        console.error(`[Purge] ${name} failed:`, err.message);
      }
    }
  }

  rel.status = 'purged';
  rel.isArchived = false;
  rel.purgeScheduledAt = null;
  await rel.save();
};

module.exports.purgeRelationshipData = purgeRelationshipData;
