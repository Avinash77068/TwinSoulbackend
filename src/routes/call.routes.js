const router = require('express').Router();
const { protect } = require('../middleware/auth');
const callService = require('../services/call.service');
const { getIo } = require('../config/socketInstance');

// GET /api/calls/ice-servers
// Returns ICE server config. Credentials stay in .env — never shipped in the app bundle.
router.get('/ice-servers', protect, (req, res) => {
  const username   = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;

  if (!username || !credential) {
    return res.status(500).json({ success: false, message: 'TURN credentials not configured' });
  }

  res.json({
    success: true,
    iceServers: [
      {
        urls: [
          'stun:stun.cloudflare.com:3478',
          'stun:stun.l.google.com:19302',
          'stun:stun1.l.google.com:19302',
        ],
      },
      {
        urls: [
          'turn:global.relay.metered.ca:80',
          'turn:global.relay.metered.ca:80?transport=tcp',
          'turn:global.relay.metered.ca:443',
          'turns:global.relay.metered.ca:443?transport=tcp',
        ],
        username,
        credential,
      },
    ],
  });
});

// POST /api/calls/:callId/reject
// Used by the client when the app is in killed/background state and the user
// presses Reject on the system notification (no active socket connection).
router.post('/:callId/reject', protect, (req, res) => {
  const { callId } = req.params;
  const userId = String(req.user._id);

  const call = callService.getActiveCall(callId);
  if (!call) return res.status(404).json({ success: false, message: 'Call not found or already ended' });

  if (call.calleeId !== userId) {
    return res.status(403).json({ success: false, message: 'Not authorized to reject this call' });
  }

  callService.removeCall(callId);

  const io = getIo();
  if (io) {
    io.to(`user:${call.callerId}`).emit('call:rejected', { callId });
  }

  return res.json({ success: true });
});

module.exports = router;
