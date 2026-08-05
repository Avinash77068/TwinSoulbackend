const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);
const c = require('../controllers/lovetree.controller');

router.get('/', protect, active, c.getTree);
router.post('/water', protect, active, c.addPoints);

module.exports = router;
