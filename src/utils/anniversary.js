/**
 * Anniversary date maths.
 *
 * The previous implementation in ai.controller.js built the monthly anniversary
 * as `new Date(today.getFullYear(), start.getMonth(), start.getDate())` — it used
 * the START month instead of the current month, so the "monthly" reminder could
 * only ever fire during the one month of the year the couple got together, and
 * produced negative `daysUntil` for every date already past.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Midnight UTC for a date, so day arithmetic is not skewed by local time. */
const startOfUTCDay = (d) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Whole days between two dates, ignoring time of day. */
const daysBetween = (a, b) => Math.round((startOfUTCDay(b) - startOfUTCDay(a)) / DAY_MS);

/**
 * Clamp a day-of-month to a month that may be shorter.
 * A couple who started on the 31st has their monthly anniversary on the 28th/30th
 * in shorter months rather than silently rolling into the next month.
 */
const clampDayToMonth = (year, monthIndex, day) => {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return Math.min(day, lastDay);
};

/**
 * Next MONTHLY anniversary at or after `from`.
 * @returns {{date: Date, daysUntil: number, monthsTogether: number}}
 */
const nextMonthlyAnniversary = (startDate, from = new Date()) => {
  const start = new Date(startDate);
  const day = start.getUTCDate();

  let year = from.getUTCFullYear();
  let month = from.getUTCMonth();

  // Candidate in the CURRENT month (the original bug: it used start.getMonth()).
  let candidate = new Date(Date.UTC(year, month, clampDayToMonth(year, month, day)));

  // Already passed this month → roll to next month.
  if (startOfUTCDay(candidate) < startOfUTCDay(from)) {
    month += 1;
    if (month > 11) { month = 0; year += 1; }
    candidate = new Date(Date.UTC(year, month, clampDayToMonth(year, month, day)));
  }

  const monthsTogether =
    (candidate.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    (candidate.getUTCMonth() - start.getUTCMonth());

  return {
    date: candidate,
    daysUntil: daysBetween(from, candidate),
    monthsTogether: Math.max(0, monthsTogether),
  };
};

/**
 * Next YEARLY anniversary at or after `from`.
 * @returns {{date: Date, daysUntil: number, yearsTogether: number}}
 */
const nextYearlyAnniversary = (startDate, from = new Date()) => {
  const start = new Date(startDate);
  const month = start.getUTCMonth();
  const day = start.getUTCDate();

  let year = from.getUTCFullYear();
  let candidate = new Date(Date.UTC(year, month, clampDayToMonth(year, month, day)));

  if (startOfUTCDay(candidate) < startOfUTCDay(from)) {
    year += 1;
    candidate = new Date(Date.UTC(year, month, clampDayToMonth(year, month, day)));
  }

  return {
    date: candidate,
    daysUntil: daysBetween(from, candidate),
    yearsTogether: Math.max(0, candidate.getUTCFullYear() - start.getUTCFullYear()),
  };
};

/** Whole days together (0 when startDate is missing). */
const daysTogether = (startDate, from = new Date()) => {
  if (!startDate) return 0;
  return Math.max(0, daysBetween(new Date(startDate), from));
};

/** Day-count milestones worth celebrating. */
const DAY_MILESTONES = [100, 365, 500, 1000, 1500, 2000, 3650, 5000];

/** The milestone reached exactly today, if any. */
const milestoneForDay = (days) => DAY_MILESTONES.find((m) => m === days) || null;

module.exports = {
  DAY_MS,
  daysBetween,
  nextMonthlyAnniversary,
  nextYearlyAnniversary,
  daysTogether,
  DAY_MILESTONES,
  milestoneForDay,
};
