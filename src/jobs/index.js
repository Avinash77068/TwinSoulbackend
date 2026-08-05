const cron = require('node-cron');
const os = require('os');
const CronLock = require('../models/CronLock');

const OWNER = `${os.hostname()}:${process.pid}`;

/**
 * Register a cron job that only ONE instance runs per tick.
 *
 * @param {string} name      lock name
 * @param {string} schedule  cron expression
 * @param {Function} fn      job body
 * @param {number} ttlMs     lock lifetime — must exceed the job's worst-case runtime
 */
const scheduleLocked = (name, schedule, fn, ttlMs = 5 * 60 * 1000) => {
  cron.schedule(schedule, async () => {
    let got = false;
    try {
      got = await CronLock.acquire(name, ttlMs, OWNER);
      if (!got) return; // another instance is handling this tick
      await fn();
    } catch (err) {
      console.error(`[Cron:${name}]`, err.message);
    } finally {
      if (got) await CronLock.release(name, OWNER);
    }
  });
};

/** Wire up every scheduled job. Call once after the DB connects. */
const registerJobs = (io) => {
  require('./scheduledMessages')(scheduleLocked, io);
  require('./presenceSweep')(scheduleLocked);
  require('./lifecycle')(scheduleLocked);
  require('./anniversaries')(scheduleLocked);
  console.log('[Cron] Jobs registered with distributed locking');
};

module.exports = { registerJobs, scheduleLocked, OWNER };
