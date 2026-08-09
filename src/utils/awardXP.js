const RelationshipLevel = require('../models/RelationshipLevel');
const ProgressionLedger = require('../models/ProgressionLedger');
const {
  getTitle,
  xpToNextForLevel,
  XP_ACTIONS,
  XP_DAILY_CAP,
} = require('../constants/progression');

const claimFromLedger = async (relationshipId, field, want, cap) => {
  if (want <= 0) return 0;
  const day = ProgressionLedger.dayKey();

  // Ensure today's row exists without disturbing existing counters.
  await ProgressionLedger.updateOne(
    { relationshipId, day },
    { $setOnInsert: { relationshipId, day } },
    { upsert: true }
  );

  const current = await ProgressionLedger.findOne({ relationshipId, day }).lean();
  const used = Number(current?.[field]) || 0;
  const grant = Math.max(0, Math.min(want, cap - used));
  if (grant === 0) return 0;

  const res = await ProgressionLedger.findOneAndUpdate(
    { relationshipId, day, [field]: { $lt: cap } },
    { $inc: { [field]: grant } },
    { returnDocument: 'after' }
  );
  if (!res) return 0;

  // If a concurrent writer pushed us past the cap, give back the excess.
  const after = Number(res[field]) || 0;
  if (after > cap) {
    const excess = after - cap;
    await ProgressionLedger.updateOne({ _id: res._id }, { $inc: { [field]: -excess } });
    return Math.max(0, grant - excess);
  }
  return grant;
};

/**
 * Award XP to a relationship for a named ACTION.
 *
 * Callers pass an action key (`'message'`, `'photo'`, …) and the amount is looked
 * up server-side — clients can no longer choose their own XP. A raw numeric
 * second argument is still accepted for backward compatibility with existing
 * call sites, but is clamped to the largest legitimate single award.
 *
 * Silently ignores errors so it never breaks the main request flow.
 *
 * @param {string|ObjectId} relationshipId
 * @param {string|number}   action  action key, or a legacy raw XP amount
 */
const awardXP = async (relationshipId, action) => {
  if (!relationshipId || action == null) return;

  let amount;
  if (typeof action === 'string') {
    amount = XP_ACTIONS[action];
    if (!amount) return; // unknown action — award nothing
  } else {
    // Legacy numeric call site: clamp to the largest single legitimate award.
    const maxSingle = Math.max(...Object.values(XP_ACTIONS));
    amount = Math.max(0, Math.min(Math.floor(Number(action) || 0), maxSingle));
  }
  if (amount <= 0) return;

  try {
    const granted = await claimFromLedger(relationshipId, 'xp', amount, XP_DAILY_CAP);
    if (granted <= 0) return;

    let lvl = await RelationshipLevel.findOne({ relationshipId });
    if (!lvl) lvl = await RelationshipLevel.create({ relationshipId });

    lvl.xp += granted;
    while (lvl.xp >= lvl.xpToNext) {
      lvl.xp -= lvl.xpToNext;
      lvl.level += 1;
      lvl.xpToNext = xpToNextForLevel(lvl.level);
      lvl.history.push({
        level: lvl.level,
        title: getTitle(lvl.level),
        achievedAt: new Date(),
      });
    }
    await lvl.save();
    return lvl;
  } catch (_) {}
};

module.exports = awardXP;
module.exports.claimFromLedger = claimFromLedger;
