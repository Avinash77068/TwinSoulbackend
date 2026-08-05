const express = require('express');
const router = express.Router();
const { getTheme, updateTheme, resetTheme } = require('../controllers/theme.controller');
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');

// Live-relationship gate: these endpoints are meaningless without a partner and
// were previously reachable with none at all.
const active = requireRelationshipState(['active']);

// Protected — theme is per-couple, needs req.user.relationshipId
router.get('/', protect, active, getTheme);
router.put('/', protect, active, updateTheme);
router.delete('/reset', protect, active, resetTheme);

module.exports = router;
