const mongoose = require('mongoose');
const Bet = require('../../models/Bet');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const { withTransaction, getSession, commitSession, abortSession } = require('../../utils/transaction.helper');

// Event services - cached data from socket polling
const { getLatestCricketEventData } = require('../../services/cricketevent.service');
const { getLatestSoccerEventData } = require('../../services/soccerevent.service');
const { getLatestTennisEventData } = require('../../services/tennisevent.service');

// Helper to conditionally apply session to queries
const withSession = (query, session) => {
  return session ? query.session(session) : query;
};

// Helper to conditionally include session in options
const sessionOpts = (session) => {
  return session ? { session } : {};
};

// Helper: decimal-safe add/sub using integers (paise)
const toInt = (amount) => Math.round(amount * 100);
const fromInt = (val) => Math.round(val) / 100;

/**
 * Get event data from cached socket data based on sport
 * This data is updated every ~400ms by socket polling
 */
const getEventDataFromCache = (sport, eventId) => {
  switch (sport) {
    case 'cricket':
      return getLatestCricketEventData(eventId);
    case 'soccer':
      return getLatestSoccerEventData(eventId);
    case 'tennis':
      return getLatestTennisEventData(eventId);
    default:
      return null;
  }
};

/**
 * Calculate exposure for a bet based on market type and bet type
 */
const calculateExposure = ({ marketType, betType, stake, odds, rate }) => {
  switch (marketType) {
    case Bet.MARKET_TYPES.MATCH_ODDS: {
      if (!odds) throw new Error('Odds required for MATCH_ODDS');
      if (betType === 'back') {
        // Back exposure is stake
        return stake;
      }
      if (betType === 'lay') {
        // Lay exposure = (odds - 1) * stake
        return (odds - 1) * stake;
      }
      throw new Error('Invalid betType for MATCH_ODDS');
    }

    case Bet.MARKET_TYPES.BOOKMAKERS_FANCY: {
      if (!rate) throw new Error('Rate required for BOOKMAKERS_FANCY');
      // Fancy: lock full stake for YES/NO
      return stake;
    }

    case Bet.MARKET_TYPES.LINE_MARKET:
    case Bet.MARKET_TYPES.METER_MARKET:
    case Bet.MARKET_TYPES.KADO_MARKET: {
      // For now: lock full stake
      return stake;
    }

    default:
      throw new Error('Unsupported market type');
  }
};

/**
 * Lock exposure in user's wallet inside a transaction
 */
const lockExposure = async ({ session, userId, exposure, description, req }) => {
  if (exposure <= 0) {
    throw new Error('Exposure must be positive');
  }

  const wallet = await withSession(Wallet.findOne({ user: userId }), session).exec();
  if (!wallet) {
    throw new Error('Wallet not found');
  }
  if (!wallet.isAvailable()) {
    throw new Error(`Wallet is ${wallet.isLocked ? 'locked' : 'inactive'}. ${wallet.lockedReason || ''}`);
  }

  const availableInt = toInt(wallet.balance);
  const lockedInt = toInt(wallet.lockedBalance);
  const exposureInt = toInt(exposure);

  if (availableInt < exposureInt) {
    throw new Error('Insufficient wallet balance to lock exposure');
  }

  const balanceBefore = wallet.balance;
  const balanceAfter = fromInt(availableInt - exposureInt);
  const lockedBefore = wallet.lockedBalance;
  const lockedAfter = fromInt(lockedInt + exposureInt);

  wallet.balance = balanceAfter;
  wallet.lockedBalance = lockedAfter;
  wallet.lastTransactionAt = new Date();
  await wallet.save(sessionOpts(session));

  await WalletTransaction.create(
    [
      {
        wallet: wallet._id,
        user: userId,
        transactionType: WalletTransaction.TRANSACTION_TYPES.DEBIT,
        amount: exposure,
        balanceBefore,
        balanceAfter,
        currency: wallet.currency,
        status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
        description: description || 'Exposure locked for bet',
        performedBy: userId,
        metadata: {
          type: 'bet_exposure_lock',
        },
        ipAddress: req ? req.ip : null,
        userAgent: req ? req.get('user-agent') : null,
      },
    ],
    sessionOpts(session)
  );

  return { wallet };
};

