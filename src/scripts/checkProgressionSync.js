#!/usr/bin/env node
/**
 * Guard against the client and server Love Tree / level tables diverging again.
 *
 * They HAD diverged: the RN app used thresholds 0/3/7/15/30/60 while the server
 * used 0/50/200/500/1000/2000, so users saw the wrong stage and wrong progress.
 * This script parses the app's TypeScript constants and asserts they match.
 *
 * Run:  node src/scripts/checkProgressionSync.js
 * Exits non-zero on mismatch — wire it into CI.
 */

const fs = require('fs');
const path = require('path');
const { TREE_STAGES, LEVEL_TITLES } = require('../constants/progression');

const APP_FILE = path.resolve(
  __dirname,
  '../../../TwinSoul/src/shared/constants/progression.ts'
);

const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
};

if (!fs.existsSync(APP_FILE)) {
  console.error(`✗ App constants not found at ${APP_FILE}`);
  process.exit(1);
}

const src = fs.readFileSync(APP_FILE, 'utf8');

// ── Tree stages ──────────────────────────────────────────────────────────────
const stageBlock = src.match(/export const TREE_STAGES[^=]*=\s*\[([\s\S]*?)\];/);
if (!stageBlock) {
  fail('Could not parse TREE_STAGES from the app file');
} else {
  const rows = [...stageBlock[1].matchAll(
    /name:\s*'([^']+)'\s*,\s*min:\s*(\d+)\s*,\s*nextAt:\s*(null|\d+)/g
  )].map((m) => ({
    name: m[1],
    min: Number(m[2]),
    nextAt: m[3] === 'null' ? null : Number(m[3]),
  }));

  if (rows.length !== TREE_STAGES.length) {
    fail(`Tree stage count differs: server ${TREE_STAGES.length}, app ${rows.length}`);
  } else {
    rows.forEach((appRow, i) => {
      const srv = TREE_STAGES[i];
      if (appRow.name !== srv.name) fail(`Stage ${i} name: server '${srv.name}', app '${appRow.name}'`);
      if (appRow.min !== srv.min) fail(`Stage '${srv.name}' min: server ${srv.min}, app ${appRow.min}`);
      if (appRow.nextAt !== srv.nextAt) fail(`Stage '${srv.name}' nextAt: server ${srv.nextAt}, app ${appRow.nextAt}`);
    });
  }
}

// ── Level titles ─────────────────────────────────────────────────────────────
const titleBlock = src.match(/export const LEVEL_TITLES[^=]*=\s*\{([\s\S]*?)\};/);
if (!titleBlock) {
  fail('Could not parse LEVEL_TITLES from the app file');
} else {
  const appTitles = {};
  for (const m of titleBlock[1].matchAll(/(\d+)\s*:\s*'([^']+)'/g)) {
    appTitles[Number(m[1])] = m[2];
  }
  const srvKeys = Object.keys(LEVEL_TITLES).map(Number).sort((a, b) => a - b);
  const appKeys = Object.keys(appTitles).map(Number).sort((a, b) => a - b);
  if (srvKeys.join(',') !== appKeys.join(',')) {
    fail(`Level title keys differ: server [${srvKeys}], app [${appKeys}]`);
  } else {
    for (const k of srvKeys) {
      if (LEVEL_TITLES[k] !== appTitles[k]) {
        fail(`Level ${k} title: server '${LEVEL_TITLES[k]}', app '${appTitles[k]}'`);
      }
    }
  }
}

if (!process.exitCode) {
  console.log('✓ Progression constants are in sync (tree stages + level titles)');
}
