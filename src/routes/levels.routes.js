const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');
const { cache } = require('../cache/cacheMiddleware');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/levels.controller');

router.get('/', protect, active, cache('levels', 30), c.getLevel);
router.post('/xp', protect, active, c.addXP);

module.exports = router;