/**
 * Unlock exposure and optionally credit/debit net win/loss
 */
const settleExposure = async ({
  session,
  userId,
  exposure,
  netWinAmount,
  description,
  req,
}) => {
  const wallet = await withSession(Wallet.findOne({ user: userId }), session).exec();
  if (!wallet) {
    throw new Error('Wallet not found');
  }

  const availableInt = toInt(wallet.balance);
  const lockedInt = toInt(wallet.lockedBalance);
  const exposureInt = toInt(exposure);
  const netWinInt = toInt(netWinAmount || 0);

  if (lockedInt < exposureInt) {
    throw new Error('Locked exposure inconsistent for settlement');
  }

  let balanceBefore = wallet.balance;
  let balanceAfter = fromInt(availableInt + exposureInt + netWinInt);
  const lockedBefore = wallet.lockedBalance;
  const lockedAfter = fromInt(lockedInt - exposureInt);

  wallet.balance = balanceAfter;
  wallet.lockedBalance = lockedAfter;
  wallet.lastTransactionAt = new Date();
  await wallet.save(sessionOpts(session));

  // Always create at least one transaction to unlock exposure
  const txs = [];

  txs.push({
    wallet: wallet._id,
    user: userId,
    transactionType: WalletTransaction.TRANSACTION_TYPES.CREDIT,
    amount: exposure,
    balanceBefore,
    balanceAfter,
    currency: wallet.currency,
    status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
    description: description || 'Exposure unlocked on bet settlement',
    performedBy: userId,
    metadata: {
      type: 'bet_exposure_unlock',
    },
    ipAddress: req ? req.ip : null,
    userAgent: req ? req.get('user-agent') : null,
  });

  // If there is additional net win (>0) or net loss (<0), create another transaction
  if (netWinInt !== 0) {
    const isWin = netWinInt > 0;
    balanceBefore = balanceAfter;
    balanceAfter = fromInt(toInt(balanceBefore) + netWinInt);

    txs.push({
      wallet: wallet._id,
      user: userId,
      transactionType: isWin
        ? WalletTransaction.TRANSACTION_TYPES.CREDIT
        : WalletTransaction.TRANSACTION_TYPES.DEBIT,
      amount: Math.abs(netWinAmount),
      balanceBefore,
      balanceAfter,
      currency: wallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description:
        description ||
        (isWin ? 'Bet winnings credited' : 'Bet loss debited'),
      performedBy: userId,
      metadata: {
        type: 'bet_settlement',
      },
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
    });

    wallet.balance = balanceAfter;
    wallet.lastTransactionAt = new Date();
    await wallet.save(sessionOpts(session));
  }

  if (txs.length) {
    await WalletTransaction.create(txs, sessionOpts(session));
  }

  return { wallet };
};

/**
 * Place bet (market-aware)
 */
