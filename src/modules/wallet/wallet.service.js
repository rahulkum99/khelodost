const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const { User, ROLES, ROLE_HIERARCHY } = require('../../models/User');
const mongoose = require('mongoose');
const { withTransaction } = require('../../utils/transaction.helper');
const { getDescendantUserIds } = require('../bet/bet.service');

const sessionOpts = (session) => (session ? { session } : {});

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
 * Add amount to wallet (Credit) - Super Admin only, to own wallet
 * Creates money (system credit) into the super admin's wallet.
 * To give balance to lower admin/user, super admin uses transfer (from own wallet to target).
 */
const addAmount = async (targetUserId, amount, performedBy, description, req = null) => {
  // Validate amount
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }

  if (amount > 9999999999) {
    throw new Error('Amount exceeds maximum limit');
  }

  // Get performer user (must be Super Admin)
  const performer = await User.findById(performedBy);
  if (!performer) {
    throw new Error('Performer not found');
  }

  // ONLY Super Admin can add amount, and only to own wallet
  if (performer.role !== 'super_admin') {
    throw new Error('Only Super Admin can add amount to wallets. Use transfer to move funds between wallets.');
  }
  if (targetUserId.toString() !== performedBy.toString()) {
    throw new Error('Super Admin can only add amount to their own wallet. Use transfer to send funds to others.');
  }

  // Target user is the performer (super admin)
  const targetUser = performer;

  // Get or create wallet (super admin's own)
  const wallet = await Wallet.getOrCreateWallet(targetUserId, targetUser.currency);

  // Check if wallet is available
  if (!wallet.isAvailable()) {
    throw new Error(`Wallet is ${wallet.isLocked ? 'locked' : 'inactive'}. ${wallet.lockedReason || ''}`);
  }

  return await withTransaction(async (session) => {
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore + amount;

    wallet.balance = balanceAfter;
    wallet.lastTransactionAt = new Date();
    await wallet.save(sessionOpts(session));

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
    }], sessionOpts(session));

    return {
      wallet: wallet.toJSON(),
      transaction: transaction[0].toJSON(),
      balanceBefore,
      balanceAfter
    };
  });
};

/**
 * Deduct amount from wallet (Debit)
 * Only upper-level admins can deduct from lower-level users
 * Admin can only deduct from users they created (or hierarchy descendants if options.allowHierarchy)
 */
const deductAmount = async (targetUserId, amount, performedBy, description, req = null, options = {}) => {
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

    if (options.allowHierarchy) {
      const descendantIds = await getDescendantUserIds(String(performedBy));
      const allowedIds = new Set(descendantIds.map((id) => id.toString()));
      if (!allowedIds.has(String(targetUserId))) {
        throw new Error('Target user is not in your hierarchy');
      }
    } else {
      // Check if admin can only deduct from users they created
      if (targetUser.createdBy && targetUser.createdBy.toString() !== performedBy.toString()) {
        throw new Error('You can only deduct amount from users you created');
      }
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

  return await withTransaction(async (session) => {
    const balanceBefore = wallet.balance;
    const balanceAfter = balanceBefore - amount;

    wallet.balance = balanceAfter;
    wallet.lastTransactionAt = new Date();
    await wallet.save(sessionOpts(session));

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
    }], sessionOpts(session));

    return {
      wallet: wallet.toJSON(),
      transaction: transaction[0].toJSON(),
      balanceBefore,
      balanceAfter
    };
  });
};

/**
 * Transfer amount from one wallet to another
 * - All users (including Super Admin) can transfer from their own wallet to other users' wallets
 * - Super Admin can transfer from their own wallet to any user
 * - Super Admin can also transfer from any wallet to any wallet
 * - Upper-level admins can transfer from wallets of users they created to users they created (or hierarchy if options.allowHierarchy)
 */
const transferAmount = async (fromUserId, toUserId, amount, performedBy, description, req = null, options = {}) => {
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

      if (options.allowHierarchy) {
        const descendantIds = await getDescendantUserIds(String(performedBy));
        const allowedIds = new Set(descendantIds.map((id) => id.toString()));
        if (!allowedIds.has(String(fromUserId))) {
          throw new Error('Sender user is not in your hierarchy');
        }
      } else {
        if (fromUser.createdBy && fromUser.createdBy.toString() !== performedBy.toString()) {
          throw new Error('You can only transfer from wallets of users you created');
        }
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

    if (options.allowHierarchy) {
      const descendantIds = await getDescendantUserIds(String(performedBy));
      const allowedIds = new Set(descendantIds.map((id) => id.toString()));
      if (!allowedIds.has(String(toUserId))) {
        throw new Error('Receiver user is not in your hierarchy');
      }
    } else {
      if (toUser.createdBy && toUser.createdBy.toString() !== performedBy.toString()) {
        throw new Error('You can only transfer to users you created');
      }
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

  return await withTransaction(async (session) => {
    const fromBalanceBefore = fromWallet.balance;
    const fromBalanceAfter = fromBalanceBefore - amount;

    const toBalanceBefore = toWallet.balance;
    const toBalanceAfter = toBalanceBefore + amount;

    fromWallet.balance = fromBalanceAfter;
    fromWallet.lastTransactionAt = new Date();
    await fromWallet.save(sessionOpts(session));

    toWallet.balance = toBalanceAfter;
    toWallet.lastTransactionAt = new Date();
    await toWallet.save(sessionOpts(session));

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
    }], sessionOpts(session));

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
    }], sessionOpts(session));

    debitTransaction[0].relatedTransaction = creditTransaction[0]._id;
    await debitTransaction[0].save(sessionOpts(session));

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
  });
};

