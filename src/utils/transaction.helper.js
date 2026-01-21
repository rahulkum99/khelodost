const mongoose = require('mongoose');

let transactionSupported = null;
let transactionCheckLogged = false;

/**
 * Check if MongoDB transactions are supported (requires replica set)
 */
const checkTransactionSupport = async () => {
  if (transactionSupported !== null) {
    return transactionSupported;
  }

  try {
    const admin = mongoose.connection.db.admin();
    const status = await admin.serverStatus();
    // Check if replica set is configured
    transactionSupported = status.repl !== undefined;
    
    // Log once on first check
    if (!transactionCheckLogged) {
      transactionCheckLogged = true;
      if (transactionSupported) {
        console.log('✅ MongoDB transactions supported (replica set detected)');
      } else {
        console.log('ℹ️ MongoDB running in standalone mode - transactions disabled');
        console.log('   For production, use MongoDB Atlas or configure a replica set');
      }
    }
    
    return transactionSupported;
  } catch (error) {
    // If check fails, assume transactions not supported
    // This is normal for standalone MongoDB instances
    transactionSupported = false;
    if (!transactionCheckLogged) {
      transactionCheckLogged = true;
      console.log('ℹ️ MongoDB running in standalone mode - transactions disabled');
    }
    return false;
  }
};

/**
 * Execute a function with or without transaction based on availability
 * @param {Function} fn - Function to execute with session parameter
 * @returns {Promise} Result of the function
 */
const withTransaction = async (fn) => {
  const supportsTransactions = await checkTransactionSupport();

  if (supportsTransactions) {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const result = await fn(session);
      await session.commitTransaction();
      return result;
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } else {
    // No transaction support - execute without session
    // Note: This is less safe but works for development
    // For production, use MongoDB Atlas or configure a replica set
    return await fn(null);
  }
};

/**
 * Create a session if transactions are supported, otherwise return null
 */
const getSession = async () => {
  const supportsTransactions = await checkTransactionSupport();
  if (supportsTransactions) {
    const session = await mongoose.startSession();
    session.startTransaction();
    return session;
  }
  return null;
};

/**
 * Commit a session if it exists
 */
const commitSession = async (session) => {
  if (session) {
    await session.commitTransaction();
    session.endSession();
  }
};

/**
 * Abort a session if it exists
 */
const abortSession = async (session) => {
  if (session) {
    await session.abortTransaction();
    session.endSession();
  }
};

module.exports = {
  checkTransactionSupport,
  withTransaction,
  getSession,
  commitSession,
  abortSession,
};
