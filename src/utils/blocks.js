/**
 * Block lookups, shared by partner discovery and couple-code connect.
 *
 * The `Block` model does not exist yet — the BlockedUsers screen in the app is
 * currently UI only — so every helper here degrades to "no blocks" rather than
 * throwing. That keeps connect/search working today and means these call sites
 * start enforcing blocks the moment models/Block.js lands, with no further edits.
 *
 * Expected shape when it is added:
 *   { blockerId: ObjectId, blockedId: ObjectId, createdAt: Date }
 */

const loadBlockModel = () => {
  try {
    return require('../models/Block');
  } catch {
    return null;
  }
};

/** User ids to exclude because of a block in EITHER direction. */
const getBlockedIds = async (userId) => {
  const Block = loadBlockModel();
  if (!Block) return [];
  try {
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

/**
 * True when either user has blocked the other.
 * Checked in both directions on purpose: a blocked user must not be able to reach
 * the blocker, and the blocker should not accidentally reach them either.
 */
const isBlockedBetween = async (a, b) => {
  const Block = loadBlockModel();
  if (!Block) return false;
  try {
    const hit = await Block.exists({
      $or: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    });
    return !!hit;
  } catch {
    return false;
  }
};

module.exports = { getBlockedIds, isBlockedBetween };