/** Metadata types used for betting; exclude these when showing only deposit/withdrawal */
const BETTING_METADATA_TYPES = ['bet_exposure_lock', 'bet_exposure_unlock', 'bet_settlement'];

/**
 * Get wallet transactions
 * When excludeBetting is true, only deposit/withdrawal (no betting) transactions are returned.
 */
const getTransactions = async (userId, query = {}) => {
  const {
    page = 1,
    limit = 20,
    transactionType,
    status,
    startDate,
    endDate,
    fromDate,
    toDate,
    action,
    excludeBetting
  } = query;

  const skip = (page - 1) * limit;

  // Build filter
  const filter = { user: userId };

  if (excludeBetting) {
    filter.$or = [
      { 'metadata.type': { $exists: false } },
      { 'metadata.type': { $nin: BETTING_METADATA_TYPES } }
    ];
  }

  // action: deposit = credit, withdrawal = debit
  if (action === 'deposit') {
    filter.transactionType = WalletTransaction.TRANSACTION_TYPES.CREDIT;
  } else if (action === 'withdrawal') {
    filter.transactionType = WalletTransaction.TRANSACTION_TYPES.DEBIT;
  } else if (transactionType) {
    filter.transactionType = transactionType;
  }

  if (status) {
    filter.status = status;
  }

  const dateFrom = fromDate || startDate;
  const dateTo = toDate || endDate;
  if (dateFrom || dateTo) {
    filter.createdAt = filter.createdAt || {};
    if (dateFrom) {
      filter.createdAt.$gte = new Date(dateFrom);
    }
    if (dateTo) {
      filter.createdAt.$lte = new Date(dateTo);
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

/**
 * Get banking list for users created by the given admin: username, balance, exposer
 * exposer = lockedBalance (amount locked in open bets)
 */
const getBankingUserList = async (createdByUserId) => {
  const match = { role: ROLES.USER };
  if (createdByUserId) {
    match.createdBy = typeof createdByUserId === 'string' ? new mongoose.Types.ObjectId(createdByUserId) : createdByUserId;
  }
  const list = await User.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'user',
        as: 'wallet',
        pipeline: [{ $limit: 1 }]
      }
    },
    {
      $project: {
        _id: 1,
        username: 1,
        balance: { $ifNull: [{ $arrayElemAt: ['$wallet.balance', 0] }, 0] },
        exposer: { $ifNull: [{ $arrayElemAt: ['$wallet.lockedBalance', 0] }, 0] }
      }
    },
    { $sort: { username: 1 } }
  ]);
  return list.map(({ _id, username, balance, exposer }) => ({
    userId: _id?.toString?.() || _id,
    username,
    balance: Math.round((balance || 0) * 100) / 100,
    exposer: Math.round((exposer || 0) * 100) / 100
  }));
};

/**
 * Get banking list for admins added by the given user (createdBy). Excludes super_admin.
 */
const getBankingAdminList = async (createdByUserId) => {
  const match = { role: { $in: [ROLES.AGENT, ROLES.MASTER, ROLES.SUPER_MASTER, ROLES.ADMIN] } };
  if (createdByUserId) {
    match.createdBy = typeof createdByUserId === 'string' ? new mongoose.Types.ObjectId(createdByUserId) : createdByUserId;
  }
  const list = await User.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'wallets',
        localField: '_id',
        foreignField: 'user',
        as: 'wallet',
        pipeline: [{ $limit: 1 }]
      }
    },
    {
      $project: {
        _id: 1,
        username: 1,
        balance: { $ifNull: [{ $arrayElemAt: ['$wallet.balance', 0] }, 0] },
        exposer: { $ifNull: [{ $arrayElemAt: ['$wallet.lockedBalance', 0] }, 0] }
      }
    },
    { $sort: { username: 1 } }
  ]);
  return list.map(({ _id, username, balance, exposer }) => ({
    userId: _id?.toString?.() || _id,
    username,
    balance: Math.round((balance || 0) * 100) / 100,
    exposer: Math.round((exposer || 0) * 100) / 100
  }));
};

