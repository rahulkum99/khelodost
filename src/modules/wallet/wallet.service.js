const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const { User, ROLE_HIERARCHY } = require('../../models/User');
const mongoose = require('mongoose');

/**
 * Get wallet for a user
 */
const getWallet = async (userId) => {
  const wallet = await Wallet.findOne({ user: userId }).populate('user', 'username name email role');
  
  if (!wallet) {
    throw new Error('Wallet not found');
  }
  
  return wallet;
};

/**
 * Get wallet balance
 */
const getBalance = async (userId) => {
  const wallet = await Wallet.findOne({ user: userId });
  
  if (!wallet) {
    throw new Error('Wallet not found');
  }
  
  return {
    balance: wallet.balance,
    currency: wallet.currency,
    isActive: wallet.isActive,
    isLocked: wallet.isLocked
  };
};

/**
 * Add amount to wallet (Credit)
 * ONLY Super Admin can add amount to wallets
 * This creates money from nothing (system credit)
 */
const addAmount = async (targetUserId, amount, performedBy, description, req = null) => {
  // Validate amount
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  if (amount > 9999999999) {
    throw new Error('Amount exceeds maximum limit');
  }

  // Get performer user
  const performer = await User.findById(performedBy);
  if (!performer) {
    throw new Error('Performer not found');
  }

  // ONLY Super Admin can add amount
  if (performer.role !== 'super_admin') {
    throw new Error('Only Super Admin can add amount to wallets. Use transfer to move funds between wallets.');
  }

  // Get target user
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    throw new Error('Target user not found');
  }

  // Get or create wallet
  const wallet = await Wallet.getOrCreateWallet(targetUserId, targetUser.currency);

  // Check if wallet is available
  if (!wallet.isAvailable()) {
    throw new Error(`Wallet is ${wallet.isLocked ? 'locked' : 'inactive'}. ${wallet.lockedReason || ''}`);
  }

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;

    // Update wallet balance
    wallet.balance = balanceAfter;
    wallet.lastTransactionAt = new Date();
    await wallet.save({ session });

    // Create transaction record
    const transaction = await WalletTransaction.create([{
      wallet: wallet._id,
      user: targetUserId,
      transactionType: WalletTransaction.TRANSACTION_TYPES.CREDIT,
      amount: amount,
      balanceBefore: balanceBefore,
      balanceAfter: balanceAfter,
      currency: wallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description: description || `Amount added by ${performer.username}`,
      performedBy: performedBy,
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
      metadata: {
        addedBy: performer.username,
        targetUser: targetUser.username
      }
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return {
      wallet: wallet.toJSON(),
      transaction: transaction[0].toJSON(),
      balanceBefore,
      balanceAfter
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Deduct amount from wallet (Debit)
 * Only upper-level admins can deduct from lower-level users
 * Admin can only deduct from users they created
 */
const deductAmount = async (targetUserId, amount, performedBy, description, req = null) => {
  // Validate amount
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  // Get performer user
  const performer = await User.findById(performedBy);
  if (!performer) {
    throw new Error('Performer not found');
  }

  // Get target user
  const targetUser = await User.findById(targetUserId);
  if (!targetUser) {
    throw new Error('Target user not found');
  }

  // Check if performer has higher role than target
  const performerRoleLevel = ROLE_HIERARCHY[performer.role] || 0;
  const targetRoleLevel = ROLE_HIERARCHY[targetUser.role] || 0;

  // Super Admin can deduct from anyone
  if (performer.role !== 'super_admin') {
    // Check if performer has higher role
    if (performerRoleLevel <= targetRoleLevel) {
      throw new Error('You can only deduct amount from users with lower role level');
    }

    // Check if admin can only deduct from users they created
    if (targetUser.createdBy && targetUser.createdBy.toString() !== performedBy.toString()) {
      throw new Error('You can only deduct amount from users you created');
    }
  }

  // Get wallet
  const wallet = await Wallet.findOne({ user: targetUserId });
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  // Check if wallet is available
  if (!wallet.isAvailable()) {
    throw new Error(`Wallet is ${wallet.isLocked ? 'locked' : 'inactive'}. ${wallet.lockedReason || ''}`);
  }

  // Check if sufficient balance
  if (wallet.balance < amount) {
    throw new Error('Insufficient wallet balance');
  }

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - amount;

    // Update wallet balance
    wallet.balance = balanceAfter;
    wallet.lastTransactionAt = new Date();
    await wallet.save({ session });

    // Create transaction record
    const transaction = await WalletTransaction.create([{
      wallet: wallet._id,
      user: targetUserId,
      transactionType: WalletTransaction.TRANSACTION_TYPES.DEBIT,
      amount: amount,
      balanceBefore: balanceBefore,
      balanceAfter: balanceAfter,
      currency: wallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description: description || `Amount deducted by ${performer.username}`,
      performedBy: performedBy,
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
      metadata: {
        deductedBy: performer.username,
        targetUser: targetUser.username
      }
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return {
      wallet: wallet.toJSON(),
      transaction: transaction[0].toJSON(),
      balanceBefore,
      balanceAfter
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Get wallet transactions
 */
const getTransactions = async (userId, query = {}) => {
  const {
    page = 1,
    limit = 20,
    transactionType,
    status,
    startDate,
    endDate
  } = query;

  const skip = (page - 1) * limit;

  // Build filter
  const filter = { user: userId };

  if (transactionType) {
    filter.transactionType = transactionType;
  }

  if (status) {
    filter.status = status;
  }

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) {
      filter.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      filter.createdAt.$lte = new Date(endDate);
    }
  }

  const transactions = await WalletTransaction.find(filter)
    .populate('performedBy', 'username name role')
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit);

  const total = await WalletTransaction.countDocuments(filter);

  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Lock wallet
 */
const lockWallet = async (userId, performedBy, reason) => {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  await wallet.lock(reason);
  return wallet;
};

/**
 * Unlock wallet
 */
const unlockWallet = async (userId, performedBy) => {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  await wallet.unlock();
  return wallet;
};

/**
 * Get wallet statistics
 */
const getWalletStats = async (userId) => {
  const wallet = await Wallet.findOne({ user: userId });
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  const stats = await WalletTransaction.aggregate([
    { $match: { user: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: '$transactionType',
        totalAmount: { $sum: '$amount' },
        count: { $sum: 1 }
      }
    }
  ]);

  const totalCredits = await WalletTransaction.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        transactionType: WalletTransaction.TRANSACTION_TYPES.CREDIT,
        status: WalletTransaction.TRANSACTION_STATUS.COMPLETED
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  const totalDebits = await WalletTransaction.aggregate([
    {
      $match: {
        user: mongoose.Types.ObjectId(userId),
        transactionType: WalletTransaction.TRANSACTION_TYPES.DEBIT,
        status: WalletTransaction.TRANSACTION_STATUS.COMPLETED
      }
    },
    {
      $group: {
        _id: null,
        total: { $sum: '$amount' }
      }
    }
  ]);

  return {
    wallet: wallet.toJSON(),
    stats: stats.reduce((acc, stat) => {
      acc[stat._id] = {
        totalAmount: stat.totalAmount,
        count: stat.count
      };
      return acc;
    }, {}),
    totalCredits: totalCredits[0]?.total || 0,
    totalDebits: totalDebits[0]?.total || 0,
    netAmount: (totalCredits[0]?.total || 0) - (totalDebits[0]?.total || 0)
  };
};

module.exports = {
  getWallet,
  getBalance,
  addAmount,
  deductAmount,
  transferAmount,
  getTransactions,
  lockWallet,
  unlockWallet,
  getWalletStats
};

