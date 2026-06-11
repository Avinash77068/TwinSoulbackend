require('dotenv').config();

// Global crash guards — keep server alive on unhandled errors
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err.message, err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const connectDB = require('./src/config/db');
const { errorHandler, notFound } = require('./src/middleware/errorHandler');

connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});

require('./src/sockets/socket.handler')(io);

app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, message: { success: false, message: 'Too many requests' } });
app.use('/api', limiter);

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'SoulSync API is running ❤️', version: '1.0.0', timestamp: new Date() });
});

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/relationship', require('./src/routes/relationship.routes'));
app.use('/api/chat', require('./src/routes/chat.routes'));
app.use('/api/music', require('./src/routes/music.routes'));
app.use('/api/photos', require('./src/routes/photos.routes'));
app.use('/api/diary', require('./src/routes/diary.routes'));
app.use('/api/scheduled', require('./src/routes/scheduled.routes'));
app.use('/api/capsule', require('./src/routes/capsule.routes'));
app.use('/api/mood', require('./src/routes/mood.routes'));
app.use('/api/midnight', require('./src/routes/midnight.routes'));
app.use('/api/lovetree', require('./src/routes/lovetree.routes'));
app.use('/api/levels', require('./src/routes/levels.routes'));
app.use('/api/timeline', require('./src/routes/timeline.routes'));
app.use('/api/games', require('./src/routes/games.routes'));
app.use('/api/ai', require('./src/routes/ai.routes'));
app.use('/api/notifications', require('./src/routes/notifications.routes'));
app.use('/api/presence', require('./src/routes/presence.routes'));

app.use(notFound);
app.use(errorHandler);

// Cron: deliver scheduled messages every minute
cron.schedule('* * * * *', async () => {
  try {
    const ScheduledMessage = require('./src/models/ScheduledMessage');
    const Message = require('./src/models/Message');
    const pending = await ScheduledMessage.find({
      scheduledAt: { $lte: new Date() },
      isDelivered: false,
      isCancelled: false,
    });
    for (const sm of pending) {
      await Message.create({
        relationshipId: sm.relationshipId,
        senderId: sm.senderId,
        content: sm.content,
        type: sm.type,
        mediaUrl: sm.mediaUrl,
      });
      sm.isDelivered = true;
      sm.deliveredAt = new Date();
      await sm.save();
      io.to(`relationship:${sm.relationshipId}`).emit('message:new', { content: sm.content, type: 'scheduled' });
    }
    if (pending.length > 0) console.log(`Delivered ${pending.length} scheduled message(s)`);
  } catch (err) {
    console.error('Cron error:', err.message);
  }
});

// Cron: mark users offline if no heartbeat for 2 minutes
cron.schedule('*/2 * * * *', async () => {
  try {
    const Presence = require('./src/models/Presence');
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    await Presence.updateMany(
      { isOnline: true, lastHeartbeat: { $lt: cutoff } },
      { isOnline: false, lastSeen: new Date() }
    );
  } catch (err) {
    console.error('Presence cron error:', err.message);
  }
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`SoulSync server running on port ${PORT} ❤️`));