const BULK_ACTION = { DEPOSIT: 'deposit', WITHDRAW: 'withdraw' };

/**
 * Bulk deposit and withdraw in one request. Each entry: { userId, amount, action: 'deposit'|'withdraw', description? }
 * deposit = transfer from admin to user; withdraw = deduct from user.
 * Returns { succeeded, failed, data: [ { _id, username, balance, exposer }, ... ] } for all userIds in entries.
 */
const bulkDepositAndWithdraw = async (performedBy, entries, req = null) => {
  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    throw new Error('At least one entry (userId, amount, action) is required');
  }
  if (entries.length > 100) {
    throw new Error('Maximum 100 entries per bulk action');
  }
  const succeeded = [];
  const failed = [];
  const userIdsSeen = new Set();
  for (const entry of entries) {
    const { userId, amount, action, description } = entry;
    const actionNorm = action && action.toLowerCase();
    if (userId) userIdsSeen.add(userId.toString());
    if (!userId || amount == null || amount <= 0) {
      failed.push({ userId: userId || 'unknown', amount: amount ?? 0, action: actionNorm || 'deposit', reason: 'Invalid userId or amount' });
      continue;
    }
    if (actionNorm !== BULK_ACTION.DEPOSIT && actionNorm !== BULK_ACTION.WITHDRAW) {
      failed.push({ userId, amount: Number(amount), action: actionNorm || 'deposit', reason: 'action must be "deposit" or "withdraw"' });
      continue;
    }
    try {
      if (actionNorm === BULK_ACTION.DEPOSIT) {
        const result = await transferAmount(
          performedBy,
          userId,
          Number(amount),
          performedBy,
          description || 'Bulk deposit by admin',
          req
        );
        succeeded.push({
          userId,
          amount: Number(amount),
          balanceAfter: result.toBalanceAfter,
          description: description || null,
          action: BULK_ACTION.DEPOSIT
        });
      } else {
        const result = await deductAmount(
          userId,
          Number(amount),
          performedBy,
          description || 'Bulk withdrawal by admin',
          req
        );
        succeeded.push({
          userId,
          amount: Number(amount),
          balanceAfter: result.balanceAfter,
          description: description || null,
          action: BULK_ACTION.WITHDRAW
        });
      }
    } catch (err) {
      failed.push({ userId, amount: Number(amount), action: actionNorm, reason: err.message || 'Failed' });
    }
  }
  const userIds = Array.from(userIdsSeen).filter(Boolean).map(id => new mongoose.Types.ObjectId(id));
  let data = [];
  if (userIds.length > 0) {
    const list = await User.aggregate([
      { $match: { _id: { $in: userIds } } },
      {
        $lookup: {
          from: 'wallets',
          localField: '_id',
          foreignField: 'user',
          as: 'wallet',
          pipeline: [{ $limit: 1 }]
        }
      },
      {
        $project: {
          _id: 1,
          username: 1,
          balance: { $ifNull: [{ $arrayElemAt: ['$wallet.balance', 0] }, 0] },
          exposer: { $ifNull: [{ $arrayElemAt: ['$wallet.lockedBalance', 0] }, 0] }
        }
      },
      { $sort: { username: 1 } }
    ]);
    data = list.map(({ _id, username, balance, exposer }) => ({
      _id: _id ? _id.toString() : _id,
      username,
      balance: Math.round((balance || 0) * 100) / 100,
      exposer: Math.round((exposer || 0) * 100) / 100
    }));
  }
  return { succeeded, failed, data };
};

/**
 * Deposit to a user in the admin's hierarchy (any descendant).
 * Transfers from admin's wallet to target user's wallet.
 * Super Admin can deposit to anyone; others only to users in their tree.
 */
const depositToHierarchyUser = async (adminUserId, targetUserId, amount, description, req = null) => {
  return transferAmount(
    adminUserId,
    targetUserId,
    amount,
    adminUserId,
    description || 'Hierarchy deposit',
    req,
    { allowHierarchy: true }
  );
};

/**
 * Withdraw from a user in the admin's hierarchy (any descendant).
 * Deducts from target user's wallet.
 * Super Admin can withdraw from anyone; others only from users in their tree.
 */
const withdrawFromHierarchyUser = async (adminUserId, targetUserId, amount, description, req = null) => {
  return deductAmount(
    targetUserId,
    amount,
    adminUserId,
    description || 'Hierarchy withdrawal',
    req,
    { allowHierarchy: true }
  );
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
  getWalletStats,
  getBankingUserList,
  getBankingAdminList,
  bulkDepositAndWithdraw,
  depositToHierarchyUser,
  withdrawFromHierarchyUser
};

