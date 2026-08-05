const Relationship = require('../models/Relationship');
const RelationshipStats = require('../models/RelationshipStats');
const Message = require('../models/Message');
const Photo = require('../models/Photo');
const Album = require('../models/Album');
const Diary = require('../models/Diary');
const TimeCapsule = require('../models/TimeCapsule');
const TimelineEvent = require('../models/TimelineEvent');
const Goal = require('../models/Goal');
const MiniGame = require('../models/MiniGame');
const MoodEntry = require('../models/MoodEntry');
const LoveTree = require('../models/LoveTree');
const RelationshipLevel = require('../models/RelationshipLevel');
const CallLog = require('../models/CallLog');
const { getTitle } = require('../constants/progression');
const { daysTogether: calcDaysTogether } = require('../utils/anniversary');
const { moodCompatibility, dominantMood } = require('../utils/moodCompatibility');

const DAY_MS = 24 * 60 * 60 * 1000;
/** Recompute if the cached rollup is older than this. */
const STALE_AFTER_MS = 15 * 60 * 1000;

const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

/**
 * Daily shared-activity streak.
 *
 * A day counts when the couple did something together: a message, a photo, a
 * diary entry, or BOTH partners checking in their mood. Walks backwards from
 * today; today not yet being active does not break the streak (yesterday anchors it).
 */
const computeStreak = async (relationshipId, windowDays = 400) => {
  const since = new Date(Date.now() - windowDays * DAY_MS);

  const [msgDays, photoDays, diaryDays, moods] = await Promise.all([
    Message.distinct('createdAt', { relationshipId, isDeleted: false, createdAt: { $gte: since } }),
    Photo.distinct('createdAt', { relationshipId, isDeleted: false, createdAt: { $gte: since } }),
    Diary.distinct('createdAt', { relationshipId, createdAt: { $gte: since } }),
    MoodEntry.find({ relationshipId, date: { $gte: dayKey(since) } }).select('userId date').lean(),
  ]);

  const active = new Set();
  [...msgDays, ...photoDays, ...diaryDays].forEach((d) => active.add(dayKey(d)));

  // Both partners checking in on the same day also counts.
  const byDate = {};
  moods.forEach((m) => {
    byDate[m.date] = byDate[m.date] || new Set();
    byDate[m.date].add(String(m.userId));
  });
  Object.entries(byDate).forEach(([date, users]) => {
    if (users.size >= 2) active.add(date);
  });

  if (active.size === 0) {
    return { current: 0, longest: 0, lastActiveDate: null };
  }

  const sorted = [...active].sort();
  const lastActiveDate = sorted[sorted.length - 1];

  // Longest run of consecutive days.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(sorted[i - 1] + 'T00:00:00Z').getTime();
    const cur = new Date(sorted[i] + 'T00:00:00Z').getTime();
    if (cur - prev === DAY_MS) {
      run += 1;
      longest = Math.max(longest, run);
    } else {
      run = 1;
    }
  }

  // Current streak: walk back from today, tolerating an inactive today.
  let current = 0;
  const todayKey = dayKey(new Date());
  let cursor = active.has(todayKey) ? new Date() : new Date(Date.now() - DAY_MS);
  while (active.has(dayKey(cursor))) {
    current += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }

  return { current, longest, lastActiveDate };
};

/**
 * Weekly Relationship Score.
 *
 * Deliberately framed as "this week's rhythm", never as relationship quality.
 * Each component is capped so no single behaviour can dominate, and the score is
 * never used to drive a guilt notification.
 */
const computeWeeklyScore = ({ messages7d, callSeconds7d, bothCheckedInDays, sharedMoments7d, goalsProgressed7d, moodAlignment }) => {
  const clamp01 = (n) => Math.max(0, Math.min(1, n));

  // Communication: ~150 messages or ~60 min of calls in a week reads as healthy.
  const communication = clamp01((messages7d / 150) * 0.6 + (callSeconds7d / 3600) * 0.4);
  // Presence: both partners checking in, out of 7 days.
  const presence = clamp01(bothCheckedInDays / 7);
  // Shared moments: photos, diary, music, watch-together.
  const shared = clamp01(sharedMoments7d / 7);
  // Growth: goals touched this week.
  const growth = clamp01(goalsProgressed7d / 3);
  // Mood sync: 0..1 alignment, neutral 0.5 when there is no data.
  const sync = moodAlignment == null ? 0.5 : clamp01(moodAlignment);

  const breakdown = {
    communication: Math.round(communication * 30),
    presence:      Math.round(presence * 20),
    sharedMoments: Math.round(shared * 20),
    growth:        Math.round(growth * 15),
    moodSync:      Math.round(sync * 15),
  };
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  return { score, breakdown };
};

