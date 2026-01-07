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
 * Transfer amount from one wallet to another
 * Users can transfer from their own wallet to other users' wallets
 * Upper-level admins can transfer to lower-level users they created
 */
const transferAmount = async (fromUserId, toUserId, amount, performedBy, description, req = null) => {
  // Validate amount
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  if (amount > 9999999999) {
    throw new Error('Amount exceeds maximum limit');
  }

  // Cannot transfer to self
  if (fromUserId.toString() === toUserId.toString()) {
    throw new Error('Cannot transfer to your own wallet');
  }

  // Get performer user
  const performer = await User.findById(performedBy);
  if (!performer) {
    throw new Error('Performer not found');
  }

  // Get from user (sender)
  const fromUser = await User.findById(fromUserId);
  if (!fromUser) {
    throw new Error('Sender user not found');
  }

  // Get to user (receiver)
  const toUser = await User.findById(toUserId);
  if (!toUser) {
    throw new Error('Receiver user not found');
  }

  // Check if performer is transferring from their own wallet
  const isTransferringFromOwnWallet = fromUserId.toString() === performedBy.toString();

  // If not transferring from own wallet, check permissions
  if (!isTransferringFromOwnWallet) {
    const performerRoleLevel = ROLE_HIERARCHY[performer.role] || 0;
    const fromUserRoleLevel = ROLE_HIERARCHY[fromUser.role] || 0;

    // Super Admin can transfer from anyone
    if (performer.role !== 'super_admin') {
      // Check if performer has higher role than sender
      if (performerRoleLevel <= fromUserRoleLevel) {
        throw new Error('You can only transfer from wallets of users with lower role level');
      }

      // Check if admin can only transfer from users they created
      if (fromUser.createdBy && fromUser.createdBy.toString() !== performedBy.toString()) {
        throw new Error('You can only transfer from wallets of users you created');
      }
    }
  }

  // Check receiver permissions
  const performerRoleLevel = ROLE_HIERARCHY[performer.role] || 0;
  const toUserRoleLevel = ROLE_HIERARCHY[toUser.role] || 0;

  // Super Admin can transfer to anyone
  if (performer.role !== 'super_admin') {
    // Check if performer has higher role than receiver
    if (performerRoleLevel <= toUserRoleLevel) {
      throw new Error('You can only transfer to users with lower role level');
    }

    // Check if admin can only transfer to users they created
    if (toUser.createdBy && toUser.createdBy.toString() !== performedBy.toString()) {
      throw new Error('You can only transfer to users you created');
    }
  }

  // Get wallets
  const fromWallet = await Wallet.findOne({ user: fromUserId });
  if (!fromWallet) {
    throw new Error('Sender wallet not found');
  }

  const toWallet = await Wallet.getOrCreateWallet(toUserId, toUser.currency);

  // Check if wallets are available
  if (!fromWallet.isAvailable()) {
    throw new Error(`Sender wallet is ${fromWallet.isLocked ? 'locked' : 'inactive'}. ${fromWallet.lockedReason || ''}`);
  }

  if (!toWallet.isAvailable()) {
    throw new Error(`Receiver wallet is ${toWallet.isLocked ? 'locked' : 'inactive'}. ${toWallet.lockedReason || ''}`);
  }

  // Check if currencies match
  if (fromWallet.currency !== toWallet.currency) {
    throw new Error(`Currency mismatch. Cannot transfer from ${fromWallet.currency} to ${toWallet.currency}`);
  }

  // Check if sufficient balance in sender wallet
  if (fromWallet.balance < amount) {
    throw new Error('Insufficient balance in sender wallet');
  }

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const fromBalanceBefore = fromWallet.balance;
    const fromBalanceAfter = fromBalanceBefore - amount;

    const toBalanceBefore = toWallet.balance;
    const toBalanceAfter = toBalanceBefore + amount;

    // Update sender wallet balance
    fromWallet.balance = fromBalanceAfter;
    fromWallet.lastTransactionAt = new Date();
    await fromWallet.save({ session });

    // Update receiver wallet balance
    toWallet.balance = toBalanceAfter;
    toWallet.lastTransactionAt = new Date();
    await toWallet.save({ session });

    // Create debit transaction for sender
    const debitTransaction = await WalletTransaction.create([{
      wallet: fromWallet._id,
      user: fromUserId,
      transactionType: WalletTransaction.TRANSACTION_TYPES.DEBIT,
      amount: amount,
      balanceBefore: fromBalanceBefore,
      balanceAfter: fromBalanceAfter,
      currency: fromWallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description: description || `Transfer to ${toUser.username}`,
      performedBy: performedBy,
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
      metadata: {
        transferType: 'outgoing',
        toUser: toUser.username,
        toUserId: toUserId.toString()
      }
    }], { session });

    // Create credit transaction for receiver
    const creditTransaction = await WalletTransaction.create([{
      wallet: toWallet._id,
      user: toUserId,
      transactionType: WalletTransaction.TRANSACTION_TYPES.CREDIT,
      amount: amount,
      balanceBefore: toBalanceBefore,
      balanceAfter: toBalanceAfter,
      currency: toWallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description: description || `Transfer from ${fromUser.username}`,
      performedBy: performedBy,
      relatedTransaction: debitTransaction[0]._id,
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
      metadata: {
        transferType: 'incoming',
        fromUser: fromUser.username,
        fromUserId: fromUserId.toString()
      }
    }], { session });

    // Link transactions
    debitTransaction[0].relatedTransaction = creditTransaction[0]._id;
    await debitTransaction[0].save({ session });

    await session.commitTransaction();
    session.endSession();

    return {
      fromWallet: fromWallet.toJSON(),
      toWallet: toWallet.toJSON(),
      debitTransaction: debitTransaction[0].toJSON(),
      creditTransaction: creditTransaction[0].toJSON(),
      fromBalanceBefore,
      fromBalanceAfter,
      toBalanceBefore,
      toBalanceAfter
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

