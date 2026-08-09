// In-memory active call registry — cleared on server restart.
// Intentional: this backend runs as a single Node instance (Socket.IO uses the
// default in-process adapter), so a Map is sufficient. Durable call history lives
// in CallLog; only live, in-flight call state is held here.

const activeCalls = new Map(); // callId → CallRecord

const createCall = (callerId, calleeId, type, relationshipId = null) => {
  const callId = `call_${Date.now()}_${String(callerId).slice(-6)}`;
  activeCalls.set(callId, {
    callId,
    callerId: String(callerId),
    calleeId: String(calleeId),
    // Carried so the call can be written to CallLog on teardown — the dashboard's
    // "Call Hours" statistic depends on it.
    relationshipId: relationshipId ? String(relationshipId) : null,
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
