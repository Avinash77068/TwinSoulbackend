const Relationship = require('../models/Relationship');

/**
 * Gate a route on the caller's relationship being in an allowed lifecycle state.
 *
 * Client-side gating alone was insufficient: only three screens in the app used
 * the PartnerRequired wrapper, so Goals, Games, Music, LoveTree and — most
 * seriously — the AudioCall / VideoCall / WatchTogether screens were reachable
 * with no relationship at all and would call these endpoints regardless.
 *
 * Attaches `req.relationship` so handlers need not refetch.
 *
 * @param {string[]} allowed  e.g. ['active'] for live features,
 *                            ['active','paused'] for read-only-tolerant ones
 */
const requireRelationshipState = (allowed = ['active']) => async (req, res, next) => {
  try {
    if (!req.user?.relationshipId) {
      return res.status(409).json({
        success: false,
        message: 'Connect with your partner to use this feature.',
        data: { reason: 'no_relationship' },
      });
    }

    const relationship = await Relationship.findById(req.user.relationshipId);
    if (!relationship) {
      return res.status(409).json({
        success: false,
        message: 'Connect with your partner to use this feature.',
        data: { reason: 'no_relationship' },
      });
    }

    const status = Relationship.normalizeStatus(relationship.status);
    if (!allowed.includes(status)) {
      const copy = {
        paused:   'You are taking a break. Resume to use this again.',
        ending:   'This relationship is ending. You can undo it from your profile.',
        archived: 'This chapter is archived and read-only.',
        pending:  'Waiting for your partner to accept.',
      };
      return res.status(409).json({
        success: false,
        message: copy[status] || 'This feature is not available right now.',
        data: { reason: 'wrong_state', status },
      });
    }

    req.relationship = relationship;
    next();
  } catch (err) {
    next(err);
  }
};

/** Feature-flag gate — respects the per-relationship `features` toggles. */
const requireFeature = (featureKey) => async (req, res, next) => {
  const relationship = req.relationship
    || (req.user?.relationshipId ? await Relationship.findById(req.user.relationshipId) : null);

  if (!relationship) {
    return res.status(409).json({
      success: false,
      message: 'Connect with your partner to use this feature.',
      data: { reason: 'no_relationship' },
    });
  }
  const features = relationship.features?.toObject?.() ?? relationship.features ?? {};
  if (features[featureKey] === false) {
    return res.status(403).json({
      success: false,
      message: 'This feature is turned off for your relationship.',
      data: { reason: 'feature_disabled', featureKey },
    });
  }
  req.relationship = relationship;
  next();
};

module.exports = { requireRelationshipState, requireFeature };
