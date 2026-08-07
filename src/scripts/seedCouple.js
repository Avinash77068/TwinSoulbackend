/**
 * Seed test users and connect them as a couple, directly in the database.
 *
 * Why this exists: the normal way to get a partner is register → OTP → couple
 * code → partner approves. That needs two real devices and a working mailer, so
 * there is no practical way to see any partner-dependent screen (Dashboard,
 * Chat, Love Tree, Timeline) while developing solo. This script produces the
 * SAME end state as a real connection and needs neither the API running nor an
 * email inbox.
 *
 * It deliberately does NOT hand-write partnerId/isConnected. It builds a pending
 * Relationship and hands it to relationship.service.activateRelationship — the
 * exact function the couple-code and invite-token flows call. So the seeded
 * couple also gets its LoveTree, RelationshipLevel and "First Connection"
 * timeline event, and it cannot drift from the real flow as that flow changes.
 *
 * Usage:
 *   # attach a fresh dummy partner to an account you already log in with
 *   node src/scripts/seedCouple.js --email you@example.com
 *
 *   # create BOTH users from scratch and connect them
 *   node src/scripts/seedCouple.js --pair
 *
 *   # backdate the relationship so daysTogether / streaks aren't zero
 *   node src/scripts/seedCouple.js --email you@example.com --days 180
 *
 *   # inspect / undo
 *   node src/scripts/seedCouple.js --list
 *   node src/scripts/seedCouple.js --unlink --email you@example.com
 *
 * npm:
 *   npm run seed:couple -- --email you@example.com
 */

require('dotenv').config({ path: `${__dirname}/../../.env` });
const mongoose = require('mongoose');
const crypto = require('crypto');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (argv[i + 1] ?? true);
};
const str = (name) => {
  const v = flag(name);
  return typeof v === 'string' ? v : undefined;
};
const has = (name) => argv.includes(`--${name}`);

/** Anything seeded gets this password, so you never have to guess at the login screen. */
const DEFAULT_PASSWORD = 'Test@1234';

/** Defaults for --pair, chosen so the two sides are obvious on screen. */
const DEFAULT_A = { email: 'aarav.test@twinsoul.dev', name: 'Aarav', nickname: 'Aaru' };
const DEFAULT_B = { email: 'meera.test@twinsoul.dev', name: 'Meera', nickname: 'Mimi' };

const DAY_MS = 24 * 60 * 60 * 1000;

const usage = () => {
  console.log(`
Seed test users and connect them as a couple (DB only — API need not be running).

  --email <addr>     existing account to attach a dummy partner to
  --partner <addr>   email for the dummy partner   (default: ${DEFAULT_B.email})
  --pair             create BOTH users from scratch and connect them
  --name <n>         name for the dummy partner    (default: ${DEFAULT_B.name})
  --days <n>         backdate the relationship n days, so daysTogether = n
  --password <pw>    password for users this script creates (default: ${DEFAULT_PASSWORD})
  --list             show every connected couple and every unconnected user
  --unlink --email <addr>
                     tear the couple down again (keeps both user accounts)

Examples:
  node src/scripts/seedCouple.js --email you@example.com
  node src/scripts/seedCouple.js --email you@example.com --days 180
  node src/scripts/seedCouple.js --pair
  node src/scripts/seedCouple.js --list
  node src/scripts/seedCouple.js --unlink --email you@example.com
`);
};

/**
 * Same alphabet and CSPRNG as auth.controller's generator (ambiguous characters
 * like O/0 and I/1 excluded because couple codes get read aloud and retyped).
 * Duplicated rather than imported: the controller keeps it private, and pulling
 * in the controller would drag in the whole express/mailer surface for six chars.
 */
const generateCoupleCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[crypto.randomInt(0, chars.length)];
  return code;
};