/** Recompute and persist the rollup for one relationship. */
const computeStats = async (relationshipId) => {
  const rel = await Relationship.findById(relationshipId).lean();
  if (!rel) return null;

  const now = Date.now();
  const d7 = new Date(now - 7 * DAY_MS);
  const d30 = new Date(now - 30 * DAY_MS);
  const moodFrom = dayKey(d30);

  const [
    msgTotal, msg7d, msg30d,
    photoTotal, photo30d, albumCount,
    diaryCount, capsuleCount, timelineCount,
    goals, gamesPlayed,
    tree, level,
    callAgg, calls7d,
    moods,
    streaks,
  ] = await Promise.all([
    Message.countDocuments({ relationshipId, isDeleted: false }),
    Message.countDocuments({ relationshipId, isDeleted: false, createdAt: { $gte: d7 } }),
    Message.countDocuments({ relationshipId, isDeleted: false, createdAt: { $gte: d30 } }),

    Photo.countDocuments({ relationshipId, isDeleted: false }),
    Photo.countDocuments({ relationshipId, isDeleted: false, createdAt: { $gte: d30 } }),
    Album.countDocuments({ relationshipId }),

    Diary.countDocuments({ relationshipId }),
    TimeCapsule.countDocuments({ relationshipId }),
    TimelineEvent.countDocuments({ relationshipId, isDeleted: false }),

    Goal.find({ relationshipId }).select('progress updatedAt').lean(),
    MiniGame.countDocuments({ relationshipId, status: 'completed' }),

    LoveTree.findOne({ relationshipId }).lean(),
    RelationshipLevel.findOne({ relationshipId }).lean(),

    CallLog.aggregate([
      { $match: { relationshipId: rel._id, outcome: 'completed' } },
      { $group: {
        _id: null,
        count: { $sum: 1 },
        totalSeconds: { $sum: '$durationSeconds' },
        longestSeconds: { $max: '$durationSeconds' },
      } },
    ]),
    CallLog.aggregate([
      { $match: { relationshipId: rel._id, outcome: 'completed', createdAt: { $gte: d7 } } },
      { $group: { _id: null, count: { $sum: 1 }, totalSeconds: { $sum: '$durationSeconds' } } },
    ]),

    MoodEntry.find({ relationshipId, date: { $gte: moodFrom } }).select('userId mood date').lean(),
    computeStreak(relationshipId),
  ]);

  const callTotals = callAgg[0] || { count: 0, totalSeconds: 0, longestSeconds: 0 };
  const call7 = calls7d[0] || { count: 0, totalSeconds: 0 };

  const completedGoals = goals.filter((g) => (g.progress || 0) >= 100).length;
  const goalsProgressed7d = goals.filter((g) => g.updatedAt && new Date(g.updatedAt) >= d7).length;

  const u1 = String(rel.user1);
  const u2 = rel.user2 ? String(rel.user2) : null;
  const u1Moods = moods.filter((m) => String(m.userId) === u1);
  const u2Moods = u2 ? moods.filter((m) => String(m.userId) === u2) : [];
  const compat = moodCompatibility(u1Moods, u2Moods, 30);

  // Days in the last 7 where BOTH partners checked in.
  const recentByDate = {};
  moods
    .filter((m) => m.date >= dayKey(d7))
    .forEach((m) => {
      recentByDate[m.date] = recentByDate[m.date] || new Set();
      recentByDate[m.date].add(String(m.userId));
    });
  const bothCheckedInDays = Object.values(recentByDate).filter((s) => s.size >= 2).length;

  const photos7d = await Photo.countDocuments({
    relationshipId, isDeleted: false, createdAt: { $gte: d7 },
  });
  const diary7d = await Diary.countDocuments({ relationshipId, createdAt: { $gte: d7 } });

  const weekly = computeWeeklyScore({
    messages7d: msg7d,
    callSeconds7d: call7.totalSeconds,
    bothCheckedInDays,
    sharedMoments7d: photos7d + diary7d,
    goalsProgressed7d,
    moodAlignment: compat.alignment,
  });

  const prev = await RelationshipStats.findOne({ relationshipId }).select('weeklyScore').lean();
  const prevScore = prev?.weeklyScore?.score ?? null;
  const trend = prevScore == null
    ? null
    : weekly.score > prevScore + 3 ? 'up'
    : weekly.score < prevScore - 3 ? 'down'
    : 'steady';

  const payload = {
    relationshipId,
    daysTogether: calcDaysTogether(rel.startDate || rel.createdAt),
    messages: { total: msgTotal, last7d: msg7d, last30d: msg30d },
    calls: {
      count: callTotals.count,
      totalSeconds: callTotals.totalSeconds || 0,
      longestSeconds: callTotals.longestSeconds || 0,
      last7d: call7.count,
    },
    photos: { total: photoTotal, albums: albumCount, last30d: photo30d },
    memories: { diaryEntries: diaryCount, capsules: capsuleCount, timelineEvents: timelineCount },
    goals: {
      active: goals.length - completedGoals,
      completed: completedGoals,
      completionRate: goals.length ? Math.round((completedGoals / goals.length) * 100) : 0,
    },
    games: { played: gamesPlayed },
    loveTree: { points: tree?.points || 0, stage: tree?.stage || 'seed' },
    level: {
      level: level?.level || 1,
      xp: level?.xp || 0,
      title: getTitle(level?.level || 1),
    },
    mood: {
      compatibility: compat.compatibility,
      trend: compat.trend,
      overlappingDays: compat.overlappingDays,
      dominantUser1: dominantMood(u1Moods),
      dominantUser2: dominantMood(u2Moods),
    },
    streaks,
    weeklyScore: { score: weekly.score, breakdown: weekly.breakdown, trend },
    computedAt: new Date(),
  };

  return RelationshipStats.findOneAndUpdate(
    { relationshipId },
    payload,
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
};

/** Cached read; recomputes when stale or missing. */
const getStats = async (relationshipId, { force = false } = {}) => {
  const existing = await RelationshipStats.findOne({ relationshipId });
  if (!force && existing && Date.now() - new Date(existing.computedAt).getTime() < STALE_AFTER_MS) {
    return existing;
  }
  try {
    return (await computeStats(relationshipId)) || existing;
  } catch (err) {
    console.error('[Stats] compute failed:', err.message);
    return existing; // serve stale rather than failing the dashboard
  }
};

module.exports = { computeStats, getStats, computeStreak, computeWeeklyScore, STALE_AFTER_MS };
