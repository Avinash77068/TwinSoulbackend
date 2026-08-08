const User = require('../models/User');
const Presence = require('../models/Presence');
const CallLog = require('../models/CallLog');
const Notification = require('../models/Notification');
const sendPushNotification = require('../utils/sendPushNotification');
const callService = require('../services/call.service');
const awardXP = require('../utils/awardXP');

// Ring timeout registry — keyed by callId
const ringTimeouts = new Map();

function clearRingTimeout(callId) {
  const t = ringTimeouts.get(callId);
  if (t) { clearTimeout(t); ringTimeouts.delete(callId); }
}

/**
 * Persist a finished call. Fire-and-forget: a logging failure must never break
 * call teardown, so errors are swallowed after being reported.
 */
function logCall(call, { outcome, endedBy = null, durationSeconds = 0 }) {
  if (!call?.relationshipId) return;
  CallLog.create({
    relationshipId: call.relationshipId,
    callerId: call.callerId,
    calleeId: call.calleeId,
    type: call.type || 'audio',
    outcome,
    startedAt: new Date(call.startedAt),
    answeredAt: outcome === 'completed' && durationSeconds > 0
      ? new Date(Date.now() - durationSeconds * 1000)
      : null,
    endedAt: new Date(),
    durationSeconds,
    endedBy,
  }).catch((err) => console.error('[CallLog]', err.message));
}

/**
 * Tell both sides about a call that rang out.
 *
 * Two different messages, because the two sides need different things:
 *   callee — "Missed call from X", plus a PUSH, since not answering usually
 *            means they were away from the phone entirely
 *   caller — "No answer", in-app only; they are holding the device and just
 *            watched it fail, so a push would be noise
 *
 * Never throws: this runs inside a setTimeout with no caller to catch it, so an
 * unhandled rejection here would take the process down.
 */
async function notifyMissedCall({ call, callerName, type }) {
  const label = type === 'video' ? 'video call' : 'call';
  try {
    await Notification.create({
      userId: call.calleeId,
      relationshipId: call.relationshipId,
      type: 'missed_call',
      title: `Missed ${label}`,
      body: `${callerName} tried to reach you`,
      data: { type: 'missed_call', callType: type, callerId: String(call.callerId) },
    });
  } catch (err) {
    console.error('[Call] missed_call notification failed:', err.message);
  }

  try {
    await Notification.create({
      userId: call.callerId,
      relationshipId: call.relationshipId,
      type: 'no_answer',
      title: 'No answer',
      body: `They didn't pick up your ${label}`,
      data: { type: 'no_answer', callType: type, calleeId: String(call.calleeId) },
    });
  } catch (err) {
    console.error('[Call] no_answer notification failed:', err.message);
  }

  try {
    const callee = await User.findById(call.calleeId).select('fcmToken pushNotificationsEnabled');
    if (callee?.fcmToken && callee.pushNotificationsEnabled !== false) {
      await sendPushNotification({
        fcmToken: callee.fcmToken,
        title: `Missed ${label}`,
        body: `${callerName} tried to reach you`,
        data: { type: 'missed_call', callType: type, callerId: String(call.callerId) },
      });
    }
  } catch (err) {
    console.error('[Call] missed-call push failed:', err.message);
  }
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

      const callId = callService.createCall(userId, calleeId, type, caller.relationshipId);
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

      /**
       * 45-second ring timeout — server-enforced.
       *
       * An unanswered call used to end silently: nothing was written to
       * CallLog, so it never appeared in call history, and neither side was
       * told anything. The caller just watched "Calling…" disappear and the
       * callee had no idea they had been called at all.
       */
      const timeout = setTimeout(async () => {
        ringTimeouts.delete(callId);
        const call = callService.getActiveCall(callId);
        if (!call || call.status !== 'ringing') return;

        callService.removeCall(callId);
        logCall(call, { outcome: 'missed' });
        io.to(`user:${userId}`).emit('call:timeout', { callId, reason: 'no_answer' });
        // `call:ended` tears the call UI down (existing behaviour); `call:missed`
        // carries the copy, and is separate so the callee is told WHY the
        // ringing stopped instead of it just vanishing.
        io.to(`user:${calleeId}`).emit('call:ended', { callId, reason: 'timeout' });
        io.to(`user:${calleeId}`).emit('call:missed', { callId, callerName, type });

        await notifyMissedCall({ call, callerName, type });
      }, 45_000);
      ringTimeouts.set(callId, timeout);
      
      try {
        const calleePresence = await Presence.findOne({ userId: calleeId });
        if (!calleePresence?.isOnline) {
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
    logCall(call, { outcome: 'rejected', endedBy: userId });
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

    const durationSec = wasConnected ? (Date.now() - startedAt) / 1000 : 0;

    // Persist the call so total call time is reportable. Previously call state
    // lived only in the in-memory registry, so "Call Hours" was impossible.
    logCall(call, {
      outcome: wasConnected ? 'completed' : 'missed',
      endedBy: userId,
      durationSeconds: Math.max(0, Math.round(durationSec)),
    });

    if (wasConnected && durationSec > 10) {
      try {
        const caller = await User.findById(call.callerId).select('relationshipId');
        if (caller?.relationshipId) {
          awardXP(caller.relationshipId, 'callEnd');
        }
      } catch (_) {}
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