const placeBet = async (userId, payload, req) => {
  return await withTransaction(async (session) => {
    const {
      sport,
      eventId,
      eventName,
      marketId,
      marketType,
      selectionId,
      selectionName,
      betType,
      odds,
      rate,
      lineValue,
      stake,
    } = payload;

    if (!sport || !['cricket', 'soccer', 'tennis'].includes(sport)) {
      throw new Error('Invalid or missing sport');
    }

    // Fetch current event data from socket cache (updated every ~400ms)
    const eventJsonStamp = getEventDataFromCache(sport, eventId);
    if (!eventJsonStamp) {
      throw new Error(`Event data not available for ${sport} event ${eventId}. Please ensure you are subscribed to this event.`);
    }

    // Derive market name (mname) for this bet from current event snapshot
    // eventJsonStamp is an array of markets as returned by provider
    const marketsArray = Array.isArray(eventJsonStamp) ? eventJsonStamp : eventJsonStamp.data || [];
    const matchedMarket =
      Array.isArray(marketsArray) && marketsArray.length
        ? marketsArray.find((m) => String(m.mid) === String(marketId))
        : null;

    if (!matchedMarket) {
      throw new Error('value change try again');
    }

    // Verify marketId matches mid in event data
    if (String(matchedMarket.mid) !== String(marketId)) {
      throw new Error('value change try again');
    }

    // Check market status - must be OPEN to place bets
    const marketStatus = (matchedMarket.status || '').toUpperCase();
    if (marketStatus !== 'OPEN') {
      throw new Error('Market is not open');
    }

    const marketName = matchedMarket.mname || null;
    if (!marketName) {
      throw new Error('value change try again');
    }

    /**
     * Price integrity checks per market type:
     * - Ensure eventId + marketId + selectionId + betType + price still match
     *   the latest provider data from event snapshot.
     * - If anything changed (odds moved, selection status changed, etc.),
     *   reject with a generic message so frontend can re-fetch and retry.
     */
    if (marketType === Bet.MARKET_TYPES.MATCH_ODDS) {
      const sections = Array.isArray(matchedMarket.section) ? matchedMarket.section : [];

      // Try to match by sid first, fall back to nat (name)
      const matchedSection =
        sections.find((s) => String(s.sid) === String(selectionId)) ||
        sections.find((s) => s.nat === selectionName);

      if (!matchedSection || !Array.isArray(matchedSection.odds)) {
        throw new Error('value change try again');
      }

      // Check selection status - must be ACTIVE for MATCH_ODDS
      const selectionStatus = (matchedSection.gstatus || '').toUpperCase();
      if (selectionStatus !== 'ACTIVE') {
        throw new Error('value change try again');
      }

      const ladder = matchedSection.odds;
      const priceType =
        betType === 'back'
          ? 'back'
          : betType === 'lay'
          ? 'lay'
          : null;

      if (!priceType) {
        throw new Error('Invalid betType for MATCH_ODDS');
      }

      const prices = ladder
        .filter((p) => p.otype === priceType)
        .map((p) => Number(p.odds))
        .filter((v) => !Number.isNaN(v));

      if (!prices.length) {
        throw new Error('value change try again');
      }

      const currentPrice =
        priceType === 'back'
          ? Math.max(...prices) // best back = highest price
          : Math.min(...prices); // best lay = lowest price

      if (Number(odds) !== Number(currentPrice)) {
        throw new Error('value change try again');
      }
    } else if (marketType === Bet.MARKET_TYPES.BOOKMAKERS_FANCY) {
      // Bookmaker / fancy-style markets: validate section + current rate
      const sections = Array.isArray(matchedMarket.section) ? matchedMarket.section : [];

      const matchedSection =
        sections.find((s) => String(s.sid) === String(selectionId)) ||
        sections.find((s) => s.nat === selectionName);

      if (!matchedSection || !Array.isArray(matchedSection.odds)) {
        throw new Error('value change try again');
      }

      // For fancy/bookmaker, treat any explicit SUSPENDED as not allowed
      const selectionStatus = (matchedSection.gstatus || '').toUpperCase();
      if (selectionStatus === 'SUSPENDED') {
        throw new Error('value change try again');
      }

      const ladder = matchedSection.odds;
      const priceType =
        betType === 'yes'
          ? 'back'
          : betType === 'no'
          ? 'lay'
          : null;

      if (!priceType) {
        throw new Error('Invalid betType for BOOKMAKERS_FANCY');
      }

      const prices = ladder
        .filter((p) => p.otype === priceType)
        .map((p) => Number(p.odds))
        .filter((v) => !Number.isNaN(v));

      if (!prices.length) {
        throw new Error('value change try again');
      }

      const currentRate =
        priceType === 'back'
          ? Math.max(...prices)
          : Math.min(...prices);

      if (Number(rate) !== Number(currentRate)) {
        throw new Error('value change try again');
      }
    }

    const exposure = calculateExposure({
      marketType,
      betType,
      stake,
      odds,
      rate,
    });

    await lockExposure({
      session,
      userId,
      exposure,
      description: `Exposure locked for ${marketType} bet`,
      req,
    });

    const bet = await Bet.create(
      [
        {
          userId,
          sport,
          eventId,
          eventName,
          marketName,
          eventJsonStamp,
          marketId,
          marketType,
          selectionId,
          selectionName,
          betType,
          odds: odds || null,
          rate: rate || null,
          lineValue: lineValue || null,
          stake,
          exposure,
          status: Bet.BET_STATUS.OPEN,
        },
      ],
      sessionOpts(session)
    );

    return bet[0];
  });
};