const uniqueCoupleCode = async (User) => {
  for (let i = 0; i < 20; i++) {
    const code = generateCoupleCode();
    if (!(await User.findOne({ coupleCode: code }).lean())) return code;
  }
  throw new Error('Could not generate a unique couple code after 20 attempts');
};

/**
 * Fetch a user by email, creating them if absent.
 *
 * `isVerified: true` because the OTP step is exactly what we are bypassing — a
 * user without it cannot log in. The password is assigned in plaintext on
 * purpose: the model's pre-save hook bcrypts it, so hashing here would
 * double-hash and lock the account out.
 */
const findOrCreateUser = async ({ User, Presence, email, name, nickname, password }) => {
  const lower = String(email).toLowerCase();
  const existing = await User.findOne({ email: lower });
  if (existing) return { user: existing, created: false };

  const user = new User({
    name,
    nickname: nickname || name,
    email: lower,
    password,
    coupleCode: await uniqueCoupleCode(User),
    isVerified: true,
  });
  await user.save();

  // The real signup path creates this alongside the user; presence lookups
  // assume the row exists rather than upserting it.
  await Presence.updateOne({ userId: user._id }, { $setOnInsert: { userId: user._id } }, { upsert: true });

  return { user, created: true };
};

const label = (u) => `${u.nickname || u.name} <${u.email}>`;

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('✗ MONGO_URI missing from .env');
    process.exit(1);
  }

  await mongoose.connect(uri);

  const User = require('../models/User');
  const Presence = require('../models/Presence');
  const Relationship = require('../models/Relationship');
  const relationshipService = require('../services/relationship.service');

  // ── List ──────────────────────────────────────────────────────────────────
  if (has('list')) {
    const couples = await Relationship.find({ status: { $in: ['active', 'paused', 'ending'] } })
      .populate('user1 user2', 'name nickname email')
      .lean();

    if (!couples.length) {
      console.log('No live couples.\n');
    } else {
      console.log(`${couples.length} live couple(s):\n`);
      for (const r of couples) {
        const days = r.startDate ? Math.floor((Date.now() - new Date(r.startDate)) / DAY_MS) : 0;
        console.log(`  ${r.status.padEnd(8)} ${label(r.user1)}  ❤  ${r.user2 ? label(r.user2) : '(none)'}`);
        console.log(`  ${''.padEnd(8)} ${days} day(s) together · relationshipId ${r._id}\n`);
      }
    }

    const solo = await User.find({ isConnected: false }).select('name nickname email coupleCode').lean();
    if (solo.length) {
      console.log(`${solo.length} unconnected user(s):\n`);
      for (const u of solo) console.log(`  ${u.email.padEnd(34)} code ${u.coupleCode || '—'}`);
      console.log();
    }

    await mongoose.disconnect();
    return;
  }

  // ── Unlink ────────────────────────────────────────────────────────────────
  if (has('unlink')) {
    const email = str('email');
    if (!email) {
      console.error('✗ --unlink needs --email <addr>');
      await mongoose.disconnect();
      process.exit(1);
    }
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.error(`✗ No user with email ${email}`);
      await mongoose.disconnect();
      process.exit(1);
    }
    const rel = await relationshipService.findBlockingRelationship(user._id);
    if (!rel) {
      console.log(`${label(user)} is not in a live relationship — nothing to undo.`);
      await mongoose.disconnect();
      return;
    }

    // unlinkUsers only, not beginEnding: this is a test teardown, so we skip the
    // grace period, the breakup notification and the push to the other side.
    await relationshipService.unlinkUsers(rel);
    await Relationship.deleteOne({ _id: rel._id });
    console.log(`✓ Unlinked and removed relationship ${rel._id}`);
    console.log('  Both accounts still exist — re-run without --unlink to reconnect.');
    await mongoose.disconnect();
    return;
  }

  // ── Seed + connect ────────────────────────────────────────────────────────
  const password = str('password') || DEFAULT_PASSWORD;
  const emailA = str('email');

  if (!emailA && !has('pair')) {
    usage();
    await mongoose.disconnect();
    process.exit(1);
  }

  const days = Number(str('days') ?? 0);
  if (!Number.isFinite(days) || days < 0) {
    console.error('✗ --days must be zero or a positive number');
    await mongoose.disconnect();
    process.exit(1);
  }

  const specA = emailA ? { ...DEFAULT_A, email: emailA } : DEFAULT_A;
  const specB = {
    ...DEFAULT_B,
    email: str('partner') || DEFAULT_B.email,
    name: str('name') || DEFAULT_B.name,
  };
  if (specA.email.toLowerCase() === specB.email.toLowerCase()) {
    console.error('✗ Both sides resolved to the same email — pass a different --partner');
    await mongoose.disconnect();
    process.exit(1);
  }

  const a = await findOrCreateUser({ User, Presence, password, ...specA });
  const b = await findOrCreateUser({ User, Presence, password, ...specB });

  for (const { user, created } of [a, b]) {
    console.log(`${created ? '✓ created' : '· existing'}  ${label(user)}`);
  }

  // Refuse to hijack a live relationship. Without this the script would happily
  // repoint someone's partnerId and orphan their real relationship document.
  for (const { user } of [a, b]) {
    const blocking = await relationshipService.findBlockingRelationship(user._id);
    if (!blocking) continue;
    const other = blocking.partnerOf(user._id);
    const alreadyPaired = other && [a.user._id, b.user._id].some((id) => String(id) === String(other));
    if (alreadyPaired) continue;

    console.error(`\n✗ ${label(user)} is already in a ${blocking.status} relationship (${blocking._id}).`);
    console.error(`  Undo it first:  node src/scripts/seedCouple.js --unlink --email ${user.email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // Reuse any relationship that already exists between exactly these two, so
  // re-running is idempotent instead of piling up duplicates.
  let rel = await Relationship.findOne({
    $or: [
      { user1: a.user._id, user2: b.user._id },
      { user1: b.user._id, user2: a.user._id },
    ],
  });
  if (!rel) {
    rel = await Relationship.create({ user1: a.user._id, user2: b.user._id, status: 'pending' });
  }

  // Captured before activation, which resets startDate to today. Without this a
  // bare re-run would silently wipe a day count you had deliberately backdated.
  const priorStart = rel.startDate;

  // Does the whole real activation: flips both users to connected, sets
  // partnerId/relationshipId, creates LoveTree + RelationshipLevel, writes the
  // timeline event. The socket emits inside it no-op here because getIo() is
  // null outside the server process.
  await relationshipService.activateRelationship(rel, { continuePrevious: false });

  const start = days > 0 ? new Date(Date.now() - days * DAY_MS) : priorStart;
  if (start) {
    rel.startDate = start;
    await rel.save();
    // Mirrored onto both users because the profile screen reads its own copy
    // rather than the relationship's.
    await User.updateMany(
      { _id: { $in: [a.user._id, b.user._id] } },
      { $set: { relationshipStartDate: start } },
    );
    // Cached rollup is keyed off startDate; drop it so it recomputes on next read.
    await mongoose.connection
      .collection('relationshipstats')
      .deleteOne({ relationshipId: rel._id })
      .catch(() => {});
  }

  const daysTogether = rel.startDate ? Math.floor((Date.now() - new Date(rel.startDate)) / DAY_MS) : 0;

  console.log(`\n✓ Connected — relationshipId ${rel._id}`);
  console.log(`  status ${rel.status} · ${daysTogether} day(s) together\n`);
  console.log('Log in as either side (both see the other as partner):\n');
  for (const { user, created } of [a, b]) {
    console.log(`  ${user.email}`);
    console.log(`    password  ${created ? password : '(unchanged — this account already existed)'}`);
  }
  console.log('\nDashboard/Chat should now show a partner. If the app still shows none,');
  console.log('log out and back in — partnerId is baked into the cached user object.');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('✗ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
