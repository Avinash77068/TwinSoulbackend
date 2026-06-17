// In-memory active call registry — cleared on server restart.
// Production: swap Map for Redis if you need multi-instance support.

const activeCalls = new Map(); // callId → CallRecord

const createCall = (callerId, calleeId, type) => {
  const callId = `call_${Date.now()}_${String(callerId).slice(-6)}`;
  activeCalls.set(callId, {
    callId,
    callerId: String(callerId),
    calleeId: String(calleeId),
    type,
    status: 'ringing',
    startedAt: Date.now(),
  });
  return callId;
};

const getActiveCall = (callId) => activeCalls.get(callId) ?? null;

const getActiveCallForUser = (userId) => {
  const uid = String(userId);
  for (const call of activeCalls.values()) {
    if (call.callerId === uid || call.calleeId === uid) return call;
  }
  return null;
};

const updateCallStatus = (callId, status) => {
  const call = activeCalls.get(callId);
  if (call) activeCalls.set(callId, { ...call, status });
};

const removeCall = (callId) => activeCalls.delete(callId);

module.exports = { createCall, getActiveCall, getActiveCallForUser, updateCallStatus, removeCall };