/**
 * Get bets for current user
 */
const getUserBets = async (userId, query = {}) => {
  const { sport, status, marketType, limit = 50 } = query;

  const filter = { userId };
  if (sport) filter.sport = sport;
  if (status) filter.status = status;
  if (marketType) filter.marketType = marketType;

  const bets = await Bet.find(filter)
    .select('-eventJsonStamp')
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  return bets;
};

/**
 * Get all bets placed today by user
 */
const getTodayBets = async (userId, query = {}) => {
  const { sport, status, marketType, limit = 100 } = query;

  // Get start and end of today in UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const filter = {
    userId,
    createdAt: {
      $gte: today,
      $lt: tomorrow,
    },
  };

  if (sport) filter.sport = sport;
  if (status) filter.status = status;
  if (marketType) filter.marketType = marketType;

  const bets = await Bet.find(filter)
    .select('-eventJsonStamp')
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  return bets;
};

/**
 * Get all open bets placed today by user
 */
const getTodayOpenBets = async (userId, query = {}) => {
  const { sport, marketType, limit = 100 } = query;

  // Get start and end of today in UTC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const filter = {
    userId,
    status: Bet.BET_STATUS.OPEN,
    createdAt: {
      $gte: today,
      $lt: tomorrow,
    },
  };

  if (sport) filter.sport = sport;
  if (marketType) filter.marketType = marketType;

  const bets = await Bet.find(filter)
    .select('-eventJsonStamp')
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  return bets;
};

/**
 * Settlement helpers per market type
 * All of these expect you to pass the final outcome / winner info.
 */

const settleMatchOdds = async ({ session, marketId, eventId, winnerSelectionId, req }) => {
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.MATCH_ODDS,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  for (const bet of bets) {
    const isWinner = bet.selectionId === String(winnerSelectionId);
    let netWinAmount = 0;

    if (bet.betType === 'back') {
      if (isWinner) {
        // Winnings = (odds - 1) * stake
        netWinAmount = (bet.odds - 1) * bet.stake;
        bet.settlementResult = Bet.BET_RESULT.WON;
      } else {
        // Lose full stake already locked as exposure
        netWinAmount = -bet.exposure;
        bet.settlementResult = Bet.BET_RESULT.LOST;
      }
    } else if (bet.betType === 'lay') {
      if (isWinner) {
        // Lose lay liability (exposure)
        netWinAmount = -bet.exposure;
        bet.settlementResult = Bet.BET_RESULT.LOST;
      } else {
        // Win back stake-like profit: bet.stake
        netWinAmount = bet.stake;
        bet.settlementResult = Bet.BET_RESULT.WON;
      }
    }

    await settleExposure({
      session,
      userId: bet.userId,
      exposure: bet.exposure,
      netWinAmount,
      description: 'MATCH_ODDS settlement',
      req,
    });

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }
};

const settleBookmakersFancy = async ({ session, marketId, eventId, resultMap, req }) => {
  // resultMap: { selectionId: 'yes' | 'no' }
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.BOOKMAKERS_FANCY,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  for (const bet of bets) {
    const outcome = resultMap[bet.selectionId];
    if (!outcome) {
      // Void if outcome missing
      await settleExposure({
        session,
        userId: bet.userId,
        exposure: bet.exposure,
        netWinAmount: 0,
        description: 'Fancy void settlement',
        req,
      });
      bet.status = Bet.BET_STATUS.SETTLED;
      bet.settlementResult = Bet.BET_RESULT.VOID;
      bet.settledAt = new Date();
      await bet.save(sessionOpts(session));
      continue;
    }

    let netWinAmount = 0;

    if (bet.betType === 'yes') {
      if (outcome === 'yes') {
        // YES wins → payout = stake × rate / 100 (profit)
        netWinAmount = (bet.stake * bet.rate) / 100;
        bet.settlementResult = Bet.BET_RESULT.WON;
      } else {
        // YES loses → lose full stake
        netWinAmount = -bet.exposure;
        bet.settlementResult = Bet.BET_RESULT.LOST;
      }
    } else if (bet.betType === 'no') {
      if (outcome === 'no') {
        // NO wins → stake returned as net 0 (we already locked stake)
        netWinAmount = 0;
        bet.settlementResult = Bet.BET_RESULT.WON;
      } else {
        // NO loses → lose full stake
        netWinAmount = -bet.exposure;
        bet.settlementResult = Bet.BET_RESULT.LOST;
      }
    }

    await settleExposure({
      session,
      userId: bet.userId,
      exposure: bet.exposure,
      netWinAmount,
      description: 'BOOKMAKERS_FANCY settlement',
      req,
    });

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }
};

