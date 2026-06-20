const MoodEntry = require('../models/MoodEntry');
const Relationship = require('../models/Relationship');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};


const SUGGESTIONS = [
  'Plan a surprise candlelight dinner at home 🕯️',
  'Write your partner a heartfelt letter 💌',
  'Create a playlist of songs that remind you of them 🎵',
  'Share a childhood memory with your partner 📸',
  'Watch the sunrise or sunset together 🌅',
  'Cook their favorite meal together 🍝',
  'Take a spontaneous road trip 🚗',
  'Start a shared bucket list 📝',
  'Give them a 10-minute massage 💆',
  'Dance together in the living room 💃',
];

const INSIGHTS = [
  'You two have been growing stronger every day! Keep it up 💪',
  'Your communication is a foundation of your relationship ❤️',
  'Small daily gestures matter more than grand ones 🌸',
  'Shared experiences create the strongest bonds 🤝',
  'Vulnerability deepens intimacy — share your fears and dreams 💭',
];

const RELATIONSHIP_TIPS = [
  'Express gratitude for something specific your partner did today',
  'Put your phone away during meals and give undivided attention',
  'Practice the 6-second kiss — it creates emotional connection',
  'Ask "What do you need from me today?" every morning',
  'Celebrate small wins together, not just milestones',
];

exports.getSuggestions = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const shuffled = [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 5);
  res.json({
    success: true,
    data: {
      suggestions: shuffled,
      source: 'ai',
      message: 'Personalized suggestions for your relationship ❤️',
    },
  });
};

exports.getInsights = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const rel = await Relationship.findById(req.user.relationshipId);
  const daysTogether = rel?.startDate
    ? Math.floor((Date.now() - new Date(rel.startDate)) / (1000 * 60 * 60 * 24))
    : 0;

  const insights = [
    `You've been together for ${daysTogether} beautiful days! ❤️`,
    ...INSIGHTS.sort(() => Math.random() - 0.5).slice(0, 2),
    ...RELATIONSHIP_TIPS.sort(() => Math.random() - 0.5).slice(0, 2),
  ];

  res.json({ success: true, data: { insights, daysTogether } });
};

exports.getReminders = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const rel = await Relationship.findById(req.user.relationshipId);
  const reminders = [];

  if (rel?.startDate) {
    const start = new Date(rel.startDate);
    const today = new Date();
    const monthAnn = new Date(today.getFullYear(), start.getMonth(), start.getDate());
    const daysUntil = Math.ceil((monthAnn - today) / (1000 * 60 * 60 * 24));
    if (daysUntil >= 0 && daysUntil <= 7) {
      reminders.push({
        type: 'anniversary',
        message: daysUntil === 0
          ? `🎉 Happy Anniversary! Today is special!`
          : `💌 Monthly anniversary in ${daysUntil} day(s)! Plan something special.`,
        daysUntil,
      });
    }
  }

  reminders.push(
    { type: 'daily', message: "Don't forget to check in on your partner's mood today 😊" },
    { type: 'tip', message: RELATIONSHIP_TIPS[Math.floor(Math.random() * RELATIONSHIP_TIPS.length)] }
  );

  res.json({ success: true, data: { reminders } });
};

exports.getMoodTrends = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const fromStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [myMoods, partnerMoods] = await Promise.all([
    MoodEntry.find({ userId: req.user._id, date: { $gte: fromStr } }).sort({ date: 1 }),
    MoodEntry.find({ userId: req.user.partnerId, date: { $gte: fromStr } }).sort({ date: 1 }),
  ]);

  const countMoods = (entries) => entries.reduce((acc, e) => {
    acc[e.mood] = (acc[e.mood] || 0) + 1;
    return acc;
  }, {});

  const myDominant = myMoods.length > 0
    ? Object.entries(countMoods(myMoods)).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  res.json({
    success: true,
    data: {
      myMoods,
      partnerMoods,
      myMoodCounts: countMoods(myMoods),
      partnerMoodCounts: countMoods(partnerMoods),
      dominantMood: myDominant,
      insight: myDominant
        ? `You've been feeling mostly ${myDominant} this month ❤️`
        : 'Start checking in daily for mood trends!',
    },
  });
};
