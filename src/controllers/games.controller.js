const MiniGame            = require('../models/MiniGame');
const WheelConfig         = require('../models/WheelConfig');
const Presence            = require('../models/Presence');
const User                = require('../models/User');
const sendPushNotification = require('../utils/sendPushNotification');
const { getIo }           = require('../config/socketInstance');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

// ─── Default data ─────────────────────────────────────────────────────────────

const DEFAULT_WHEEL_ACTIVITIES = [
  '🎬 Movie night',
  '🍳 Cook dinner together',
  '💌 Write love notes',
  '🚶 Evening walk',
  '🎮 Play a game',
  '📷 Photo session',
  '💆 Pamper each other',
  '🌟 Stargazing night',
  '🎵 Dance together',
  '📚 Read to each other',
];

const GAME_QUESTIONS = {
  truth_dare: [
    { question: 'Truth: What is your biggest fear?', type: 'truth' },
    { question: 'Dare: Send a funny selfie right now!', type: 'dare' },
    { question: 'Truth: What do you love most about me?', type: 'truth' },
    { question: 'Dare: Write a love poem in 30 seconds!', type: 'dare' },
  ],
  who_knows_better: [
    { question: "What is my favorite food?", correctAnswer: '' },
    { question: "What is my biggest dream?", correctAnswer: '' },
    { question: "What is my favorite movie?", correctAnswer: '' },
    { question: "What makes me happiest?", correctAnswer: '' },
  ],
  this_or_that: [
    { question: 'Beach or Mountains?', optionA: 'Beach', optionB: 'Mountains' },
    { question: 'Morning person or Night owl?', optionA: 'Morning', optionB: 'Night owl' },
    { question: 'Netflix night or Dinner date?', optionA: 'Netflix', optionB: 'Dinner date' },
  ],
  love_quiz: [
    { question: 'How did we first meet?', type: 'open' },
    { question: "What was our first date like?", type: 'open' },
    { question: 'What is our song?', type: 'open' },
  ],
};

// ─── Existing game controllers ─────────────────────────────────────────────────

exports.getGames = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const games = await MiniGame.find({ relationshipId: req.user.relationshipId })
    .sort({ createdAt: -1 }).limit(20);
  const available = [
    { type: 'truth_dare',       name: 'Truth & Dare',     emoji: '🎯' },
    { type: 'who_knows_better', name: 'Who Knows Better', emoji: '💡' },
    { type: 'this_or_that',     name: 'This Or That',     emoji: '🤔' },
    { type: 'love_quiz',        name: 'Love Quiz',        emoji: '💕' },
    { type: 'memory_challenge', name: 'Memory Challenge', emoji: '🧠' },
    { type: 'spin_wheel',       name: 'Spin The Wheel',   emoji: '🎡' },
  ];
  res.json({ success: true, data: { available, recentGames: games } });
};

exports.startGame = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { gameType } = req.body;
  const valid = ['truth_dare', 'who_knows_better', 'this_or_that', 'love_quiz', 'memory_challenge', 'spin_wheel'];
  if (!valid.includes(gameType)) {
    return res.status(400).json({ success: false, message: 'Invalid game type' });
  }

  const questions     = GAME_QUESTIONS[gameType] || [];
  const firstQuestion = Array.isArray(questions) ? questions[0] : null;

  const game = await MiniGame.create({
    relationshipId: req.user.relationshipId,
    gameType,
    status: 'active',
    rounds: firstQuestion
      ? [{ question: typeof firstQuestion === 'string' ? firstQuestion : firstQuestion.question }]
      : [],
  });

  res.status(201).json({
    success: true,
    message: 'Game started! Have fun! 🎮',
    data: { gameId: game._id, game, firstQuestion, allQuestions: questions },
  });
};

exports.submitAnswer = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { answer } = req.body;
  if (!answer) return res.status(400).json({ success: false, message: 'Answer required' });

  const game = await MiniGame.findOne({
    _id: req.params.id,
    relationshipId: req.user.relationshipId,
    status: 'active',
  });
  if (!game) return res.status(404).json({ success: false, message: 'Game not found or not active' });

  const currentRound = game.rounds[game.rounds.length - 1];
  if (!currentRound) return res.status(400).json({ success: false, message: 'No active round' });

  const questions = GAME_QUESTIONS[game.gameType] || [];
  const userId    = req.user._id.toString();
  const rel       = await require('../models/Relationship').findById(game.relationshipId);
  const isUser1   = rel.user1.toString() === userId;

  if (isUser1) currentRound.user1Answer = answer;
  else currentRound.user2Answer = answer;

  if (currentRound.user1Answer && currentRound.user2Answer) {
    const nextIdx = game.rounds.length;
    if (nextIdx < questions.length) {
      const nextQ = questions[nextIdx];
      game.rounds.push({ question: typeof nextQ === 'string' ? nextQ : nextQ.question });
      game.currentRound = game.rounds.length;
    } else {
      game.status = 'completed';
    }
  }
  await game.save();
  res.json({ success: true, message: 'Answer submitted', data: { game } });
};

