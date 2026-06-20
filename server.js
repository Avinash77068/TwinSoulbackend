require('dotenv').config({ path: `${__dirname}/.env` });

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
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const rateLimit = require('express-rate-limit');
const cron = require('node-cron');
const connectDB = require('./src/config/db');
const { errorHandler, notFound } = require('./src/middleware/errorHandler');

connectDB();

const app = express();
const server = http.createServer(app);

// ── CORS origins ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:8081']; // RN metro dev server

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
});

require('./src/sockets/socket.handler')(io);
require('./src/config/socketInstance').setIo(io);

// ── Security & perf middleware ────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off — mobile API, no browser HTML
app.use(compression());
app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Static uploads kept for backward compat with old file URLs
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.set('trust proxy', 1);

// Strict limit for auth routes (prevent brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many attempts, try again later' },
});

// General API limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  message: { success: false, message: 'Too many requests' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api', apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'TwinSoul API running ❤️', version: '1.0.0', timestamp: new Date() });
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
app.use('/api/youtube', require('./src/routes/youtube.routes'));

app.use(notFound);
app.use(errorHandler);

// ── Cron: deliver scheduled messages ─────────────────────────────────────────
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
    if (pending.length > 0) console.log(`[Cron] Delivered ${pending.length} scheduled message(s)`);
  } catch (err) {
    console.error('[Cron] Scheduled messages error:', err.message);
  }
});

// ── Cron: mark users offline after 2min no heartbeat ─────────────────────────
cron.schedule('*/2 * * * *', async () => {
  try {
    const Presence = require('./src/models/Presence');
    const cutoff = new Date(Date.now() - 2 * 60 * 1000);
    await Presence.updateMany(
      { isOnline: true, lastHeartbeat: { $lt: cutoff } },
      { isOnline: false, lastSeen: new Date() }
    );
  } catch (err) {
    console.error('[Cron] Presence error:', err.message);
  }
});

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`TwinSoul server running on port ${PORT} ❤️`));
