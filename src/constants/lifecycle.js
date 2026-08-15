/**
 * Relationship lifecycle timings and policy.
 * Single source of truth so the API, the cron jobs and the UI copy agree.
 */

module.exports = {
  /** Days between requesting a permanent delete and the data actually going. */
  PURGE_DELAY_DAYS: 30,

  /** How long an archived chapter is retained before the deletion warning. */
  ARCHIVE_RETENTION_MONTHS: 12,
  /** Warn this many days before archive retention expires. */
  ARCHIVE_WARNING_DAYS_BEFORE: 30,

  /** Minimum wait after archiving before a reconnect may be ACCEPTED. */
  RECONNECT_COOLDOWN_HOURS: 24,

  /** After this many reconnects, stop celebrating and default to a fresh start. */
  RECONCILIATION_CELEBRATE_LIMIT: 3,

  /** Days an invite token stays redeemable. */
  INVITE_EXPIRY_DAYS: 7,
  /** Max invites one user may create per rolling 24 h (anti-harassment). */
  INVITE_MAX_PER_DAY: 20,

  /** One-sided inactivity after which the active partner may unilaterally end. */
  ABANDONED_AFTER_DAYS: 90,

  /** Reasons offered when ending. Private; never shown to the partner. */
  END_REASONS: [
    'broke_up',
    'need_space',
    'too_much_pressure',
    'wrong_person',
    'just_testing',
    'other',
  ],
};
