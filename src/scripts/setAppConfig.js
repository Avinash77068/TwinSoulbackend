/**
 * Read or update the DB-backed app config (AppConfig, single doc `_id: 'app'`).
 *
 * Replaces having to edit .env and restart for operational switches. Changes take
 * effect within the service's short config cache TTL — no restart needed.
 *
 * Usage:
 *   node src/scripts/setAppConfig.js                                  # show current
 *   node src/scripts/setAppConfig.js --allowDevPremium true
 *   node src/scripts/setAppConfig.js --discoveryRequiresPremium false
 *   node src/scripts/setAppConfig.js --discoveryEnabled false --notes "paused"
 *
 * npm:
 *   npm run config                       # show
 *   npm run config:set -- --allowDevPremium true
 */

require('dotenv').config({ path: `${__dirname}/../../.env` });
const mongoose = require('mongoose');
const os = require('os');

const BOOLEANS = ['allowDevPremium', 'discoveryEnabled', 'discoveryRequiresPremium'];
const NUMBERS = ['defaultPremiumDays', 'discoveryPageLimit'];
const STRINGS = ['notes'];

const argv = process.argv.slice(2);

const parseArgs = () => {
  const patch = {};
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const raw = argv[i + 1];

    if (BOOLEANS.includes(key)) {
      if (raw !== 'true' && raw !== 'false') {
        errors.push(`--${key} must be true or false (got ${raw ?? 'nothing'})`);
      } else {
        patch[key] = raw === 'true';
      }
      i++;
    } else if (NUMBERS.includes(key)) {
      const n = Number(raw);
      if (!Number.isFinite(n) || n <= 0) errors.push(`--${key} must be a positive number`);
      else patch[key] = n;
      i++;
    } else if (STRINGS.includes(key)) {
      patch[key] = String(raw ?? '');
      i++;
    } else {
      errors.push(`Unknown option --${key}`);
    }
  }
  return { patch, errors };
};

const usage = () => {
  console.log(`
App config (stored in MongoDB, no restart needed).

Booleans: ${BOOLEANS.map((b) => '--' + b).join(' ')}
Numbers:  ${NUMBERS.map((n) => '--' + n).join(' ')}
Strings:  ${STRINGS.map((s) => '--' + s).join(' ')}

  --allowDevPremium true|false           enable POST /api/premium/dev-activate
  --discoveryEnabled true|false          master switch for partner search
  --discoveryRequiresPremium true|false  false makes partner search free
  --defaultPremiumDays <n>               default grant length
  --discoveryPageLimit <n>               results per search page

Run with no arguments to print the current effective config.
`);
};

const run = async () => {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('✗ MONGO_URI missing from .env');
    process.exit(1);
  }

  const { patch, errors } = parseArgs();
  if (errors.length) {
    errors.forEach((e) => console.error('✗ ' + e));
    usage();
    process.exit(1);
  }

  await mongoose.connect(uri);
  const appConfig = require('../services/appConfig.service');
  const AppConfig = require('../models/AppConfig');

  if (!Object.keys(patch).length) {
    const doc = await AppConfig.findById('app').lean();
    const effective = await appConfig.getConfig({ force: true });
    console.log(doc ? 'Config document exists.\n' : 'No config document yet — showing env fallbacks.\n');
    console.log('Effective config:');
    for (const [k, v] of Object.entries(effective)) {
      const source = doc && doc[k] !== undefined && doc[k] !== null ? 'db' : 'env/default';
      console.log(`  ${k.padEnd(28)} ${String(v).padEnd(8)} (${source})`);
    }
    if (doc?.notes) console.log(`\nnotes: ${doc.notes}`);
    if (doc?.updatedBy) console.log(`last updated by: ${doc.updatedBy} at ${doc.updatedAt}`);
    await mongoose.disconnect();
    return;
  }

  const updatedBy = `${os.userInfo().username}@${os.hostname()}`;
  const doc = await appConfig.setConfig(patch, updatedBy);

  console.log('✓ Config updated:');
  for (const [k, v] of Object.entries(patch)) {
    console.log(`  ${k} = ${v}`);
  }

  if (patch.allowDevPremium === true) {
    console.log(
      '\n⚠  allowDevPremium is ON — POST /api/premium/dev-activate will now let ANY\n' +
        '   authenticated user grant themselves premium. Turn it off when you are done:\n' +
        '     npm run config:set -- --allowDevPremium false',
    );
  }
  if (patch.discoveryRequiresPremium === false) {
    console.log('\nNote: partner search is now free for all users.');
  }

  console.log(`\n(effective within ~${appConfig.TTL_MS / 1000}s on running instances)`);
  void doc;
  await mongoose.disconnect();
};

run().catch(async (err) => {
  console.error('✗ Failed:', err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
