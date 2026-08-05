/**
 * Mood compatibility between two partners.
 *
 * Maps the six moods onto a valence scale, then measures how closely the two
 * partners' valences tracked each other over the overlapping days they BOTH
 * checked in.
 *
 * Coverage-weighting matters: without it, a single matching day would report
 * "100% in sync", which is both wrong and emotionally misleading.
 */

const MOOD_VALENCE = {
  loved:    2,
  happy:    1,
  neutral:  0,
  anxious: -1,
  sad:     -1,
  angry:   -2,
};

const MAX_SPREAD = 4; // |+2 − (−2)|

/** Most frequent mood in a list of entries, or null. */
const dominantMood = (entries = []) => {
  if (!entries.length) return null;
  const counts = entries.reduce((acc, e) => {
    acc[e.mood] = (acc[e.mood] || 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
};

/** Count of each mood. */
const countMoods = (entries = []) =>
  entries.reduce((acc, e) => {
    acc[e.mood] = (acc[e.mood] || 0) + 1;
    return acc;
  }, {});

/**
 * @param {Array<{date: string, mood: string}>} aEntries
 * @param {Array<{date: string, mood: string}>} bEntries
 * @param {number} windowDays  denominator for coverage (default 30)
 * @returns {{compatibility: number|null, alignment: number|null,
 *            coverage: number, overlappingDays: number, trend: string|null}}
 */
const moodCompatibility = (aEntries = [], bEntries = [], windowDays = 30) => {
  const bByDate = new Map(bEntries.map((e) => [e.date, e.mood]));

  const paired = [];
  for (const entry of aEntries) {
    const otherMood = bByDate.get(entry.date);
    if (otherMood === undefined) continue;
    const va = MOOD_VALENCE[entry.mood];
    const vb = MOOD_VALENCE[otherMood];
    if (va === undefined || vb === undefined) continue;
    paired.push({ date: entry.date, diff: Math.abs(va - vb) });
  }

  const overlappingDays = paired.length;
  const coverage = windowDays > 0 ? Math.min(1, overlappingDays / windowDays) : 0;

  if (overlappingDays === 0) {
    return { compatibility: null, alignment: null, coverage: 0, overlappingDays: 0, trend: null };
  }

  const meanDiff = paired.reduce((s, p) => s + p.diff, 0) / overlappingDays;
  const alignment = 1 - meanDiff / MAX_SPREAD;

  // Confidence-weighted so sparse data cannot claim a perfect score.
  const compatibility = Math.round(100 * alignment * (0.5 + 0.5 * coverage));

  // Trend: compare the alignment of the most recent third against the earliest third.
  let trend = null;
  if (overlappingDays >= 6) {
    const sorted = [...paired].sort((x, y) => (x.date < y.date ? -1 : 1));
    const chunk = Math.floor(sorted.length / 3);
    const meanOf = (arr) => arr.reduce((s, p) => s + p.diff, 0) / arr.length;
    const early = meanOf(sorted.slice(0, chunk));
    const late = meanOf(sorted.slice(-chunk));
    // Lower diff = better alignment.
    if (late < early - 0.25) trend = 'improving';
    else if (late > early + 0.25) trend = 'diverging';
    else trend = 'steady';
  }

  return {
    compatibility: Math.max(0, Math.min(100, compatibility)),
    alignment: Number(alignment.toFixed(3)),
    coverage: Number(coverage.toFixed(2)),
    overlappingDays,
    trend,
  };
};

module.exports = { MOOD_VALENCE, moodCompatibility, dominantMood, countMoods };
