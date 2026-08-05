const MoodEntry = require('../models/MoodEntry');
const Relationship = require('../models/Relationship');
const Message = require('../models/Message');
const LoveTree = require('../models/LoveTree');
const {
  nextMonthlyAnniversary,
  nextYearlyAnniversary,
  daysTogether: calcDaysTogether,
} = require('../utils/anniversary');
const {
  moodCompatibility,
  dominantMood,
  countMoods,
} = require('../utils/moodCompatibility');

const requireRelationship = (req, res) => {
  if (!req.user.relationshipId) {
    res.status(400).json({ success: false, message: 'Not in a relationship' });
    return false;
  }
  return true;
};

/**
 * NOTE ON `source`
 * These endpoints are RULE-BASED, not model-generated. They used to return
 * `source: 'ai'`, which was misleading. They now return `source: 'rules'`.
 * If a real model is wired in later, switch the value then — not before.
 */
const SOURCE = 'rules';

// Suggestions are tagged so they can be selected by context rather than at random.
const SUGGESTIONS = [
  { text: 'Plan a surprise candlelight dinner at home 🕯️',            tags: ['date', 'effort'] },
  { text: 'Write your partner a heartfelt letter 💌',                   tags: ['words', 'lowEffort'] },
  { text: 'Create a playlist of songs that remind you of them 🎵',      tags: ['music'] },
  { text: 'Share a childhood memory with your partner 📸',              tags: ['words', 'lowEffort'] },
  { text: 'Watch the sunrise or sunset together 🌅',                    tags: ['date'] },
  { text: 'Cook their favorite meal together 🍝',                       tags: ['date', 'effort'] },
  { text: 'Take a spontaneous road trip 🚗',                            tags: ['date', 'effort'] },
  { text: 'Start a shared bucket list 📝',                              tags: ['goals'] },
  { text: 'Give them a 10-minute massage 💆',                           tags: ['touch'] },
  { text: 'Dance together in the living room 💃',                       tags: ['fun'] },
  { text: 'Send them a photo of where you are right now 📷',            tags: ['photo', 'lowEffort'] },
  { text: 'Ask them the one question you have never asked 💭',          tags: ['words'] },
  { text: 'Leave a voice note instead of a text today 🎙️',             tags: ['voice', 'lowEffort'] },
  { text: 'Revisit your first photo together and tell them why you love it 🖼️', tags: ['photo'] },
];

const INSIGHTS = [
  'Small daily gestures matter more than grand ones 🌸',
  'Shared experiences create the strongest bonds 🤝',
  'Vulnerability deepens intimacy — share your fears and dreams 💭',
  'Repair after conflict matters more than avoiding conflict 🩹',
  'Curiosity about your partner is a lifelong practice 🔍',
];

const RELATIONSHIP_TIPS = [
  'Express gratitude for something specific your partner did today',
  'Put your phone away during meals and give undivided attention',
  'Ask "What do you need from me today?" every morning',
  'Celebrate small wins together, not just milestones',
  'Name one thing you appreciate about them out loud',
];

/** Deterministic-per-day pick so a user does not see content reshuffle on every refresh. */
const pickForDay = (arr, count, seedStr) => {
  if (!arr.length) return [];
  let seed = 0;
  for (let i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) % 100000;
  const out = [];
  const used = new Set();
  for (let i = 0; i < Math.min(count, arr.length); i++) {
    let idx = (seed + i * 7919) % arr.length;
    while (used.has(idx)) idx = (idx + 1) % arr.length;
    used.add(idx);
    out.push(arr[idx]);
  }
  return out;
};

const todayKey = () => new Date().toISOString().slice(0, 10);

/** Gather the signals the rule engine reasons over. */
const gatherContext = async (user) => {
  const relationshipId = user.relationshipId;
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fromStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [rel, tree, messages7d, myMoods, partnerMoods] = await Promise.all([
    Relationship.findById(relationshipId).lean(),
    LoveTree.findOne({ relationshipId }).lean(),
    Message.countDocuments({ relationshipId, isDeleted: false, createdAt: { $gte: since } }),
    MoodEntry.find({ userId: user._id, date: { $gte: fromStr } }).sort({ date: 1 }).lean(),
    user.partnerId
      ? MoodEntry.find({ userId: user.partnerId, date: { $gte: fromStr } }).sort({ date: 1 }).lean()
      : Promise.resolve([]),
  ]);

  const today = todayKey();
  return {
    rel,
    tree,
    messages7d,
    myMoods,
    partnerMoods,
    myMoodToday: myMoods.find((m) => m.date === today) || null,
    partnerMoodToday: partnerMoods.find((m) => m.date === today) || null,
    daysTogether: calcDaysTogether(rel?.startDate),
  };
};

