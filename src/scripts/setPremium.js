/**
 * Grant or revoke premium directly in the database.
 *
 * There is no billing integration, so this is the intended way to manage premium
 * for now. It talks to Mongo only — the API does not need to be running, and no
 * env switch needs to be flipped.
 *
 * Usage:
 *   node src/scripts/setPremium.js --email a@b.com --days 30
 *   node src/scripts/setPremium.js --email a@b.com --forever
 *   node src/scripts/setPremium.js --email a@b.com --revoke
 *   node src/scripts/setPremium.js --list
 *
 * npm:
 *   npm run premium -- --email a@b.com --days 30
 */

require('dotenv').config({ path: `${__dirname}/../../.env` });
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : (argv[i + 1] ?? true);
};
const has = (name) => argv.includes(`--${name}`);

const usage = () => {
  console.log(`
Manage premium entitlement (DB only — no API, no env changes).

  --email <addr>   target user (required unless --list)
  --days <n>       grant premium for n days
  --forever        grant premium with no expiry
  --revoke         remove premium
  --list           show all current premium users

Examples:
  node src/scripts/setPremium.js --email a@b.com --days 30
  node src/scripts/setPremium.js --email a@b.com --forever
  node src/scripts/setPremium.js --email a@b.com --revoke
  node src/scripts/setPremium.js --list
`);
};

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('✗ MONGO_URI missing from .env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const User = require('../models/User');

  // ── List ──────────────────────────────────────────────────────────────────
  if (has('list')) {
    const users = await User.find({ isPremium: true })
      .select('email name premiumUntil partnerStatus discoveryOptIn')
      .lean();
    if (!users.length) {
      console.log('No premium users.');
    } else {
      console.log(`${users.length} premium user(s):\n`);
      for (const u of users) {
        const expiry = u.premiumUntil
          ? new Date(u.premiumUntil) > new Date()
            ? `until ${new Date(u.premiumUntil).toISOString().slice(0, 10)}`
            : `EXPIRED ${new Date(u.premiumUntil).toISOString().slice(0, 10)}`
          : 'no expiry';
        console.log(
          `  ${u.email.padEnd(32)} ${expiry.padEnd(24)} ${u.partnerStatus}` +
            `${u.discoveryOptIn ? ' · discoverable' : ''}`,
        );
      }
    }
    await mongoose.disconnect();
    return;
  }

  const email = flag('email');
  if (!email || email === true) {
    usage();
    await mongoose.disconnect();
    process.exit(1);
  }

  const user = await User.findOne({ email: String(email).toLowerCase() });
  if (!user) {
    console.error(`✗ No user with email ${email}`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── Revoke ────────────────────────────────────────────────────────────────
  if (has('revoke')) {
    user.isPremium = false;
    user.premiumUntil = null;
    await user.save();
    console.log(`✓ Premium revoked for ${user.email}`);
    await mongoose.disconnect();
    return;
  }

  // ── Grant ─────────────────────────────────────────────────────────────────
  let premiumUntil = null;
  if (!has('forever')) {
    const days = Number(flag('days')) || Number(process.env.DEFAULT_PREMIUM_DAYS) || 30;
    if (!Number.isFinite(days) || days <= 0) {
      console.error('✗ --days must be a positive number');
      await mongoose.disconnect();
      process.exit(1);
    }
    premiumUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  user.isPremium = true;
  user.premiumUntil = premiumUntil;
  await user.save();

  console.log(
    `✓ Premium granted to ${user.email} — ${
      premiumUntil ? `until ${premiumUntil.toISOString().slice(0, 10)}` : 'no expiry'
    }`,
  );
  console.log('  (hasPremium() checks the expiry at read time, so no cron is needed)');

  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('✗ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