exports.getGameResult = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const game = await MiniGame.findOne({ _id: req.params.id, relationshipId: req.user.relationshipId });
  if (!game) return res.status(404).json({ success: false, message: 'Game not found' });
  res.json({ success: true, data: { game } });
};

// ─── Spin wheel (legacy single-result endpoint) ────────────────────────────────

exports.spinWheel = async (req, res) => {
  try {
    let activities = DEFAULT_WHEEL_ACTIVITIES;
    if (req.user?.relationshipId) {
      const config = await WheelConfig.findOne({ relationshipId: req.user.relationshipId });
      if (config?.activities?.length) activities = config.activities;
    }
    const result = activities[Math.floor(Math.random() * activities.length)];
    res.json({ success: true, data: { challenge: result } });
  } catch {
    const fallback = DEFAULT_WHEEL_ACTIVITIES;
    res.json({ success: true, data: { challenge: fallback[Math.floor(Math.random() * fallback.length)] } });
  }
};

// ─── Wheel activities CRUD ─────────────────────────────────────────────────────

exports.getWheelActivities = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  try {
    const config   = await WheelConfig.findOne({ relationshipId: req.user.relationshipId });
    const isCustom = !!(config?.activities?.length);
    const activities = isCustom ? config.activities : DEFAULT_WHEEL_ACTIVITIES;
    res.json({ success: true, data: { activities, isCustom } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch activities' });
  }
};

exports.saveWheelActivities = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const { activities } = req.body;
  if (!Array.isArray(activities)) {
    return res.status(400).json({ success: false, message: 'Activities must be an array' });
  }
  const cleaned = activities.map(a => String(a).trim()).filter(Boolean);
  if (cleaned.length < 2 || cleaned.length > 12) {
    return res.status(400).json({ success: false, message: 'Must have 2–12 activities' });
  }
  try {
    const config = await WheelConfig.findOneAndUpdate(
      { relationshipId: req.user.relationshipId },
      { activities: cleaned },
      { upsert: true, new: true },
    );
    res.json({ success: true, message: 'Activities saved!', data: { activities: config.activities, isCustom: true } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to save activities' });
  }
};

exports.resetWheelActivities = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  try {
    await WheelConfig.findOneAndDelete({ relationshipId: req.user.relationshipId });
    res.json({ success: true, message: 'Reset to defaults', data: { activities: DEFAULT_WHEEL_ACTIVITIES, isCustom: false } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to reset' });
  }
};

exports.spinWheelActivity = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  try {
    const config     = await WheelConfig.findOne({ relationshipId: req.user.relationshipId });
    const activities = config?.activities?.length ? config.activities : DEFAULT_WHEEL_ACTIVITIES;
    const index      = Math.floor(Math.random() * activities.length);
    const result     = activities[index];

    const spinnerName = req.user.nickname || req.user.name || 'Partner';
    const partnerId   = req.user.partnerId;

    const payload = {
      result,
      index,
      activities,
      spinnerName,
      spinnerId: String(req.user._id),
      spunAt:    new Date().toISOString(),
    };

    // ── Real-time socket notification to partner ──────────────────────────────
    const io = getIo();
    if (io && partnerId) {
      io.to(`user:${partnerId}`).emit('game:wheel_spin', payload);
    }

    // ── FCM push if partner is offline ────────────────────────────────────────
    if (partnerId) {
      try {
        const presence = await Presence.findOne({ userId: partnerId });
        if (!presence?.isOnline) {
          const partner = await User.findById(partnerId).select('fcmToken');
          if (partner?.fcmToken) {
            await sendPushNotification({
              fcmToken: partner.fcmToken,
              title:    `🎡 ${spinnerName}`,
              body:     `Wheel spun — "${result}" aaya!`,
              data:     { type: 'wheel_spin', relationshipId: String(req.user.relationshipId) },
            });
          }
        }
      } catch (err) {
        console.error('[Wheel] FCM failed:', err.message);
      }
    }

    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to spin' });
  }
};
