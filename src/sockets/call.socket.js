const User = require('../models/User');
const Presence = require('../models/Presence');
const sendPushNotification = require('../utils/sendPushNotification');
const callService = require('../services/call.service');

module.exports = (io, socket) => {
  const userId = String(socket.userId);

  // ── call:start ────────────────────────────────────────────────────────────
  // Caller initiates. Backend validates partnership, notifies callee.
  socket.on('call:start', async ({ calleeId, type = 'audio' }) => {
    try {
      const existing = callService.getActiveCallForUser(userId);
      if (existing) {
        socket.emit('call:error', { message: 'You are already in a call' });
        return;
      }

      const caller = await User.findById(userId).select('nickname name partnerId relationshipId');
      if (!caller) return;

      if (String(caller.partnerId) !== String(calleeId)) {
        socket.emit('call:error', { message: 'You can only call your partner' });
        return;
      }

      const callId = callService.createCall(userId, calleeId, type);
      const callerName = caller.nickname || caller.name;

      // Confirm to caller with assigned callId
      socket.emit('call:started', { callId, type });

      // Notify callee
      io.to(`user:${calleeId}`).emit('call:incoming', {
        callId,
        callerId: userId,
        callerName,
        callerPhoto: null,
        type,
        relationshipId: String(caller.relationshipId),
      });

      // FCM fallback if callee is offline
      try {
        const partnerPresence = await Presence.findOne({ userId: calleeId });
        if (!partnerPresence?.isOnline) {
          const callee = await User.findById(calleeId).select('fcmToken');
          if (callee?.fcmToken) {
            await sendPushNotification({
              fcmToken: callee.fcmToken,
              title: `📞 ${callerName} is calling`,
              body: `${type === 'video' ? '🎥 Video' : '🎤 Audio'} call — tap to answer`,
              data: { type: 'incoming_call', callType: type, callerId: userId, callId },
            });
          }
        }
      } catch (_) {}
    } catch (err) {
      console.error('[Call] call:start error:', err.message);
    }
  });

  // ── call:accept ───────────────────────────────────────────────────────────
  socket.on('call:accept', ({ callId }) => {
    const call = callService.getActiveCall(callId);
    if (!call || call.calleeId !== userId) return;
    callService.updateCallStatus(callId, 'connecting');
    io.to(`user:${call.callerId}`).emit('call:accepted', { callId });
  });

  // ── call:reject ───────────────────────────────────────────────────────────
  socket.on('call:reject', ({ callId }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    callService.removeCall(callId);
    io.to(`user:${call.callerId}`).emit('call:rejected', { callId });
  });

  // ── call:end ──────────────────────────────────────────────────────────────
  socket.on('call:end', ({ callId }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const otherId = call.callerId === userId ? call.calleeId : call.callerId;
    callService.removeCall(callId);
    io.to(`user:${otherId}`).emit('call:ended', { callId });
    socket.emit('call:ended', { callId });
  });

  // ── WebRTC: offer ─────────────────────────────────────────────────────────
  socket.on('webrtc:offer', ({ callId, offer }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    io.to(`user:${targetId}`).emit('webrtc:offer', { callId, offer });
  });

  // ── WebRTC: answer ────────────────────────────────────────────────────────
  socket.on('webrtc:answer', ({ callId, answer }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    io.to(`user:${targetId}`).emit('webrtc:answer', { callId, answer });
    callService.updateCallStatus(callId, 'connected');
  });

  // ── WebRTC: ICE candidate ─────────────────────────────────────────────────
  socket.on('webrtc:ice-candidate', ({ callId, candidate }) => {
    const call = callService.getActiveCall(callId);
    if (!call) return;
    const targetId = call.callerId === userId ? call.calleeId : call.callerId;
    io.to(`user:${targetId}`).emit('webrtc:ice-candidate', { callId, candidate });
  });

  // ── Disconnect recovery ───────────────────────────────────────────────────
  // If user drops (crash, network loss), notify partner and clean up
  socket.on('disconnect', () => {
    const activeCall = callService.getActiveCallForUser(userId);
    if (!activeCall) return;
    const otherId = activeCall.callerId === userId ? activeCall.calleeId : activeCall.callerId;
    callService.removeCall(activeCall.callId);
    io.to(`user:${otherId}`).emit('call:ended', { callId: activeCall.callId, reason: 'disconnect' });
  });
};
