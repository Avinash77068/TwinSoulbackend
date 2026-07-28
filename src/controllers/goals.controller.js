const Goal = require('../models/Goal');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

const CATEGORIES = ['fitness', 'travel', 'relationship', 'career', 'finance', 'learning', 'spiritual', 'fun'];

exports.getGoals = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { category } = req.query;
  const query = { relationshipId: req.user.relationshipId };
  if (category && CATEGORIES.includes(category)) query.category = category;

  const goals = await Goal.find(query).sort({ createdAt: -1 });
  res.json({ success: true, data: { goals } });
};

exports.createGoal = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { title, category, targetDate, notes, reminder } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ success: false, message: 'Title is required' });
  }
  if (!CATEGORIES.includes(category)) {
    return res.status(400).json({ success: false, message: 'Invalid category' });
  }

  const goal = await Goal.create({
    relationshipId: req.user.relationshipId,
    createdBy: req.user._id,
    title: title.trim(),
    category,
    targetDate: targetDate || null,
    notes: notes || '',
    reminder: !!reminder,
    activity: [{ text: 'Goal created', at: new Date() }],
  });

  res.status(201).json({ success: true, message: 'Goal created', data: { goal } });
};

exports.getGoal = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const goal = await Goal.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });
  res.json({ success: true, data: { goal } });
};

exports.updateGoal = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const goal = await Goal.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

  const { title, category, targetDate, notes, reminder } = req.body;
  if (title !== undefined) goal.title = title.trim();
  if (category !== undefined) {
    if (!CATEGORIES.includes(category)) return res.status(400).json({ success: false, message: 'Invalid category' });
    goal.category = category;
  }
  if (targetDate !== undefined) goal.targetDate = targetDate || null;
  if (notes !== undefined) goal.notes = notes;
  if (reminder !== undefined) goal.reminder = !!reminder;

  goal.activity.unshift({ text: 'Goal updated', at: new Date() });
  goal.activity = goal.activity.slice(0, 30);
  await goal.save();

  res.json({ success: true, message: 'Goal updated', data: { goal } });
};

exports.setProgress = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { progress } = req.body;
  if (typeof progress !== 'number' || progress < 0 || progress > 100) {
    return res.status(400).json({ success: false, message: 'Progress must be a number between 0 and 100' });
  }

  const goal = await Goal.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

  goal.progress = progress;
  goal.activity.unshift({ text: `Progress set to ${progress}%`, at: new Date() });
  goal.activity = goal.activity.slice(0, 30);
  await goal.save();

  res.json({ success: true, message: 'Progress updated', data: { goal } });
};

exports.addMilestone = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { title } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ success: false, message: 'Milestone title required' });

  const goal = await Goal.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

  goal.milestones.push({ title: title.trim(), done: false });
  goal.activity.unshift({ text: `Milestone added: ${title.trim()}`, at: new Date() });
  goal.activity = goal.activity.slice(0, 30);
  await goal.save();

  res.json({ success: true, message: 'Milestone added', data: { goal } });
};

exports.toggleMilestone = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const goal = await Goal.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });

  const milestone = goal.milestones.id(req.params.milestoneId);
  if (!milestone) return res.status(404).json({ success: false, message: 'Milestone not found' });

  milestone.done = !milestone.done;
  goal.activity.unshift({ text: `${milestone.done ? 'Completed' : 'Reopened'} milestone: ${milestone.title}`, at: new Date() });
  goal.activity = goal.activity.slice(0, 30);
  await goal.save();

  res.json({ success: true, message: 'Milestone updated', data: { goal } });
};

exports.deleteGoal = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const goal = await Goal.findOneAndDelete({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!goal) return res.status(404).json({ success: false, message: 'Goal not found' });
  res.json({ success: true, message: 'Goal deleted' });
};
