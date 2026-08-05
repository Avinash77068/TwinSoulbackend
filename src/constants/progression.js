/**
 * Single source of truth for all relationship progression mechanics.
 *
 * Previously these values were duplicated across five files and had DIVERGED:
 *   - LEVEL_TITLES existed in RelationshipLevel.js, levels.controller.js and utils/awardXP.js
 *   - Love Tree stage thresholds existed in lovetree.controller.js (STAGES) AND
 *     chat.controller.js (CHAT_STAGES) AND the RN app (TREE_STAGES)
 *   - The RN app used thresholds 0/3/7/15/30/60 while the server used
 *     0/50/200/500/1000/2000, so users saw the wrong stage and wrong progress.
 *
 * The server thresholds are canonical: at +1 point per message, the app's old
 * 0/3/7/15/30/60 curve reached the final stage in 60 messages.
 *
 * The RN app mirrors this file at src/shared/constants/progression.ts — keep the
 * two in sync. `npm run check:progression` asserts they match.
 */

// ── Love Tree ────────────────────────────────────────────────────────────────
// `name` values are persisted in LoveTree.stage — do NOT rename without a
// migration. `label`/`emoji` are display-only and safe to change.
const TREE_STAGES = [
  { name: 'seed',      min: 0,    nextAt: 50,   emoji: '🌱', label: 'Seedling'    },
  { name: 'plant',     min: 50,   nextAt: 200,  emoji: '🌿', label: 'Sprout'      },
  { name: 'tree',      min: 200,  nextAt: 500,  emoji: '🌳', label: 'Sapling'     },
  { name: 'blooming',  min: 500,  nextAt: 1000, emoji: '🌸', label: 'Blooming'    },
  { name: 'golden',    min: 1000, nextAt: 2000, emoji: '🌟', label: 'Golden Tree' },
  { name: 'legendary', min: 2000, nextAt: null, emoji: '👑', label: 'Legendary'   },
];

/** Derive stage name from a point total. Always returns a valid stage. */
const resolveStage = (points) => {
  const pts = Number(points) || 0;
  return (TREE_STAGES.filter((s) => pts >= s.min).pop() || TREE_STAGES[0]).name;
};

/** Full stage record for a point total, plus the next stage and % progress. */
const resolveStageInfo = (points) => {
  const pts = Number(points) || 0;
  const current = TREE_STAGES.find((s) => s.name === resolveStage(pts)) || TREE_STAGES[0];
  const next = current.nextAt ? TREE_STAGES.find((s) => s.min === current.nextAt) || null : null;
  const span = current.nextAt ? current.nextAt - current.min : 0;
  const progressPercent = next && span > 0
    ? Math.max(0, Math.min(100, Math.round(((pts - current.min) / span) * 100)))
    : 100;
  return { current, next, progressPercent };
};

// ── Love Tree point categories ───────────────────────────────────────────────
const TREE_CATEGORIES = ['chatPoints', 'photoPoints', 'diaryPoints', 'musicPoints', 'checkinPoints'];

/**
 * Server-authoritative point awards, keyed by action.
 * Clients name an ACTION; they never supply a point value. Previously
 * POST /lovetree/water accepted an arbitrary client `points` with no cap,
 * so all progression was forgeable.
 */
const TREE_ACTIONS = {
  message:  { points: 1, category: 'chatPoints'    },
  photo:    { points: 3, category: 'photoPoints'   },
  diary:    { points: 5, category: 'diaryPoints'   },
  music:    { points: 5, category: 'musicPoints'   },
  checkin:  { points: 2, category: 'checkinPoints' },
  water:    { points: 2, category: 'checkinPoints' },
};

/** Max points a single relationship can accrue per category per UTC day. */
const TREE_DAILY_CAPS = {
  chatPoints:    60,
  photoPoints:   30,
  diaryPoints:   20,
  musicPoints:   10,
  checkinPoints: 10,
};

// ── Relationship levels / XP ─────────────────────────────────────────────────
const LEVEL_TITLES = {
  1:  'New Sparks ✨',
  5:  'Close Hearts ❤️',
  10: 'Soulmates 💞',
  25: 'Forever Partners 👑',
  50: 'Legendary Couple 🌟',
};

const getTitle = (level) => {
  const keys = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => b - a);
  for (const k of keys) if (level >= k) return LEVEL_TITLES[k];
  return LEVEL_TITLES[1];
};

/** XP required to advance FROM the given level. */
const xpToNextForLevel = (level) => Math.floor(100 * Math.pow(1.2, Math.max(1, level) - 1));

/**
 * Server-authoritative XP awards, keyed by action.
 * POST /levels/add-xp previously accepted arbitrary client XP.
 */
const XP_ACTIONS = {
  message:   2,
  photo:     10,
  diary:     8,
  moodCheck: 8,
  callEnd:   15,
  goalDone:  25,
  gameDone:  5,
};

/** Hard ceiling on XP a relationship can gain per UTC day. */
const XP_DAILY_CAP = 400;

module.exports = {
  TREE_STAGES,
  TREE_CATEGORIES,
  TREE_ACTIONS,
  TREE_DAILY_CAPS,
  resolveStage,
  resolveStageInfo,
  LEVEL_TITLES,
  getTitle,
  xpToNextForLevel,
  XP_ACTIONS,
  XP_DAILY_CAP,
};
