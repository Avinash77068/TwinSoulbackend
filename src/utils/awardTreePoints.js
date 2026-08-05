const LoveTree = require('../models/LoveTree');
const { claimFromLedger } = require('./awardXP');
const {
  TREE_ACTIONS,
  TREE_DAILY_CAPS,
  resolveStage,
} = require('../constants/progression');

/**
 * Award Love Tree points to a relationship for a named ACTION.
 *
 * Point values come from constants/progression.js — never from the client.
 * Daily per-category caps are enforced via ProgressionLedger, so spamming an
 * award path can no longer fast-track the tree to Legendary.
 *
 * Silently ignores errors so it never breaks the main request flow.
 *
 * @param {string|ObjectId} relationshipId
 * @param {string} action  one of the keys in TREE_ACTIONS
 * @returns {Promise<{tree, granted, stageChanged, stage}|undefined>}
 */
const awardTreePoints = async (relationshipId, action) => {
  if (!relationshipId) return;

  const spec = TREE_ACTIONS[action];
  if (!spec) return; // unknown action — award nothing

  try {
    const cap = TREE_DAILY_CAPS[spec.category] ?? 0;
    const granted = await claimFromLedger(relationshipId, spec.category, spec.points, cap);
    if (granted <= 0) return;

    let tree = await LoveTree.findOne({ relationshipId });
    if (!tree) tree = await LoveTree.create({ relationshipId });

    // Heal legacy documents that may be missing numeric fields.
    const before = tree.stage;
    tree[spec.category] = (Number(tree[spec.category]) || 0) + granted;
    tree.points = (Number(tree.points) || 0) + granted;
    tree.lastWatered = new Date();
    tree.stage = resolveStage(tree.points);
    await tree.save();

    return {
      tree,
      granted,
      stage: tree.stage,
      stageChanged: before !== tree.stage,
    };
  } catch (_) {}
};

module.exports = awardTreePoints;
