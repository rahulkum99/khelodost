const crypto = require('crypto');
const UserBetLock = require('../models/UserBetLock');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Acquire an exclusive lock per user while placing bets.
 * Helps prevent race conditions on standalone MongoDB where we don't have real transactions.
 */
const withUserBetLock = async (userId, fn, options = {}) => {
  const {
    ttlMs = 8000, // lock expires automatically
    waitMs = 5000, // max time to wait for the lock
    pollMs = 100, // polling interval
  } = options;

  const uid = userId;
  const startedAt = Date.now();
  const lockToken = crypto.randomBytes(16).toString('hex');
  const lockedUntil = new Date(Date.now() + ttlMs);

  // Try to acquire lock until timeout
  while (Date.now() - startedAt < waitMs) {
    try {
      const doc = await UserBetLock.findOneAndUpdate(
        {
          user: uid,
          lockedUntil: { $lte: new Date() },
        },
        {
          $set: {
            lockToken,
            lockedUntil,
          },
        },
        { upsert: true, new: true }
      );

      if (doc && String(doc.user) === String(uid) && doc.lockToken === lockToken) {
        try {
          return await fn();
        } finally {
          // Release only if we still own the lockToken
          await UserBetLock.updateOne(
            { user: uid, lockToken },
            { $set: { lockedUntil: new Date(0), lockToken: null } }
          );
        }
      }
    } catch (err) {
      // Duplicate-key can happen on first upsert race for same user lock doc; retry.
      // Do not mask unrelated DB errors as "busy".
      if (err && err.code === 11000) {
        // keep retrying until waitMs expires
      } else {
        throw err;
      }
    }

    await sleep(pollMs);
  }

  const e = new Error('Wallet/bet placement is busy, please try again');
  e.status = 409;
  e.code = 'BET_PLACEMENT_BUSY';
  throw e;
};

module.exports = { withUserBetLock };

