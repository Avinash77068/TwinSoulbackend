const RelationshipLevel = require('../models/RelationshipLevel');

const LEVEL_TITLES = {
  1: 'New Sparks ✨', 5: 'Close Hearts ❤️', 10: 'Soulmates 💞',
  25: 'Forever Partners 👑', 50: 'Legendary Couple 🌟',
};
const getTitle = (level) => {
  const keys = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const k of keys) if (level >= k) return LEVEL_TITLES[k];
  return LEVEL_TITLES[1];
};

/**
 * Award XP to a relationship. Silently ignores errors so it never breaks the main flow.
 * @param {string|ObjectId} relationshipId
 * @param {number} xp
 */
const awardXP = async (relationshipId, xp) => {
  if (!relationshipId || !xp) return;
  try {
    let lvl = await RelationshipLevel.findOne({ relationshipId });
    if (!lvl) lvl = await RelationshipLevel.create({ relationshipId });

    lvl.xp += xp;
    while (lvl.xp >= lvl.xpToNext) {
      lvl.xp -= lvl.xpToNext;
      lvl.level += 1;
      lvl.xpToNext = Math.floor(100 * Math.pow(1.2, lvl.level - 1));
      lvl.history.push({ level: lvl.level, title: getTitle(lvl.level), achievedAt: new Date() });
    }
    await lvl.save();
  } catch (_) {}
};

module.exports = awardXP;
