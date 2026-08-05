const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requirePremium } = require('../middleware/premium');
const c = require('../controllers/discovery.controller');

// Own settings: NOT premium-gated. A user must always be able to see and change
// whether they appear in other people's search, regardless of what they pay.
router.get('/me', protect, c.getMyDiscoverySettings);
router.patch('/me', protect, c.updateMyDiscoverySettings);

// Browsing and reaching out are the paid parts. Both honour the DB-backed
// `discoveryRequiresPremium` flag, so partner search can be opened to everyone
// (or locked back down) from AppConfig without a deploy.
router.get(
  '/partners',
  protect,
  requirePremium('Partner search', 'discoveryRequiresPremium'),
  c.findPartners,
);
router.post(
  '/interest',
  protect,
  requirePremium('Sending an invite from search', 'discoveryRequiresPremium'),
  c.sendInterest,
);

module.exports = router;