const settleLineMarket = async ({ session, marketId, eventId, finalValue, req }) => {
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.LINE_MARKET,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  for (const bet of bets) {
    let isWinner = false;
    if (bet.betType === 'over') {
      isWinner = finalValue > bet.lineValue;
    } else if (bet.betType === 'under') {
      isWinner = finalValue < bet.lineValue;
    }

    const netWinAmount = isWinner ? bet.stake : -bet.exposure;

    await settleExposure({
      session,
      userId: bet.userId,
      exposure: bet.exposure,
      netWinAmount,
      description: 'LINE_MARKET settlement',
      req,
    });

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settlementResult = isWinner
      ? Bet.BET_RESULT.WON
      : Bet.BET_RESULT.LOST;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }
};

const settleMeterMarket = async ({ session, marketId, eventId, finalValue, req }) => {
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.METER_MARKET,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  for (const bet of bets) {
    // Example: bet wins if meter crossed lineValue
    const isWinner = finalValue >= bet.lineValue;
    const netWinAmount = isWinner ? bet.stake : -bet.exposure;

    await settleExposure({
      session,
      userId: bet.userId,
      exposure: bet.exposure,
      netWinAmount,
      description: 'METER_MARKET settlement',
      req,
    });

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settlementResult = isWinner
      ? Bet.BET_RESULT.WON
      : Bet.BET_RESULT.LOST;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }
};

const settleKadoMarket = async ({ session, marketId, eventId, isWinForYes, req }) => {
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.KADO_MARKET,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  for (const bet of bets) {
    const isWinner = isWinForYes ? bet.betType === 'yes' : bet.betType === 'no';
    const multiplier = bet.rate || 2; // default x2 if not specified
    const netWinAmount = isWinner
      ? bet.stake * (multiplier - 1)
      : -bet.exposure;

    await settleExposure({
      session,
      userId: bet.userId,
      exposure: bet.exposure,
      netWinAmount,
      description: 'KADO_MARKET settlement',
      req,
    });

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settlementResult = isWinner
      ? Bet.BET_RESULT.WON
      : Bet.BET_RESULT.LOST;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }
};

/**
 * Admin settlement entrypoint
 */
const settleMarket = async (payload, req) => {
  return await withTransaction(async (session) => {
    const { marketType, marketId, eventId } = payload;

    switch (marketType) {
      case Bet.MARKET_TYPES.MATCH_ODDS:
        await settleMatchOdds({
          session,
          marketId,
          eventId,
          winnerSelectionId: payload.winnerSelectionId,
          req,
        });
        break;
      case Bet.MARKET_TYPES.BOOKMAKERS_FANCY:
        await settleBookmakersFancy({
          session,
          marketId,
          eventId,
          resultMap: payload.resultMap || {},
          req,
        });
        break;
      case Bet.MARKET_TYPES.LINE_MARKET:
        await settleLineMarket({
          session,
          marketId,
          eventId,
          finalValue: payload.finalValue,
          req,
        });
        break;
      case Bet.MARKET_TYPES.METER_MARKET:
        await settleMeterMarket({
          session,
          marketId,
          eventId,
          finalValue: payload.finalValue,
          req,
        });
        break;
      case Bet.MARKET_TYPES.KADO_MARKET:
        await settleKadoMarket({
          session,
          marketId,
          eventId,
          isWinForYes: payload.isWinForYes,
          req,
        });
        break;
      default:
        throw new Error('Unsupported market type for settlement');
    }
  });
};

module.exports = {
  placeBet,
  getUserBets,
  getTodayBets,
  getTodayOpenBets,
  settleMarket,
};

