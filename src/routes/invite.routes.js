const router = require('express').Router();
const { protect } = require('../middleware/auth');
const c = require('../controllers/invite.controller');

// ── Public ───────────────────────────────────────────────────────────────────
// The accept-preview must work BEFORE signup: a logged-out user tapping an
// invite link needs to see who invited them, then sign up, then redeem.
router.get('/:token', c.getInvite);

// ── Authenticated ────────────────────────────────────────────────────────────
router.post('/', protect, c.createInvite);
router.get('/mine/list', protect, c.getMyInvites);
router.post('/:token/accept', protect, c.acceptInvite);
router.delete('/:token', protect, c.revokeInvite);

// Contact discovery (privacy-preserving; hashes only)
router.get('/contacts/pepper', protect, c.getContactPepper);
router.post('/contacts/match', protect, c.matchContacts);

module.exports = router;
