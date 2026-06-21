const User = require('../models/User');
const Presence = require('../models/Presence');
const sendPushNotification = require('../utils/sendPushNotification');
const callService = require('../services/call.service');
const awardXP = require('../utils/awardXP');

// Ring timeout registry — keyed by callId
const ringTimeouts = new Map();

function clearRingTimeout(callId) {
  const t = ringTimeouts.get(callId);
  if (t) { clearTimeout(t); ringTimeouts.delete(callId); }
}

module.exports = (io, socket) => {
  const userId = String(socket.userId);

  // ── call:start ────────────────────────────────────────────────────────────
  socket.on('call:start', async ({ calleeId, type = 'audio' }) => {
    try {
      // FIX: check if CALLER is already in a call
      const callerBusy = callService.getActiveCallForUser(userId);
      if (callerBusy) {
        socket.emit('call:error', { message: 'You are already in a call' });
        return;
      }

      // FIX: check if CALLEE is already in a call → emit call:busy to caller
      const calleeBusy = callService.getActiveCallForUser(calleeId);
      if (calleeBusy) {
        socket.emit('call:busy', { calleeId });
        return;
      }

      const caller = await User.findById(userId)
        .select('nickname name partnerId relationshipId profilePhoto');
      if (!caller) return;

      if (String(caller.partnerId) !== String(calleeId)) {
        socket.emit('call:error', { message: 'You can only call your partner' });
        return;
      }

      const callId = callService.createCall(userId, calleeId, type);
      const callerName = caller.nickname || caller.name;

      // Confirm to caller with assigned callId
      socket.emit('call:started', { callId, type });

      // Notify callee via room (FIX: rooms are reliable across reconnects)
      io.to(`user:${calleeId}`).emit('call:incoming', {
        callId,
        callerId: userId,
        callerName,
        callerPhoto: caller.profilePhoto ?? null,
        type,
        relationshipId: String(caller.relationshipId),
      });

      // FIX: confirm delivery to caller
      socket.emit('call:ringing', { callId });

      // FIX: 45-second ring timeout — server-enforced
      const timeout = setTimeout(async () => {
        const call = callService.getActiveCall(callId);
        if (call && call.status === 'ringing') {
          callService.removeCall(callId);
          socket.emit('call:timeout', { callId });
          io.to(`user:${calleeId}`).emit('call:ended', { callId, reason: 'timeout' });
        }
        ringTimeouts.delete(callId);
      }, 45_000);
      ringTimeouts.set(callId, timeout);
      
      try {
        const callee = await User.findById(calleeId).select('fcmToken');
        if (callee?.fcmToken) {
          await sendPushNotification({
            fcmToken: callee.fcmToken,
            title: `📞 ${callerName} is calling`,
            body: `${type === 'video' ? '🎥 Video' : '🎤 Audio'} call — tap to answer`,
            data: {
              type:           'incoming_call',
              callId,
              callType:       type,
              callerId:       userId,
              callerName,
              callerPhoto:    caller.profilePhoto ?? '',
              relationshipId: String(caller.relationshipId),
            },
          });
        }
      } catch (_) {}
    } catch (err) {
      console.error('[Call] call:start error:', err.message);
    }
  });

  // ── call:accept ───────────────────────────────────────────────────────────
  socket.on('call:accept', ({ callId }) => {
    clearRingTimeout(callId);
    const call = callService.getActiveCall(callId);
    if (!call || call.calleeId !== userId) return;
    callService.updateCallStatus(callId, 'connecting');
    io.to(`user:${call.callerId}`).emit('call:accepted', { callId });
  });

  // ── call:reject ───────────────────────────────────────────────────────────
  socket.on('call:reject', ({ callId }) => {
    clearRingTimeout(callId);
    const call = callService.getActiveCall(callId);
    if (!call) return;
    callService.removeCall(callId);
    io.to(`user:${call.callerId}`).emit('call:rejected', { callId });
  });

  // ── call:end ──────────────────────────────────────────────────────────────
  socket.on('call:end', async ({ callId }) => {
    clearRingTimeout(callId);
    const call = callService.getActiveCall(callId);
    if (!call) return; // FIX: idempotent — second call:end is a no-op

    const wasConnected = call.status === 'connected' || call.status === 'connecting';
    const otherId = call.callerId === userId ? call.calleeId : call.callerId;
    const startedAt = call.startedAt;

    // FIX: remove BEFORE awarding XP to prevent double-award
    callService.removeCall(callId);

    io.to(`user:${otherId}`).emit('call:ended', { callId, reason: 'hangup' });
    socket.emit('call:ended', { callId });

    if (wasConnected) {
      const durationSec = (Date.now() - startedAt) / 1000;
      if (durationSec > 10) {
        try {
          const caller = await User.findById(call.callerId).select('relationshipId');
          if (caller?.relationshipId) {
            awardXP(caller.relationshipId, 15);
          }
        } catch (_) {}
      }
    }
  });

  // ── WebRTC: offer ─────────────────────────────────────────────────────────
  socket.on('webrtc:offer', ({ callId, offer }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    io.to(`user:${targetId}`).emit('webrtc:offer', { callId, offer });
    // Mark as connected when offer/answer exchange starts
    if (call.status === 'connecting') {
      callService.updateCallStatus(callId, 'connected');
    }
  });

  // ── WebRTC: answer ────────────────────────────────────────────────────────
  socket.on('webrtc:answer', ({ callId, answer }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    io.to(`user:${targetId}`).emit('webrtc:answer', { callId, answer });
  });

  // ── WebRTC: ICE candidate ─────────────────────────────────────────────────
  socket.on('webrtc:ice-candidate', ({ callId, candidate }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    io.to(`user:${targetId}`).emit('webrtc:ice-candidate', { callId, candidate });
  });

  // FIX: relay ICE restart offer to callee
  socket.on('webrtc:ice-restart', ({ callId, offer }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    io.to(`user:${targetId}`).emit('webrtc:ice-restart', { callId, offer });
  });
};

// FIX: centralized disconnect handler — called by socket.handler.js only
// This prevents duplicate disconnect handling between the two socket files
module.exports.onUserDisconnect = (io, userId) => {
  const activeCall = callService.getActiveCallForUser(userId);
  if (!activeCall) return;

  clearRingTimeout(activeCall.callId);
  callService.removeCall(activeCall.callId);

  const otherId = activeCall.callerId === userId ? activeCall.calleeId : activeCall.callerId;
  io.to(`user:${otherId}`).emit('call:ended', { callId: activeCall.callId, reason: 'disconnect' });
};
