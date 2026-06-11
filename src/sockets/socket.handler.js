const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Presence = require('../models/Presence');

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

    await Presence.findOneAndUpdate(
      { userId },
      { isOnline: true, lastHeartbeat: new Date(), socketId: socket.id },
      { upsert: true }
    );

    const user = await User.findById(userId);
    if (user?.relationshipId) {
      socket.join(`relationship:${user.relationshipId}`);
    }
    socket.join(`user:${userId}`);

    socket.on('message:send', (data) => {
      socket.to(`relationship:${data.relationshipId}`).emit('message:new', data);
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
      await Presence.findOneAndUpdate(
        { userId },
        { isOnline: false, lastSeen: new Date(), socketId: '' }
      );
      if (user?.relationshipId) {
        socket.to(`relationship:${user.relationshipId}`).emit('partner:offline', { userId });
      }
    });
  });
};
