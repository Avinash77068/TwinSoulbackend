const Relationship = require('../models/Relationship');
const relationshipController = require('./relationship.controller');
const levelsController = require('./levels.controller');
const moodController = require('./mood.controller');
const premiumController = require('./premium.controller');

/**
 * GET /api/relationship/home
 *
 * Single bootstrap call for the Home screen. Replaces 5 separate requests
 * (dashboard, levels, mood/today, mood/partner, premium/status) with one,
 * by reusing the exact same data-fetch functions those endpoints call —
 * no business logic, calculation, or authorization rule is duplicated or
 * changed.
 *
 * Each section preserves the authorization of its standalone endpoint:
 *   - `dashboard` is null unless the caller has a relationship that still
 *     exists (same gate as GET /relationship/dashboard).
 *   - `level` and `mood` are null unless that relationship is `active` (same
 *     gate as GET /levels and GET /mood/today, which 409 otherwise).
 *   - `premium` has no relationship gate, same as GET /premium/status.
 * A null section mirrors what already happens today when the standalone
 * request fails or is skipped — the app leaves that part of the UI as-is.
 * `mood.partnerMood` covers what GET /mood/partner returned, since
 * GET /mood/today already includes the partner's entry for the same date.
 */
exports.getHomeBootstrap = async (req, res) => {
  let dashboard = null;
  let level = null;
  let mood = null;

  if (req.user.relationshipId) {
    const relationship = await Relationship.findById(req.user.relationshipId);
    if (relationship) {
      dashboard = await relationshipController.fetchDashboardData(req, relationship);

      const status = Relationship.normalizeStatus(relationship.status);
      if (status === 'active') {
        [level, mood] = await Promise.all([
          levelsController.fetchLevelData(req),
          moodController.fetchTodayMoodData(req),
        ]);
      }
    }
  }

  const premium = await premiumController.fetchPremiumStatusData(req);

  res.json({
    success: true,
    data: { dashboard, level, mood, premium },
  });
};
