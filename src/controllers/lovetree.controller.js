const LoveTree = require('../models/LoveTree');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

const STAGES = [
  { name: 'seed',      min: 0,    label: 'Tiny Seed 🌱',       nextAt: 50   },
  { name: 'plant',     min: 50,   label: 'Growing Plant 🌿',   nextAt: 200  },
  { name: 'tree',      min: 200,  label: 'Young Tree 🌳',      nextAt: 500  },
  { name: 'blooming',  min: 500,  label: 'Blooming Tree 🌸',   nextAt: 1000 },
  { name: 'golden',    min: 1000, label: 'Golden Tree 🌟',     nextAt: 2000 },
  { name: 'legendary', min: 2000, label: 'Legendary Tree 👑',  nextAt: null },
];

// Derive stage name from current point total — always returns a valid stage
const resolveStage = (points) => {
  const pts = Number(points) || 0;
  return (STAGES.filter(s => pts >= s.min).pop() || STAGES[0]).name;
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

  const currentStage = STAGES.find(s => s.name === tree.stage) || STAGES[0];
  const nextStage    = currentStage.nextAt
    ? STAGES.find(s => s.min === currentStage.nextAt) || null
    : null;
  const progress = nextStage
    ? Math.min(
        100,
        Math.round(
          ((tree.points - currentStage.min) /
           (currentStage.nextAt - currentStage.min)) * 100
        )
      )
    : 100;

  res.json({
    success: true,
    data: {
      tree,
      stageInfo: {
        current: currentStage,
        next: nextStage,
        progressPercent: isNaN(progress) ? 0 : progress,
      },
    },
  });
};

exports.addPoints = async (req, res) => {
  if (!requireRelationship(req, res)) return;

  // Bug fix: req.body is undefined when no body is sent (e.g. curl without -d)
  const body = req.body || {};
  const { points = 1, category = 'chatPoints' } = body;

  const allowed = ['chatPoints', 'photoPoints', 'diaryPoints', 'musicPoints', 'checkinPoints'];
  if (!allowed.includes(category)) {
    return res.status(400).json({
      success: false,
      message: `Category must be one of: ${allowed.join(', ')}`,
    });
  }

  let tree = await LoveTree.findOne({ relationshipId: req.user.relationshipId });
  if (!tree) tree = await LoveTree.create({ relationshipId: req.user.relationshipId });

  // Heal legacy documents that may be missing numeric fields
  tree[category] = (Number(tree[category]) || 0) + Number(points);
  tree.points    = (Number(tree.points)    || 0) + Number(points);
  tree.lastWatered = new Date();

  // Bug fix: always resolve to a valid stage — never crash on NaN/empty filter
  tree.stage = resolveStage(tree.points);

  await tree.save();

  res.json({
    success: true,
    message: 'Love tree watered 🌱',
    data: { tree },
  });
};
