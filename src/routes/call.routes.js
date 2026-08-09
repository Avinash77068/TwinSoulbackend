const axios = require('axios');
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { requireRelationshipState } = require('../middleware/relationshipState');
const callService = require('../services/call.service');
const { getIo } = require('../config/socketInstance');

// Calling requires a live partner. The call screens were previously reachable
// with no relationship at all and would hit these endpoints regardless.
const active = requireRelationshipState(['active']);


async function getXirsysIceServers() {
  const ident   = process.env.XIRSYS_IDENT;
  const secret  = process.env.XIRSYS_SECRET;
  const channel = process.env.XIRSYS_CHANNEL;

  if (!ident || !secret || !channel) return null;

  try {
    const { data } = await axios.put(
      `https://global.xirsys.net/_turn/${channel}`,
      { format: 'urls' },
      { auth: { username: ident, password: secret }, timeout: 5000 },
    );

    const servers = data?.v?.iceServers;
    if (!servers) return null;

    return Array.isArray(servers) ? servers : [servers];
  } catch (err) {
    console.warn('[ICE] Xirsys request failed:', err.message);
    return null;
  }
}

// GET /api/calls/ice-servers
// Returns ICE server config. Credentials stay in .env — never shipped in the app bundle.
router.get('/ice-servers', protect, active, async (req, res) => {
  const username   = process.env.TURN_USERNAME;
  const credential = process.env.TURN_CREDENTIAL;

  const stunServers = {
    urls: [
      'stun:stun.cloudflare.com:3478',
      'stun:stun.l.google.com:19302',
      'stun:stun1.l.google.com:19302',
    ],
  };

  const iceServers = [stunServers];

  if (username && credential) {
    iceServers.push({
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turn:global.relay.metered.ca:443',
        'turns:global.relay.metered.ca:443?transport=tcp',
      ],
      username,
      credential,
    });
  } else {
    console.warn('[ICE] TURN_USERNAME or TURN_CREDENTIAL missing in .env — skipping metered.ca TURN');
  }

  const xirsysServers = await getXirsysIceServers();
  if (xirsysServers) {
    iceServers.push(...xirsysServers);
  } else {
    console.warn('[ICE] XIRSYS_IDENT/XIRSYS_SECRET/XIRSYS_CHANNEL missing or request failed — skipping Xirsys TURN');
  }

  const expressTurnUsername   = process.env.EXPRESSTURN_USERNAME;
  const expressTurnCredential = process.env.EXPRESSTURN_CREDENTIAL;

  if (expressTurnUsername && expressTurnCredential) {
    iceServers.push({
      urls: ['turn:free.expressturn.com:3478'],
      username: expressTurnUsername,
      credential: expressTurnCredential,
    });
  } else {
    console.warn('[ICE] EXPRESSTURN_USERNAME or EXPRESSTURN_CREDENTIAL missing in .env — skipping ExpressTurn TURN');
  }

  res.json({ success: true, iceServers });
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