exports.getSuggestions = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const ctx = await gatherContext(req.user);

  // Context-weighted selection: prefer low-effort, warm suggestions when the
  // partner is having a hard day, and connection-building ones when the week
  // has been quiet. Falls back to the day-seeded rotation.
  let pool = SUGGESTIONS;
  const reasons = [];

  const partnerLow = ['sad', 'anxious', 'angry'].includes(ctx.partnerMoodToday?.mood);
  if (partnerLow) {
    pool = SUGGESTIONS.filter((s) => s.tags.some((t) => ['lowEffort', 'words', 'touch', 'voice'].includes(t)));
    reasons.push('your partner is having a harder day');
  } else if (ctx.messages7d < 20) {
    pool = SUGGESTIONS.filter((s) => s.tags.some((t) => ['words', 'photo', 'voice', 'lowEffort'].includes(t)));
    reasons.push('it has been a quiet week');
  }
  if (!pool.length) pool = SUGGESTIONS;

  const suggestions = pickForDay(pool, 5, `${req.user.relationshipId}:${todayKey()}`).map((s) => s.text);

  res.json({
    success: true,
    data: {
      suggestions,
      source: SOURCE,
      basedOn: reasons,
      message: reasons.length
        ? `Because ${reasons.join(' and ')} ❤️`
        : 'Ideas for the two of you ❤️',
    },
  });
};

exports.getInsights = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const ctx = await gatherContext(req.user);
  const seed = `${req.user.relationshipId}:${todayKey()}`;

  const insights = [`You've been together for ${ctx.daysTogether} beautiful days! ❤️`];

  // Real, data-derived observations first.
  const mood = moodCompatibility(ctx.myMoods, ctx.partnerMoods, 30);
  if (mood.compatibility !== null) {
    insights.push(`You've been in sync ${mood.compatibility}% of the days you both checked in 💞`);
    if (mood.trend === 'improving') insights.push('Your moods have been converging lately 📈');
    if (mood.trend === 'diverging') insights.push('Your moods have drifted a little — a check-in might help 💭');
  }
  if (ctx.tree?.points) {
    insights.push(`Your Love Tree has grown to ${ctx.tree.points} points 🌳`);
  }
  if (ctx.messages7d > 0) {
    insights.push(`${ctx.messages7d} messages between you this week 💬`);
  }

  // Then top up with curated content.
  insights.push(...pickForDay(INSIGHTS, 2, seed));
  insights.push(...pickForDay(RELATIONSHIP_TIPS, 1, seed));

  res.json({
    success: true,
    data: { insights, daysTogether: ctx.daysTogether, source: SOURCE },
  });
};

exports.getReminders = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const rel = await Relationship.findById(req.user.relationshipId).lean();
  const reminders = [];
  const seed = `${req.user.relationshipId}:${todayKey()}`;

  if (rel?.startDate) {
    // Yearly first — it outranks the monthly reminder when both are near.
    const yearly = nextYearlyAnniversary(rel.startDate);
    const monthly = nextMonthlyAnniversary(rel.startDate);

    if (yearly.daysUntil <= 14) {
      reminders.push({
        type: 'anniversary',
        scope: 'yearly',
        message: yearly.daysUntil === 0
          ? `🎉 Happy ${yearly.yearsTogether}-year anniversary! Today is special.`
          : `🎉 Your ${yearly.yearsTogether}-year anniversary is in ${yearly.daysUntil} day(s)!`,
        daysUntil: yearly.daysUntil,
        date: yearly.date,
      });
    } else if (monthly.daysUntil <= 7) {
      reminders.push({
        type: 'anniversary',
        scope: 'monthly',
        message: monthly.daysUntil === 0
          ? `💞 ${monthly.monthsTogether} months together — today!`
          : `💌 ${monthly.monthsTogether}-month anniversary in ${monthly.daysUntil} day(s)!`,
        daysUntil: monthly.daysUntil,
        date: monthly.date,
      });
    }
  }

  // Only nudge about a mood check-in if it has not happened yet today.
  const alreadyCheckedIn = await MoodEntry.exists({
    userId: req.user._id,
    date: todayKey(),
  });
  if (!alreadyCheckedIn) {
    reminders.push({ type: 'daily', message: "You haven't checked in your mood today 😊" });
  }

  reminders.push({ type: 'tip', message: pickForDay(RELATIONSHIP_TIPS, 1, seed)[0] });

  res.json({ success: true, data: { reminders, source: SOURCE } });
};

exports.getMoodTrends = async (req, res) => {
  if (!requireRelationship(req, res)) return;
  const fromStr = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [myMoods, partnerMoods] = await Promise.all([
    MoodEntry.find({ userId: req.user._id, date: { $gte: fromStr } }).sort({ date: 1 }).lean(),
    req.user.partnerId
      ? MoodEntry.find({ userId: req.user.partnerId, date: { $gte: fromStr } }).sort({ date: 1 }).lean()
      : Promise.resolve([]),
  ]);

  const myDominant = dominantMood(myMoods);
  // Previously never computed — the comparison was one-sided.
  const partnerDominant = dominantMood(partnerMoods);
  const compat = moodCompatibility(myMoods, partnerMoods, 30);

  let insight;
  if (!myDominant) {
    insight = 'Start checking in daily for mood trends!';
  } else if (partnerDominant && compat.compatibility !== null) {
    insight = `You've mostly felt ${myDominant}; your partner has mostly felt ${partnerDominant}. In sync ${compat.compatibility}% of shared days.`;
  } else {
    insight = `You've been feeling mostly ${myDominant} this month ❤️`;
  }

  res.json({
    success: true,
    data: {
      myMoods,
      partnerMoods,
      myMoodCounts: countMoods(myMoods),
      partnerMoodCounts: countMoods(partnerMoods),
      dominantMood: myDominant,
      partnerDominantMood: partnerDominant,
      compatibility: compat,
      insight,
      source: SOURCE,
    },
  });
};
