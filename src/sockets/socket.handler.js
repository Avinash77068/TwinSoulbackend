const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Presence = require('../models/Presence');
const sendPushNotification = require('../utils/sendPushNotification');

// Guard: verify client-supplied relationshipId matches the authenticated user's
const ownsRelationship = (user, relationshipId) =>
  user?.relationshipId && String(user.relationshipId) === String(relationshipId);

// Guard: verify client-supplied partnerId matches the authenticated user's partner
const ownsPartner = (user, partnerId) =>
  user?.partnerId && String(user.partnerId) === String(partnerId);

module.exports = (io) => {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
      if (!token) return next(new Error('Authentication error'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    const userId = socket.userId;

    await Promise.all([
      Presence.findOneAndUpdate(
        { userId },
        { isOnline: true, lastHeartbeat: new Date(), socketId: socket.id },
        { upsert: true }
      ),
      User.findByIdAndUpdate(userId, { isOnline: true, lastSeen: new Date() }),
    ]);

    const user = await User.findById(userId);
    if (user?.relationshipId) {
      socket.join(`relationship:${user.relationshipId}`);
      socket.to(`relationship:${user.relationshipId}`).emit('partner:online', { userId });
    }
    socket.join(`user:${userId}`);

    // ── Chat ──────────────────────────────────────────────────────────────────

    socket.on('message:send', async (data) => {
      if (!ownsRelationship(user, data.relationshipId)) return;
      const room = `relationship:${data.relationshipId}`;
      socket.to(room).emit('message:new', data);
      try {
        if (user?.partnerId) {
          const partnerPresence = await Presence.findOne({ userId: user.partnerId });
          if (!partnerPresence?.isOnline) {
            const partner = await User.findById(user.partnerId).select('fcmToken');
            if (partner?.fcmToken) {
              const senderName = user.nickname || user.name || 'Partner';
              const messagePreview =
                data.type === 'text'
                  ? data.content?.slice(0, 100)
                  : data.type === 'image' ? '📷 Photo'
                  : data.type === 'voice' ? '🎤 Voice message'
                  : '💬 New message';
              await sendPushNotification({
                fcmToken: partner.fcmToken,
                title: senderName,
                body: messagePreview,
                data: { type: 'message', relationshipId: String(data.relationshipId), senderId: String(userId) },
              });
            }
          }
        }
      } catch (err) {
        console.error('[Socket] FCM send failed:', err.message);
      }
    });

    socket.on('message:typing', (data) => {
      if (!ownsRelationship(user, data.relationshipId)) return;
      socket.to(`relationship:${data.relationshipId}`).emit('partner:typing', { isTyping: data.isTyping });
    });

    socket.on('mood:update', (data) => {
      if (!ownsRelationship(user, data.relationshipId)) return;
      socket.to(`relationship:${data.relationshipId}`).emit('partner:mood', data);
    });

    // ── Watch party (legacy) ──────────────────────────────────────────────
    socket.on('watch:start', (data) => {
      if (!ownsRelationship(user, data.relationshipId)) return;
      socket.to(`relationship:${data.relationshipId}`).emit('watch:start', data);
    });

    socket.on('watch:sync', (data) => {
      if (!ownsRelationship(user, data.relationshipId)) return;
      socket.to(`relationship:${data.relationshipId}`).emit('watch:sync', data);
    });

    // ── Watch Together — use user.relationshipId directly (already safe) ──
    socket.on('watchTogether:setVideo', async (data) => {
      if (!user?.relationshipId) return;
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:setVideo', data);
      if (!user?.partnerId) return;
      try {
        const partnerPresence = await Presence.findOne({ userId: user.partnerId });
        const senderName = user.nickname || user.name || 'Partner';
        if (!partnerPresence?.isOnline) {
          const partner = await User.findById(user.partnerId).select('fcmToken');
          if (partner?.fcmToken) {
            await sendPushNotification({
              fcmToken: partner.fcmToken,
              title: `🎬 ${senderName}`,
              body: 'Watch Together pe aao! Video shuru ho gayi',
              data: { type: 'watchTogether', videoId: String(data?.id ?? ''), relationshipId: String(user.relationshipId) },
            });
          }
        }
      } catch (err) {
        console.error('[Socket] watchTogether:setVideo FCM failed:', err.message);
      }
    });

    socket.on('watchTogether:play', async (data) => {
      if (!user?.relationshipId) return;
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:play', data);
      if (!user?.partnerId) return;
      try {
        const partnerPresence = await Presence.findOne({ userId: user.partnerId });
        if (!partnerPresence?.isOnline) {
          const partner = await User.findById(user.partnerId).select('fcmToken');
          const senderName = user.nickname || user.name || 'Partner';
          if (partner?.fcmToken) {
            await sendPushNotification({
              fcmToken: partner.fcmToken,
              title: `▶️ ${senderName}`,
              body: 'Video play ki — join karo Watch Together!',
              data: { type: 'watchTogether', videoId: String(data?.videoId ?? ''), relationshipId: String(user.relationshipId) },
            });
          }
        }
      } catch (err) {
        console.error('[Socket] watchTogether:play FCM failed:', err.message);
      }
    });

    socket.on('watchTogether:pause', (data) => {
      if (!user?.relationshipId) return;
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:pause', data);
    });

    socket.on('watchTogether:seek', (data) => {
      if (!user?.relationshipId) return;
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:seek', data);
    });

    socket.on('watchTogether:leave', async () => {
      if (!user?.relationshipId) return;
      const senderName = user.nickname || user.name || 'Partner';
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:leave', {
        name: senderName,
      });
      if (!user?.partnerId) return;
      try {
        const partner = await User.findById(user.partnerId).select('fcmToken');
        if (partner?.fcmToken) {
          await sendPushNotification({
            fcmToken: partner.fcmToken,
            title: `👋 ${senderName}`,
            body: 'Watch Together session chhod diya',
            data: { type: 'watchTogether_leave', relationshipId: String(user.relationshipId) },
          });
        }
      } catch (err) {
        console.error('[Socket] watchTogether:leave FCM failed:', err.message);
      }
    });

    // ── Music ─────────────────────────────────────────────────────────────────
    socket.on('music:update', async (data) => {
      if (!ownsRelationship(user, data.relationshipId)) return;
      const room = `relationship:${data.relationshipId}`;
      io.to(room).emit('music:sync', data);
      if ((data.action === 'play' || data.action === 'set_track') && user?.partnerId) {
        try {
          const partnerPresence = await Presence.findOne({ userId: user.partnerId });
          if (!partnerPresence?.isOnline) {
            const partner = await User.findById(user.partnerId).select('fcmToken');
            if (partner?.fcmToken) {
              const senderName = user.nickname || user.name || 'Partner';
              const trackName = data.track?.title || data.currentTrack?.title || 'a song';
              await sendPushNotification({
                fcmToken: partner.fcmToken,
                title: `🎵 ${senderName}`,
                body: `is listening to ${trackName}`,
                data: { type: 'music', relationshipId: String(data.relationshipId) },
              });
            }
          }
        } catch (_) {}
      }
    });

    socket.on('touch:send', (data) => {
      if (!ownsPartner(user, data.partnerId)) return;
      socket.to(`user:${data.partnerId}`).emit('touch:received', { from: userId });
    });

    socket.on('heartbeat:sync', (data) => {
      if (!ownsRelationship(user, data.relationshipId)) return;
      socket.to(`relationship:${data.relationshipId}`).emit('heartbeat:sync', { from: userId });
    });

    socket.on('presence:heartbeat', async () => {
      await Presence.findOneAndUpdate({ userId }, { lastHeartbeat: new Date() });
    });

    socket.on('disconnect', async () => {
      const now = new Date();
      await Promise.all([
        Presence.findOneAndUpdate({ userId }, { isOnline: false, lastSeen: now, socketId: '' }),
        User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: now }),
      ]);
      if (user?.relationshipId) {
        socket.to(`relationship:${user.relationshipId}`).emit('partner:offline', { userId });
      }
    });

    // ── Call signaling ────────────────────────────────────────────────────
    require('./call.socket')(io, socket);
  });
};
