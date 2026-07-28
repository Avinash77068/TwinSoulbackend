const router = require('express').Router();
const c = require('../controllers/legal.controller');

router.get('/privacy', c.getPrivacyPolicy);
router.get('/terms', c.getTermsConditions);

module.exports = router;
