const express = require('express');
const router = express.Router();
const { getTheme, updateTheme, resetTheme } = require('../controllers/theme.controller');
const { protect } = require('../middleware/auth');

// Protected — theme is per-couple, needs req.user.relationshipId
router.get('/', protect, getTheme);
router.put('/', protect, updateTheme);
router.delete('/reset', protect, resetTheme);

module.exports = router;
