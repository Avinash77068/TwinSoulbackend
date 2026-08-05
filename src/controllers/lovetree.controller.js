const LoveTree = require('../models/LoveTree');
const awardTreePoints = require('../utils/awardTreePoints');
const {
  TREE_STAGES,
  TREE_ACTIONS,
  resolveStageInfo,
} = require('../constants/progression');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

exports.getTree = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  let tree = await LoveTree.findOne({ relationshipId: req.user.relationshipId });
  if (!tree) tree = await LoveTree.create({ relationshipId: req.user.relationshipId });

  // Heal any legacy document that is missing the points field
  if (tree.points == null || isNaN(tree.points)) {
    tree.points = 0;
    tree.stage = 'seed';
    await tree.save();
  }

  const { current, next, progressPercent } = resolveStageInfo(tree.points);

  res.json({
    success: true,
    data: {
      tree,
      // Ship the full ladder so the app renders labels from the server's table
      // instead of its own (previously divergent) copy.
      stages: TREE_STAGES,
      stageInfo: { current, next, progressPercent },
    },
  });
};

/**
 * POST /lovetree/water
 *
 * Body: { action?: string }  — e.g. 'water' (default), 'message', 'photo', …
 *
 * The client names an ACTION; the server decides the point value and enforces a
 * daily cap. Previously this endpoint accepted arbitrary `points` and `category`
 * with no cap or rate limit, making all Love Tree progress forgeable.
 */
exports.addPoints = async (req, res) => {
  if (!requireRelationship(req, res)) return;

  const body = req.body || {};
  const action = body.action || 'water';

  if (!TREE_ACTIONS[action]) {
    return res.status(400).json({
      success: false,
      message: `action must be one of: ${Object.keys(TREE_ACTIONS).join(', ')}`,
    });
  }

  const result = await awardTreePoints(req.user.relationshipId, action);

  if (!result) {
    // Cap reached for today — not an error, just nothing to give.
    const tree = await LoveTree.findOne({ relationshipId: req.user.relationshipId });
    const info = resolveStageInfo(tree?.points);
    return res.json({
      success: true,
      message: "That's all the growth for today 🌙",
      data: { tree, stages: TREE_STAGES, stageInfo: info, granted: 0, capReached: true },
    });
  }

  const info = resolveStageInfo(result.tree.points);
  res.json({
    success: true,
    message: result.stageChanged ? `Your tree grew into ${info.current.label}! 🌳` : 'Love tree watered 🌱',
    data: {
      tree: result.tree,
      stages: TREE_STAGES,
      stageInfo: info,
      granted: result.granted,
      stageChanged: result.stageChanged,
      capReached: false,
    },
  });
};
