const RelationshipLevel = require('../models/RelationshipLevel');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

const LEVEL_TITLES = {
  1: 'New Sparks ✨', 5: 'Close Hearts ❤️', 10: 'Soulmates 💞',
  25: 'Forever Partners 👑', 50: 'Legendary Couple 🌟',
};

const getTitle = (level) => {
  const keys = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const k of keys) if (level >= k) return LEVEL_TITLES[k];
  return LEVEL_TITLES[1];
};

exports.getLevel = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  let lvl = await RelationshipLevel.findOne({ relationshipId: req.user.relationshipId });
  if (!lvl) lvl = await RelationshipLevel.create({ relationshipId: req.user.relationshipId });

  res.json({
    success: true,
    data: {
      level: lvl.level,
      xp: lvl.xp,
      xpToNext: lvl.xpToNext,
      title: getTitle(lvl.level),
      progressPercent: Math.round((lvl.xp / lvl.xpToNext) * 100),
      history: lvl.history,
    },
  });
};

exports.addXP = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { xp = 10 } = req.body;

  let lvl = await RelationshipLevel.findOne({ relationshipId: req.user.relationshipId });
  if (!lvl) lvl = await RelationshipLevel.create({ relationshipId: req.user.relationshipId });

  lvl.xp += xp;
  while (lvl.xp >= lvl.xpToNext) {
    lvl.xp -= lvl.xpToNext;
    lvl.level += 1;
    lvl.xpToNext = Math.floor(100 * Math.pow(1.2, lvl.level - 1));
    lvl.history.push({ level: lvl.level, title: getTitle(lvl.level), achievedAt: new Date() });
  }
  await lvl.save();

  res.json({ success: true, message: 'XP added', data: { level: lvl.level, xp: lvl.xp, xpToNext: lvl.xpToNext, title: getTitle(lvl.level) } });
};
