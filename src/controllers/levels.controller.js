const RelationshipLevel = require('../models/RelationshipLevel');
const awardXP = require('../utils/awardXP');
const { getTitle, XP_ACTIONS, LEVEL_TITLES } = require('../constants/progression');
const { invalidate } = require('../cache/cacheMiddleware');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

/** Core level data fetch, shared by GET /levels and the Home bootstrap aggregator. */
const fetchLevelData = async (req) => {
  let lvl = await RelationshipLevel.findOne({ relationshipId: req.user.relationshipId });
  if (!lvl) lvl = await RelationshipLevel.create({ relationshipId: req.user.relationshipId });

  return {
    level: lvl.level,
    xp: lvl.xp,
    xpToNext: lvl.xpToNext,
    title: getTitle(lvl.level),
    progressPercent: lvl.xpToNext > 0
      ? Math.max(0, Math.min(100, Math.round((lvl.xp / lvl.xpToNext) * 100)))
      : 0,
    history: lvl.history,
    titles: LEVEL_TITLES,
  };
};

exports.getLevel = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const data = await fetchLevelData(req);
  res.json({ success: true, data });
};

exports.fetchLevelData = fetchLevelData;

/**
 * POST /levels/add-xp
 *
 * Body: { action: string }  — one of XP_ACTIONS
 *
 * The client names an ACTION; the server decides the XP value and enforces a
 * daily cap. Previously this accepted an arbitrary client `xp` value, so any
 * level could be reached with a single crafted request.
 */
exports.addXP = async (req, res) => {
  if (!requireRelationship(req, res)) return;

  const body = req.body || {};
  const { action } = body;

  if (!action || !XP_ACTIONS[action]) {
    return res.status(400).json({
      success: false,
      message: `action must be one of: ${Object.keys(XP_ACTIONS).join(', ')}`,
    });
  }

  await awardXP(req.user.relationshipId, action);
  await invalidate('levels', req.user._id);

  const lvl = await RelationshipLevel.findOne({ relationshipId: req.user.relationshipId });
  res.json({
    success: true,
    message: 'XP added',
    data: {
      level: lvl.level,
      xp: lvl.xp,
      xpToNext: lvl.xpToNext,
      title: getTitle(lvl.level),
    },
  });
};
