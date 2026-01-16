const Bet = require('../../models/Bet');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const mongoose = require('mongoose');

/**
 * Place a bet (back or lay)
 */
const placeBet = async (userId, betData, req = null) => {
  const {
    marketId,
    sectionId,
    eventId,
    marketName,
    sectionName,
    type,
    odds,
    stake
  } = betData;

  // Validate inputs
  if (!marketId || !sectionId || !eventId || !marketName || !sectionName) {
    throw new Error('Market and section information is required');
  }

  if (![Bet.BET_TYPES.BACK, Bet.BET_TYPES.LAY].includes(type)) {
    throw new Error('Invalid bet type. Must be "back" or "lay"');
  }

  if (!odds || odds < 1.01 || odds > 1000) {
    throw new Error('Odds must be between 1.01 and 1000');
  }

  if (!stake || stake <= 0) {
    throw new Error('Stake must be greater than 0');
  }

  // Get or create wallet
  const wallet = await Wallet.getOrCreateWallet(userId);
  if (!wallet.isAvailable()) {
    throw new Error(`Wallet is ${wallet.isLocked ? 'locked' : 'inactive'}. ${wallet.lockedReason || ''}`);
  }

  // Calculate required amount
  let requiredAmount = stake;
  let liability = 0;

  if (type === Bet.BET_TYPES.LAY) {
    liability = stake * (odds - 1);
    requiredAmount = stake + liability;
  }

  // Check available balance
  if (wallet.availableBalance < requiredAmount) {
    throw new Error(`Insufficient available balance. Required: ${requiredAmount}, Available: ${wallet.availableBalance}`);
  }

  // Calculate profit for back bet
  const profit = type === Bet.BET_TYPES.BACK ? stake * (odds - 1) : 0;

  // Start transaction
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Lock balance
    const balanceBefore = wallet.balance;
    wallet.availableBalance -= requiredAmount;
    wallet.lockedBalance += requiredAmount;
    wallet.balance = wallet.availableBalance + wallet.lockedBalance;
    wallet.lastTransactionAt = new Date();
    await wallet.save({ session });

    // Create bet
    const bet = new Bet({
      userId,
      marketId,
      sectionId,
      eventId,
      marketName,
      sectionName,
      type,
      odds,
      stake,
      unmatchedAmount: stake,
      matchedAmount: 0,
      profit,
      liability,
      status: Bet.BET_STATUS.PENDING
    });

    await bet.save({ session });

    // Create transaction record
    const transaction = await WalletTransaction.create([{
      wallet: wallet._id,
      user: userId,
      transactionType: WalletTransaction.TRANSACTION_TYPES.BET_PLACED,
      amount: -requiredAmount,
      balanceBefore,
      balanceAfter: balanceBefore, // Balance unchanged, just locked
      currency: wallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description: `Bet placed: ${type} ${stake} @ ${odds} on ${sectionName}`,
      performedBy: userId,
      betId: bet._id,
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
      metadata: {
        betType: type,
        stake,
        odds,
        marketName,
        sectionName
      }
    }], { session });

    // Attempt to match bet
    const matchResult = await matchBet(bet._id, session);

    await session.commitTransaction();
    session.endSession();

    return {
      bet: bet.toJSON(),
      transaction: transaction[0].toJSON(),
      matchedBets: matchResult.matchedBets,
      wallet: wallet.toJSON()
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Match a bet with available opposite bets
 */
const matchBet = async (betId, session = null) => {
  const bet = await Bet.findById(betId).session(session);
  if (!bet) {
    throw new Error('Bet not found');
  }

  if (bet.status === Bet.BET_STATUS.MATCHED || bet.status === Bet.BET_STATUS.SETTLED || bet.status === Bet.BET_STATUS.CANCELLED) {
    return { matchedBets: [] };
  }

  const matchedBets = [];
  let remainingAmount = bet.unmatchedAmount;

  // Build matching query
  let matchingQuery = {
    type: bet.type === Bet.BET_TYPES.BACK ? Bet.BET_TYPES.LAY : Bet.BET_TYPES.BACK,
    marketId: bet.marketId,
    sectionId: bet.sectionId,
    status: { $in: [Bet.BET_STATUS.PENDING, Bet.BET_STATUS.PARTIALLY_MATCHED] },
    userId: { $ne: bet.userId },
    unmatchedAmount: { $gt: 0 }
  };

  // For back bet: find lay bets with odds <= back odds
  // For lay bet: find back bets with odds >= lay odds
  if (bet.type === Bet.BET_TYPES.BACK) {
    matchingQuery.odds = { $lte: bet.odds };
  } else {
    matchingQuery.odds = { $gte: bet.odds };
  }

  // Find available bets sorted by best odds (for back: lowest lay odds first, for lay: highest back odds first)
  const availableBets = await Bet.find(matchingQuery)
    .sort({ odds: bet.type === Bet.BET_TYPES.BACK ? 1 : -1, createdAt: 1 })
    .session(session || null);

  if (availableBets.length === 0) {
    return { matchedBets: [] };
  }

  // Match with available bets
  for (const availableBet of availableBets) {
    if (remainingAmount <= 0) break;

    if (!bet.canMatchWith(availableBet)) {
      continue;
    }

    const matchAmount = Math.min(remainingAmount, availableBet.unmatchedAmount);
    const matchOdds = bet.type === Bet.BET_TYPES.BACK ? availableBet.odds : bet.odds;

    // Update both bets
    bet.matchedAmount += matchAmount;
    bet.unmatchedAmount -= matchAmount;
    bet.matchedWith.push({
      betId: availableBet._id,
      amount: matchAmount,
      odds: matchOdds,
      matchedAt: new Date()
    });
    bet.updateStatus();

    availableBet.matchedAmount += matchAmount;
    availableBet.unmatchedAmount -= matchAmount;
    availableBet.matchedWith.push({
      betId: bet._id,
      amount: matchAmount,
      odds: matchOdds,
      matchedAt: new Date()
    });
    availableBet.updateStatus();

    // Unlock balances for both users (use matchOdds for liability calculation)
    await unlockMatchedBalance(bet.userId, bet.type, matchAmount, matchOdds, session);
    await unlockMatchedBalance(availableBet.userId, availableBet.type, matchAmount, matchOdds, session);

    // Create match transactions
    await createMatchTransaction(bet.userId, bet._id, matchAmount, matchOdds, session);
    await createMatchTransaction(availableBet.userId, availableBet._id, matchAmount, matchOdds, session);

    await bet.save({ session });
    await availableBet.save({ session });

    matchedBets.push({
      betId: availableBet._id,
      amount: matchAmount,
      odds: matchOdds
    });

    remainingAmount -= matchAmount;
  }

  return { matchedBets };
};

/**
 * Unlock balance when bet is matched
 */
const unlockMatchedBalance = async (userId, betType, matchedAmount, matchOdds, session) => {
  const wallet = await Wallet.findOne({ user: userId }).session(session);
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  let unlockAmount = matchedAmount;

  if (betType === Bet.BET_TYPES.LAY) {
    // For lay bet, unlock stake + liability (calculated using match odds)
    const liability = matchedAmount * (matchOdds - 1);
    unlockAmount = matchedAmount + liability;
  }

  wallet.lockedBalance -= unlockAmount;
  wallet.availableBalance += unlockAmount;
  wallet.balance = wallet.availableBalance + wallet.lockedBalance;
  await wallet.save({ session });
};

/**
 * Create transaction for matched bet
 */
const createMatchTransaction = async (userId, betId, matchAmount, matchOdds, session) => {
  const wallet = await Wallet.findOne({ user: userId }).session(session);
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  const bet = await Bet.findById(betId).session(session);
  if (!bet) {
    throw new Error('Bet not found');
  }

  await WalletTransaction.create([{
    wallet: wallet._id,
    user: userId,
    transactionType: WalletTransaction.TRANSACTION_TYPES.BET_MATCHED,
    amount: 0, // No change in balance, just unlocked
    balanceBefore: wallet.balance,
    balanceAfter: wallet.balance,
    currency: wallet.currency,
    status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
    description: `Bet matched: ${matchAmount} @ ${matchOdds}`,
    performedBy: userId,
    betId: betId,
    metadata: {
      matchAmount,
      matchOdds,
      betType: bet.type
    }
  }], { session });
};

/**
 * Cancel a bet
 */
const cancelBet = async (userId, betId, req = null) => {
  const bet = await Bet.findById(betId);
  if (!bet) {
    throw new Error('Bet not found');
  }

  if (bet.userId.toString() !== userId.toString()) {
    throw new Error('You can only cancel your own bets');
  }

  if (bet.status === Bet.BET_STATUS.SETTLED) {
    throw new Error('Cannot cancel settled bet');
  }

  if (bet.status === Bet.BET_STATUS.CANCELLED) {
    throw new Error('Bet is already cancelled');
  }

  // Can only cancel unmatched portion
  if (bet.unmatchedAmount === 0) {
    throw new Error('Cannot cancel fully matched bet');
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const wallet = await Wallet.findOne({ user: userId }).session(session);
    if (!wallet) {
      throw new Error('Wallet not found');
    }

    // Calculate amount to unlock
    let unlockAmount = bet.unmatchedAmount;
    if (bet.type === Bet.BET_TYPES.LAY) {
      const liability = bet.unmatchedAmount * (bet.odds - 1);
      unlockAmount = bet.unmatchedAmount + liability;
    }

    // Unlock balance
    const balanceBefore = wallet.balance;
    wallet.lockedBalance -= unlockAmount;
    wallet.availableBalance += unlockAmount;
    wallet.balance = wallet.availableBalance + wallet.lockedBalance;
    wallet.lastTransactionAt = new Date();
    await wallet.save({ session });

    // Update bet status
    bet.status = Bet.BET_STATUS.CANCELLED;
    bet.unmatchedAmount = 0;
    await bet.save({ session });

    // Create transaction
    await WalletTransaction.create([{
      wallet: wallet._id,
      user: userId,
      transactionType: WalletTransaction.TRANSACTION_TYPES.BET_CANCELLED,
      amount: unlockAmount,
      balanceBefore,
      balanceAfter: balanceBefore, // Balance unchanged, just unlocked
      currency: wallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description: `Bet cancelled: ${bet.type} ${bet.stake} @ ${bet.odds} on ${bet.sectionName}`,
      performedBy: userId,
      betId: bet._id,
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
      metadata: {
        betType: bet.type,
        stake: bet.stake,
        odds: bet.odds
      }
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return {
      bet: bet.toJSON(),
      wallet: wallet.toJSON()
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Settle bets for an event
 */
const settleEvent = async (eventId, winningSectionId, performedBy, req = null) => {
  // Find all matched or partially matched bets for the event
  const bets = await Bet.find({
    eventId,
    status: { $in: [Bet.BET_STATUS.MATCHED, Bet.BET_STATUS.PARTIALLY_MATCHED] }
  });

  if (bets.length === 0) {
    return { message: 'No bets to settle for this event', settledCount: 0 };
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let settledCount = 0;

    for (const bet of bets) {
      const isWinner = bet.sectionId === winningSectionId;
      const wallet = await Wallet.findOne({ user: bet.userId }).session(session);
      if (!wallet) {
        console.error(`Wallet not found for user ${bet.userId}`);
        continue;
      }

      const balanceBefore = wallet.balance;

      if (bet.type === Bet.BET_TYPES.BACK) {
        if (isWinner) {
          // Win: Add profit
          const winnings = bet.matchedAmount * (bet.odds - 1);
          wallet.availableBalance += winnings;
          wallet.balance = wallet.availableBalance + wallet.lockedBalance;
          wallet.totalProfit += winnings;
          bet.settlementResult = Bet.SETTLEMENT_RESULT.WIN;

          // Create settlement transaction
          await WalletTransaction.create([{
            wallet: wallet._id,
            user: bet.userId,
            transactionType: WalletTransaction.TRANSACTION_TYPES.BET_SETTLED,
            amount: winnings,
            balanceBefore,
            balanceAfter: wallet.balance,
            currency: wallet.currency,
            status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
            description: `Bet settled: Won ${winnings} on ${bet.sectionName}`,
            performedBy: performedBy,
            betId: bet._id,
            ipAddress: req ? req.ip : null,
            userAgent: req ? req.get('user-agent') : null,
            metadata: {
              result: 'win',
              winnings,
              betType: bet.type
            }
          }], { session });
        } else {
          // Loss: Already deducted on place
          wallet.totalLoss += bet.matchedAmount;
          bet.settlementResult = Bet.SETTLEMENT_RESULT.LOSE;

          await WalletTransaction.create([{
            wallet: wallet._id,
            user: bet.userId,
            transactionType: WalletTransaction.TRANSACTION_TYPES.BET_SETTLED,
            amount: -bet.matchedAmount,
            balanceBefore,
            balanceAfter: balanceBefore,
            currency: wallet.currency,
            status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
            description: `Bet settled: Lost ${bet.matchedAmount} on ${bet.sectionName}`,
            performedBy: performedBy,
            betId: bet._id,
            ipAddress: req ? req.ip : null,
            userAgent: req ? req.get('user-agent') : null,
            metadata: {
              result: 'lose',
              loss: bet.matchedAmount,
              betType: bet.type
            }
          }], { session });
        }
      } else {
        // Lay bet
        if (!isWinner) {
          // Win: Keep stake
          wallet.availableBalance += bet.matchedAmount;
          wallet.balance = wallet.availableBalance + wallet.lockedBalance;
          wallet.totalProfit += bet.matchedAmount;
          bet.settlementResult = Bet.SETTLEMENT_RESULT.WIN;

          await WalletTransaction.create([{
            wallet: wallet._id,
            user: bet.userId,
            transactionType: WalletTransaction.TRANSACTION_TYPES.BET_SETTLED,
            amount: bet.matchedAmount,
            balanceBefore,
            balanceAfter: wallet.balance,
            currency: wallet.currency,
            status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
            description: `Bet settled: Won ${bet.matchedAmount} on ${bet.sectionName}`,
            performedBy: performedBy,
            betId: bet._id,
            ipAddress: req ? req.ip : null,
            userAgent: req ? req.get('user-agent') : null,
            metadata: {
              result: 'win',
              winnings: bet.matchedAmount,
              betType: bet.type
            }
          }], { session });
        } else {
          // Loss: Pay liability
          const liability = bet.matchedAmount * (bet.odds - 1);
          wallet.availableBalance -= liability;
          wallet.balance = wallet.availableBalance + wallet.lockedBalance;
          wallet.totalLoss += liability;
          bet.settlementResult = Bet.SETTLEMENT_RESULT.LOSE;

          await WalletTransaction.create([{
            wallet: wallet._id,
            user: bet.userId,
            transactionType: WalletTransaction.TRANSACTION_TYPES.BET_SETTLED,
            amount: -liability,
            balanceBefore,
            balanceAfter: wallet.balance,
            currency: wallet.currency,
            status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
            description: `Bet settled: Lost ${liability} on ${bet.sectionName}`,
            performedBy: performedBy,
            betId: bet._id,
            ipAddress: req ? req.ip : null,
            userAgent: req ? req.get('user-agent') : null,
            metadata: {
              result: 'lose',
              loss: liability,
              betType: bet.type
            }
          }], { session });
        }
      }

      bet.status = Bet.BET_STATUS.SETTLED;
      bet.settledAt = new Date();
      await bet.save({ session });
      await wallet.save({ session });

      settledCount++;
    }

    await session.commitTransaction();
    session.endSession();

    return {
      message: `Settled ${settledCount} bet(s) for event ${eventId}`,
      settledCount
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

/**
 * Get user bets
 */
const getUserBets = async (userId, query = {}) => {
  const {
    page = 1,
    limit = 20,
    status,
    type,
    eventId,
    marketId
  } = query;

  const skip = (page - 1) * limit;

  const filter = { userId };

  if (status) {
    filter.status = status;
  }

  if (type) {
    filter.type = type;
  }

  if (eventId) {
    filter.eventId = eventId;
  }

  if (marketId) {
    filter.marketId = marketId;
  }

  const bets = await Bet.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('matchedWith.betId', 'userId type odds stake');

  const total = await Bet.countDocuments(filter);

  return {
    bets,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get bet by ID
 */
const getBetById = async (betId, userId = null) => {
  const filter = { _id: betId };
  if (userId) {
    filter.userId = userId;
  }

  const bet = await Bet.findOne(filter)
    .populate('userId', 'username name email')
    .populate('matchedWith.betId', 'userId type odds stake');

  if (!bet) {
    throw new Error('Bet not found');
  }

  return bet;
};

module.exports = {
  placeBet,
  matchBet,
  cancelBet,
  settleEvent,
  getUserBets,
  getBetById
};
