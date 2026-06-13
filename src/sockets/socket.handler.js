const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Presence = require('../models/Presence');
const sendPushNotification = require('../utils/sendPushNotification');

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
    console.log(`Socket connected: ${userId}`);

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
      // notify partner that this user came online
      socket.to(`relationship:${user.relationshipId}`).emit('partner:online', { userId });
    }
    socket.join(`user:${userId}`);

    socket.on('message:send', async (data) => {
      socket.to(`relationship:${data.relationshipId}`).emit('message:new', data);

      // FCM: notify partner if they are offline
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
                  : data.type === 'image'
                  ? '📷 Photo'
                  : data.type === 'voice'
                  ? '🎤 Voice message'
                  : '💬 New message';

              await sendPushNotification({
                fcmToken: partner.fcmToken,
                title: senderName,
                body: messagePreview,
                data: {
                  type: 'message',
                  relationshipId: String(data.relationshipId),
                  senderId: String(userId),
                },
              });
            }
          }
        }
      } catch (err) {
        console.error('[Socket FCM Error]', err.message);
      }
    });

    socket.on('message:typing', (data) => {
      socket.to(`relationship:${data.relationshipId}`).emit('partner:typing', { isTyping: data.isTyping });
    });

    socket.on('mood:update', (data) => {
      socket.to(`relationship:${data.relationshipId}`).emit('partner:mood', data);
    });

    socket.on('music:update', (data) => {
      socket.to(`relationship:${data.relationshipId}`).emit('music:sync', data);
    });

    socket.on('touch:send', (data) => {
      socket.to(`user:${data.partnerId}`).emit('touch:received', { from: userId });
    });

    socket.on('heartbeat:sync', (data) => {
      socket.to(`relationship:${data.relationshipId}`).emit('heartbeat:sync', { from: userId });
    });

    socket.on('presence:heartbeat', async () => {
      await Presence.findOneAndUpdate({ userId }, { lastHeartbeat: new Date() });
    });

    socket.on('disconnect', async () => {
      console.log(`Socket disconnected: ${userId}`);
      const now = new Date();
      await Promise.all([
        Presence.findOneAndUpdate(
          { userId },
          { isOnline: false, lastSeen: now, socketId: '' }
        ),
        User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: now }),
      ]);
      if (user?.relationshipId) {
        socket.to(`relationship:${user.relationshipId}`).emit('partner:offline', { userId });
      }
    });
  });
};
