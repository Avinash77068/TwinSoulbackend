/**
 * Backfill migration for the relationship lifecycle rework.
 *
 * Run:  node src/scripts/migrateRelationshipLifecycle.js [--dry]
 *
 * Safe to re-run — every step is idempotent.
 *
 * What it does:
 *   1. status 'ended' → 'archived', setting isArchived/archivedAt.
 *      `isArchived` and `archivedAt` existed in the schema but were NEVER written,
 *      so every previously-ended relationship has them unset.
 *   2. Repairs users who are linked to a relationship that is no longer live, and
 *      users flagged isConnected with no relationshipId (the old unilateral leave
 *      could leave accounts half-linked because the writes were not atomic).
 *   3. Hashes any remaining plaintext connectionPassword.
 *      NOTE: hashing is one-way, so the plaintext is no longer displayable. Users
 *      whose password is migrated here should use "Regenerate codes" (or an invite
 *      link) if they need to share it again. verifyConnectionPassword() also
 *      upgrades lazily on successful use, so running this is optional.
 *   4. Recomputes LoveTree.stage using the canonical thresholds — the app and the
 *      server previously disagreed (0/3/7/15/30/60 vs 0/50/200/500/1000/2000), and
 *      four controllers incremented points without ever updating the stage.
 */

require('dotenv').config({ path: `${__dirname}/../../.env` });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const DRY = process.argv.includes('--dry');
const log = (...a) => console.log(DRY ? '[dry]' : '[run]', ...a);

const run = async () => {
  await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
  console.log('Connected.\n');

  const Relationship = require('../models/Relationship');
  const User = require('../models/User');
  const LoveTree = require('../models/LoveTree');
  const { resolveStage } = require('../constants/progression');

  // ── 1. ended → archived ────────────────────────────────────────────────────
  const ended = await Relationship.find({ status: 'ended' });
  log(`Step 1: ${ended.length} relationship(s) with legacy status 'ended'`);
  for (const rel of ended) {
    if (DRY) continue;
    rel.status = 'archived';
    rel.isArchived = true;
    rel.archivedAt = rel.archivedAt || rel.endedAt || rel.updatedAt || new Date();
    await rel.save();
  }

  // Any archived row missing the flags.
  const missingFlags = await Relationship.find({
    status: 'archived',
    $or: [{ isArchived: { $ne: true } }, { archivedAt: null }],
  });
  log(`Step 1b: ${missingFlags.length} archived relationship(s) missing flags`);
  for (const rel of missingFlags) {
    if (DRY) continue;
    rel.isArchived = true;
    rel.archivedAt = rel.archivedAt || rel.updatedAt || new Date();
    await rel.save();
  }

  // ── 2. Repair half-linked users ────────────────────────────────────────────
  const linkedUsers = await User.find({ relationshipId: { $ne: null } }).select(
    '_id relationshipId partnerId isConnected'
  );
  let repaired = 0;
  for (const u of linkedUsers) {
    const rel = await Relationship.findById(u.relationshipId).select('status user1 user2');
    const live = rel && ['active', 'paused', 'pending'].includes(rel.status);
    const isMember = rel && (String(rel.user1) === String(u._id) || String(rel.user2) === String(u._id));
    if (live && isMember) continue;
    repaired++;
    if (DRY) continue;
    await User.updateOne({ _id: u._id }, { isConnected: false, partnerId: null, relationshipId: null });
  }
  log(`Step 2: repaired ${repaired} user(s) pointing at a non-live relationship`);

  const ghostConnected = await User.countDocuments({ isConnected: true, relationshipId: null });
  log(`Step 2b: ${ghostConnected} user(s) flagged connected with no relationship`);
  if (!DRY && ghostConnected) {
    await User.updateMany({ isConnected: true, relationshipId: null }, { isConnected: false, partnerId: null });
  }

  // ── 3. Hash plaintext connection passwords ─────────────────────────────────
  const plaintext = await User.find({
    connectionPassword: { $ne: null, $exists: true },
    $or: [{ connectionPasswordHash: null }, { connectionPasswordHash: { $exists: false } }],
  }).select('_id connectionPassword');
  log(`Step 3: ${plaintext.length} user(s) with a plaintext connectionPassword`);
  for (const u of plaintext) {
    if (DRY) continue;
    const hash = await bcrypt.hash(String(u.connectionPassword), 10);
    await User.updateOne(
      { _id: u._id },
      { $set: { connectionPasswordHash: hash }, $unset: { connectionPassword: '' } }
    );
  }

  // ── 4. Recompute Love Tree stages ──────────────────────────────────────────
  const trees = await LoveTree.find({}).select('_id points stage');
  let restaged = 0;
  for (const t of trees) {
    const correct = resolveStage(t.points);
    if (t.stage === correct) continue;
    restaged++;
    if (DRY) continue;
    await LoveTree.updateOne({ _id: t._id }, { stage: correct });
  }
  log(`Step 4: restaged ${restaged} of ${trees.length} love tree(s)`);

  console.log(`\n${DRY ? 'Dry run complete — nothing written.' : 'Migration complete.'}`);
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('Migration failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
