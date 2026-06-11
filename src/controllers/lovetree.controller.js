const LoveTree = require('../models/LoveTree');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

const STAGES = [
  { name: 'seed', min: 0, label: 'Tiny Seed 🌱', nextAt: 50 },
  { name: 'plant', min: 50, label: 'Growing Plant 🌿', nextAt: 200 },
  { name: 'tree', min: 200, label: 'Young Tree 🌳', nextAt: 500 },
  { name: 'blooming', min: 500, label: 'Blooming Tree 🌸', nextAt: 1000 },
  { name: 'golden', min: 1000, label: 'Golden Tree 🌟', nextAt: 2000 },
  { name: 'legendary', min: 2000, label: 'Legendary Tree 👑', nextAt: null },
];

exports.getTree = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  let tree = await LoveTree.findOne({ relationshipId: req.user.relationshipId });
  if (!tree) tree = await LoveTree.create({ relationshipId: req.user.relationshipId });

  const currentStage = STAGES.find(s => s.name === tree.stage) || STAGES[0];
  const nextStage = currentStage.nextAt
    ? STAGES.find(s => s.min === currentStage.nextAt)
    : null;
  const progress = nextStage
    ? Math.round(((tree.points - currentStage.min) / (currentStage.nextAt - currentStage.min)) * 100)
    : 100;

  res.json({
    success: true,
    data: {
      tree,
      stageInfo: {
        current: currentStage,
        next: nextStage,
        progressPercent: Math.min(progress, 100),
      },
    },
  });
};

exports.addPoints = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { points = 1, category = 'chatPoints' } = req.body;
  const allowed = ['chatPoints', 'photoPoints', 'diaryPoints', 'musicPoints', 'checkinPoints'];
  if (!allowed.includes(category)) {
    return res.status(400).json({ success: false, message: `Category must be one of: ${allowed.join(', ')}` });
  }

  let tree = await LoveTree.findOne({ relationshipId: req.user.relationshipId });
  if (!tree) tree = await LoveTree.create({ relationshipId: req.user.relationshipId });

  tree[category] += points;
  tree.points += points;
  tree.lastWatered = new Date();
  const stage = STAGES.filter(s => tree.points >= s.min).pop();
  tree.stage = stage.name;
  await tree.save();

  res.json({ success: true, message: 'Love tree watered 🌱', data: { tree } });
};
