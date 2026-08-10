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
const connectDB = require('./src/config/db');
const { initRedis } = require('./src/cache/redisClient');
const { errorHandler, notFound } = require('./src/middleware/errorHandler');

connectDB();
initRedis();

const app = express();
const server = http.createServer(app);

// ── CORS origins ────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:8081']; // RN metro dev server

const io = new Server(server, {
  cors: { origin: ALLOWED_ORIGINS, methods: ['GET', 'POST'] },
  // Heartbeat: ping every 60 s, allow 30 s for pong.
  // Default is 25 s / 20 s — halving frequency cuts idle WebSocket traffic by ~60%.
  pingInterval: 60_000,
  pingTimeout:  30_000,
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

// Static app assets (icons, images) served from backend
app.use('/assets', express.static(path.join(__dirname, 'public/assets')));

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

// Connecting is brute-forceable (couple code + numeric password), so it gets the
// strict limiter rather than the general one.
const connectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: 'Too many connection attempts, try again later' },
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
// Password reset is unauthenticated and guesses a 6-digit code, so it gets the
// strict limiter. The controller additionally caps attempts per account and
// enforces a resend cooldown, so a rotating-IP attacker gains nothing.
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/verify-reset-otp', authLimiter);
app.use('/api/auth/reset-password', authLimiter);
app.use('/api/relationship/connect', connectLimiter);
app.use('/api/invite', connectLimiter);
app.use('/api/discover/interest', connectLimiter);
app.use('/api', apiLimiter);

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'SoulSync API running ❤️', version: '1.0.0', timestamp: new Date() });
});

app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/relationship', require('./src/routes/relationship.routes'));
app.use('/api/invite', require('./src/routes/invite.routes'));
app.use('/api/archive', require('./src/routes/archive.routes'));
app.use('/api/discover', require('./src/routes/discovery.routes'));
app.use('/api/premium', require('./src/routes/premium.routes'));
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
app.use('/api/custom-questions', require('./src/routes/customQuestion.routes'));
app.use('/api/ai', require('./src/routes/ai.routes'));
app.use('/api/notifications', require('./src/routes/notifications.routes'));
app.use('/api/presence', require('./src/routes/presence.routes'));
app.use('/api/youtube', require('./src/routes/youtube.routes'));
app.use('/api/theme',  require('./src/routes/theme.routes'));
app.use('/api/calls',  require('./src/routes/call.routes'));
app.use('/api/feedback', require('./src/routes/feedback.routes'));
app.use('/api/goals', require('./src/routes/goals.routes'));
app.use('/api/legal', require('./src/routes/legal.routes'));

// ── Invite links ─────────────────────────────────────────────────────────────
// Web fallback for https://<host>/i/<token>. App Links / Universal Links open
// the app directly; this page is what someone without the app installed sees,
// and it carries the token through to the store so the invite survives install.
app.use('/', require('./src/routes/inviteLanding.routes'));

// Association files that make App Links / Universal Links verify.
app.get('/.well-known/assetlinks.json', (req, res) => {
  res.type('application/json').send(require('./src/config/appLinks').assetLinks());
});
app.get('/.well-known/apple-app-site-association', (req, res) => {
  res.type('application/json').send(require('./src/config/appLinks').appleAppSiteAssociation());
});

app.use(notFound);
app.use(errorHandler);

// ── Scheduled jobs ───────────────────────────────────────────────────────────
// All jobs run behind a Mongo advisory lock (see src/jobs/index.js) so a second
// instance cannot double-deliver messages or double-send anniversary pushes.
require('./src/jobs').registerJobs(io);

const PORT = process.env.PORT || 8000;
server.listen(PORT, () => console.log(`SoulSync server running on port ${PORT} ❤️`));
