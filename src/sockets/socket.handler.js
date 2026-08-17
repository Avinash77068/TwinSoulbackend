const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Presence = require('../models/Presence');
const Notification = require('../models/Notification');
const sendPushNotification = require('../utils/sendPushNotification');
const callHandlers = require('./call.socket');

// Persist an in-app notification-inbox row alongside every push send below —
// keeps the notifications list in sync with whatever actually reached the partner.
const recordNotification = (userId, relationshipId, type, title, body, data) =>
  Notification.create({ userId, relationshipId, type, title, body, data }).catch(() => {});

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

    /**
     * Real-time delivery ONLY — deliberately does not touch the database.
     *
     * Persistence is the REST bulk endpoint's job: the client batches messages
     * in a local outbox and flushes them on a threshold/interval. That split is
     * the whole point of the design — a chat message now costs one in-memory
     * relay (sub-millisecond) instead of the five awaits createAndPersistMessage
     * performs (insert, $push onto the sender, countDocuments, tree points, XP).
     *
     * The ack carries no server document, only the id the CLIENT minted. There
     * is no server id to hand back yet, and the client does not need one: its
     * own clientMessageId is the identity the bulk upsert reconciles on.
     */
    socket.on('message:send', async (data, ack) => {
      const reply = (payload) => { if (typeof ack === 'function') ack(payload); };
      const clientMessageId = data?.clientMessageId;

      if (!ownsRelationship(user, data?.relationshipId)) {
        return reply({ success: false, clientMessageId, error: 'Not authorized' });
      }
      if (!clientMessageId || typeof clientMessageId !== 'string') {
        return reply({ success: false, clientMessageId, error: 'clientMessageId required' });
      }

      // Shaped like a persisted message so the receiver renders it with no
      // special-casing, but marked unsynced: it exists only in memory on both
      // devices until the sender's outbox flush stores it.
      const relayed = {
        clientMessageId,
        _id: clientMessageId,
        relationshipId: String(data.relationshipId),
        senderId: {
          _id: String(userId),
          name: user.name,
          nickname: user.nickname,
          profilePhoto: user.profilePhoto,
          bubbleColor: user.bubbleColor,
        },
        content: data.content || '',
        type: data.type || 'text',
        mediaUrl: data.mediaUrl || '',
        replyTo: data.replyTo || null,
        isSecret: !!data.isSecret,
        reactions: [],
        clientSentAt: data.clientSentAt || new Date().toISOString(),
        createdAt: data.clientSentAt || new Date().toISOString(),
        pendingSync: true,
      };

      // Ack first, deliver second: the sender's "sent" tick should not wait on
      // fan-out to the partner.
      reply({ success: true, clientMessageId, deliveredAt: new Date().toISOString() });
      socket.to(`relationship:${data.relationshipId}`).emit('message:new', relayed);

      // Push only when the partner is not connected. Unchanged in intent, but
      // now fire-and-forget so a slow FCM round trip cannot delay the relay.
      (async () => {
        try {
          if (!user?.partnerId) return;
          const partnerPresence = await Presence.findOne({ userId: user.partnerId });
          if (partnerPresence?.isOnline) return;
          const partner = await User.findById(user.partnerId).select('fcmToken');
          if (!partner?.fcmToken) return;
          const preview =
            relayed.type === 'text' ? relayed.content?.slice(0, 100)
            : relayed.type === 'photo' ? '📷 Photo'
            : relayed.type === 'voice' ? '🎤 Voice message'
            : '💬 New message';
          const senderName = user.nickname || user.name || 'Partner';
          await Promise.all([
            sendPushNotification({
              fcmToken: partner.fcmToken,
              title: senderName,
              body: preview,
              data: { type: 'message', relationshipId: String(data.relationshipId), senderId: String(userId) },
            }),
            recordNotification(user.partnerId, data.relationshipId, 'message', senderName, preview, {
              type: 'message', relationshipId: String(data.relationshipId), senderId: String(userId),
            }),
          ]);
        } catch (err) {
          console.error('[Socket] FCM send failed:', err.message);
        }
      })();
    });

    /**
     * Delivery receipt — the RECIPIENT's device confirming it holds the message.
     *
     * This is what separates "sent" (the server relayed it) from "delivered"
     * (the other phone actually has it), the same distinction WhatsApp's one
     * versus two ticks draws. Only the recipient can report it, so it has to
     * come back up from their client rather than being inferred at the relay.
     *
     * Ids only — no content — so a receipt cannot be used to inject or alter a
     * message, and it stays cheap enough to send per batch of arrivals.
     */
    socket.on('message:delivered', (data) => {
      if (!ownsRelationship(user, data?.relationshipId)) return;
      const ids = Array.isArray(data.clientMessageIds) ? data.clientMessageIds.filter(id => typeof id === 'string') : [];
      if (!ids.length) return;
      socket.to(`relationship:${data.relationshipId}`).emit('message:delivered', {
        clientMessageIds: ids,
        deliveredAt: new Date().toISOString(),
      });
    });

    /**
     * Read receipt for messages that are not yet in the database.
     *
     * The REST markRead endpoint covers persisted messages, but between relay
     * and the sender's next bulk flush a message has no row to update — so the
     * blue ticks would only appear after a sync. This carries the same signal
     * live.
     */
    socket.on('message:read', (data) => {
      if (!ownsRelationship(user, data?.relationshipId)) return;
      const ids = Array.isArray(data.clientMessageIds) ? data.clientMessageIds.filter(id => typeof id === 'string') : [];
      socket.to(`relationship:${data.relationshipId}`).emit('message:read', {
        clientMessageIds: ids,
        readAt: new Date().toISOString(),
      });
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

    // ── Watch Together ────────────────────────────────────────────────────
    // FCM always sent — isOnline check skipped because partner can be socket-connected
    // but still in background/different screen and miss the socket event.

    socket.on('watchTogether:setVideo', async (data) => {
      if (!user?.relationshipId || !user?.partnerId) return;
      const senderName = user.nickname || user.name || 'Partner';
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:setVideo', {
        id: data?.id, title: data?.title ?? '', isPlaying: data?.isPlaying ?? true,
      });
      try {
        const title = `🎬 ${senderName}`;
        const body = data?.title ? `"${data.title}" laga diya — dekho saath!` : 'Watch Together pe video laga diya!';
        const pushData = { type: 'watchTogether', relationshipId: String(user.relationshipId) };
        recordNotification(user.partnerId, user.relationshipId, 'watchTogether', title, body, { ...pushData, action: 'setVideo' });
        const partner = await User.findById(user.partnerId).select('fcmToken');
        if (partner?.fcmToken) {
          await sendPushNotification({ fcmToken: partner.fcmToken, title, body, data: pushData });
        }
      } catch (err) {
        console.error('[Socket] watchTogether:setVideo FCM failed:', err.message);
      }
    });

    socket.on('watchTogether:play', async (data) => {
      if (!user?.relationshipId || !user?.partnerId) return;
      const senderName = user.nickname || user.name || 'Partner';
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:play', {
        title: data?.title ?? '',
        currentTime: data?.currentTime,
        videoId: data?.videoId,
      });
      try {
        const title = `▶️ ${senderName}`;
        const body = data?.title ? `"${data.title}" play kiya — join karo!` : 'Watch Together pe play kiya!';
        const pushData = { type: 'watchTogether', relationshipId: String(user.relationshipId) };
        recordNotification(user.partnerId, user.relationshipId, 'watchTogether', title, body, { ...pushData, action: 'play' });
        const partner = await User.findById(user.partnerId).select('fcmToken');
        if (partner?.fcmToken) {
          await sendPushNotification({ fcmToken: partner.fcmToken, title, body, data: pushData });
        }
      } catch (err) {
        console.error('[Socket] watchTogether:play FCM failed:', err.message);
      }
    });

    socket.on('watchTogether:pause', async (data) => {
      if (!user?.relationshipId || !user?.partnerId) return;
      const senderName = user.nickname || user.name || 'Partner';
      // Include server timestamp so frontend can show "X sec pehle"
      const pausedAt = Date.now();
      // Same drop as `play` above — `currentTime` must reach the partner or
      // their resync check can never run.
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:pause', {
        title: data?.title ?? '', pausedAt,
        currentTime: data?.currentTime,
      });
      try {
        const title = `⏸️ ${senderName}`;
        const body = data?.title ? `"${data.title}" pause kar diya` : 'Watch Together pe video pause kar diya';
        const pushData = { type: 'watchTogether', relationshipId: String(user.relationshipId) };
        recordNotification(user.partnerId, user.relationshipId, 'watchTogether', title, body, { ...pushData, action: 'pause' });
        const partner = await User.findById(user.partnerId).select('fcmToken');
        if (partner?.fcmToken) {
          await sendPushNotification({ fcmToken: partner.fcmToken, title, body, data: pushData });
        }
      } catch (err) {
        console.error('[Socket] watchTogether:pause FCM failed:', err.message);
      }
    });

    /**
     * Scrubbing the timeline. Previously had no server handler at all — the
     * client only ever had a listener for the INCOMING side, nothing emitted
     * it and nothing relayed it, so dragging the progress bar never reached
     * the partner.
     *
     * No push notification, unlike the other watchTogether events: a scrub is
     * a live in-session correction, not something worth interrupting someone
     * for if they've stepped away — and it can fire several times a minute.
     */
    socket.on('watchTogether:seek', (data) => {
      if (!user?.relationshipId) return;
      if (typeof data?.currentTime !== 'number') return;
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:seek', {
        currentTime: data.currentTime,
      });
    });

    socket.on('watchTogether:join', async () => {
      if (!user?.relationshipId || !user?.partnerId) return;
      const senderName = user.nickname || user.name || 'Partner';
      const joinedAt = Date.now();
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:join', {
        name: senderName, joinedAt,
      });
      try {
        const title = `🎬 ${senderName}`;
        const body = 'Watch Together pe aao! Abhi join karo';
        const pushData = { type: 'watchTogether', relationshipId: String(user.relationshipId) };
        recordNotification(user.partnerId, user.relationshipId, 'watchTogether', title, body, { ...pushData, action: 'join' });
        const partner = await User.findById(user.partnerId).select('fcmToken');
        if (partner?.fcmToken) {
          await sendPushNotification({ fcmToken: partner.fcmToken, title, body, data: pushData });
        }
      } catch (err) {
        console.error('[Socket] watchTogether:join FCM failed:', err.message);
      }
    });

    socket.on('watchTogether:leave', async () => {
      if (!user?.relationshipId) return;
      const senderName = user.nickname || user.name || 'Partner';
      socket.to(`relationship:${user.relationshipId}`).emit('watchTogether:leave', {
        name: senderName, leftAt: Date.now(),
      });
      if (!user?.partnerId) return;
      try {
        const title = `👋 ${senderName}`;
        const body = 'Watch Together session chhod diya';
        const pushData = { type: 'watchTogether_leave', relationshipId: String(user.relationshipId) };
        recordNotification(user.partnerId, user.relationshipId, 'watchTogether', title, body, { ...pushData, action: 'leave' });
        const partner = await User.findById(user.partnerId).select('fcmToken');
        if (partner?.fcmToken) {
          await sendPushNotification({ fcmToken: partner.fcmToken, title, body, data: pushData });
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
            const senderName = user.nickname || user.name || 'Partner';
            const trackName = data.track?.title || data.currentTrack?.title || 'a song';
            const title = `🎵 ${senderName}`;
            const body = `is listening to ${trackName}`;
            const pushData = { type: 'music', relationshipId: String(data.relationshipId) };
            recordNotification(user.partnerId, data.relationshipId, 'music', title, body, pushData);
            const partner = await User.findById(user.partnerId).select('fcmToken');
            if (partner?.fcmToken) {
              await sendPushNotification({ fcmToken: partner.fcmToken, title, body, data: pushData });
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

    // App backgrounded/foregrounded — flips presence immediately instead of
    // waiting on the socket's transport-level disconnect (which can lag tens
    // of seconds behind the app actually leaving the foreground, during which
    // push notifications would be wrongly skipped as "partner is online").
    socket.on('presence:background', async () => {
      await Presence.findOneAndUpdate({ userId }, { isOnline: false, lastSeen: new Date() });
      if (user?.relationshipId) {
        socket.to(`relationship:${user.relationshipId}`).emit('partner:offline', { userId });
      }
    });

    socket.on('presence:foreground', async () => {
      await Presence.findOneAndUpdate(
        { userId },
        { isOnline: true, lastHeartbeat: new Date(), socketId: socket.id },
        { upsert: true },
      );
      if (user?.relationshipId) {
        socket.to(`relationship:${user.relationshipId}`).emit('partner:online', { userId });
      }
    });

    socket.on('disconnect', async () => {
      let superseded = false;
      try {
        const presence = await Presence.findOne({ userId }).select('socketId').lean();
        superseded = !!(presence?.socketId && presence.socketId !== socket.id);
        if (superseded) return;

        const now = new Date();
        await Promise.all([
          Presence.findOneAndUpdate({ userId }, { isOnline: false, lastSeen: now, socketId: '' }),
          User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: now }),
        ]);
        if (user?.relationshipId) {
          socket.to(`relationship:${user.relationshipId}`).emit('partner:offline', { userId });
        }
      } catch (err) {
        console.error('[Socket] disconnect cleanup failed:', err.message);
      } finally {
        if (!superseded) callHandlers.onUserDisconnect(io, userId);
      }
    });

    // ── Call signaling ────────────────────────────────────────────────────
    callHandlers(io, socket);
  });
};
