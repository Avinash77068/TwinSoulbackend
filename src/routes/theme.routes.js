const express = require('express');
const router = express.Router();
const { getTheme, updateTheme, resetTheme } = require('../controllers/theme.controller');
const { protect } = require('../middleware/auth');

// Public — app fetch karta hai open hote hi, no auth needed
router.get('/', getTheme);

// Protected — sirf logged-in users theme change kar sakte hain
router.put('/', protect, updateTheme);
router.delete('/reset', protect, resetTheme);

module.exports = router;
