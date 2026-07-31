// One-off migration: existing Theme documents were created before the
// pink+blue couple palette existed, so they still hold the old pink accent
// (#F472B6 dark / #DB2777 light) baked in as a stored value. Since the app
// always merges a couple's stored accent on top of the base palette, those
// old rows would keep showing pink forever even though new documents (and
// the schema default) now start out blue. Only rows still on a known old
// default are updated — anything else means a couple already customized it.
require('dotenv').config();
const mongoose = require('mongoose');
const Theme = require('../models/Theme');

const OLD_ACCENTS = ['#F472B6', '#DB2777'];
const NEW_ACCENT = '#38BDF8';

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);

  const result = await Theme.updateMany(
    { accent: { $in: OLD_ACCENTS } },
    { $set: { accent: NEW_ACCENT } },
  );

  console.log(`Matched ${result.matchedCount}, updated ${result.modifiedCount} Theme document(s).`);

  await mongoose.disconnect();
}

migrate().catch(err => {
  console.error(err);
  process.exit(1);
});
