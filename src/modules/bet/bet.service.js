const mongoose = require('mongoose');
const Bet = require('../../models/Bet');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const { User, ROLES } = require('../../models/User');
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

// Helper: float comparison with tolerance
const FLOAT_EPSILON = 0.0001;
const floatEquals = (a, b) => Math.abs(Number(a) - Number(b)) < FLOAT_EPSILON;

// Helper: normalize oname for comparison (remove spaces, lowercase)
// Provider: "back2", Frontend may send: "back 2" or "Back2"
const normalizeOname = (oname) => String(oname || '').replace(/\s+/g, '').toLowerCase();

// Standardized service errors (controller will format response)
const betError = (code, message, status = 400) => {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  return err;
};
const betConflict = (code, message) => betError(code, message, 409);

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
    // match-style back/lay with odds-based liability
    case Bet.MARKET_TYPES.MATCH_ODDS:
    case Bet.MARKET_TYPES.TIED_MATCH:
    case Bet.MARKET_TYPES.TOS_MARKET:
    case Bet.MARKET_TYPES.OVER_BY_OVER:
    case Bet.MARKET_TYPES.ODDEVEN: {
      if (!odds) throw new Error('Odds required');
      if (betType === 'back') return stake;
      if (betType === 'lay') return (odds - 1) * stake;
      throw new Error('Invalid betType (back/lay)');
    }

    // Fancy: fixed ±stake P/L (both sides lock full stake)
    case Bet.MARKET_TYPES.FANCY: {
      if (!stake) throw new Error('Stake required for FANCY');
      return stake;
    }

    case Bet.MARKET_TYPES.BOOKMAKERS_FANCY: {
      if (!rate) throw new Error('Rate required for BOOKMAKERS_FANCY');
      return stake;
    }

    case Bet.MARKET_TYPES.LINE_MARKET:
    case Bet.MARKET_TYPES.METER_MARKET:
    case Bet.MARKET_TYPES.KADO_MARKET: {
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
 * 
 * Matching conditions:
 * - eventId: to fetch event data from cache
 * - marketId: to find the market
 * - marketType: to determine bet validation
 * - selectionId: to find the section
 * - betType: back/lay (maps to otype)
 * - priceOname: to find exact odds row
 * - odds: to verify the odds value matches
 */
const placeBet = async (userId, payload, req) => {
  console.log('placeBet payload', payload);
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
      // rate is optional in payload; for BOOKMAKERS_FANCY we treat odds as rate
      rate: rawRate,
      priceOname: clientPriceOname,
      lineValue,
      stake,
    } = payload;

    // Normalize marketType alias from frontend
    const effectiveMarketType =
      marketType === 'tos_maket' ? Bet.MARKET_TYPES.TOS_MARKET : marketType;

    if (!sport || !['cricket', 'soccer', 'tennis'].includes(sport)) {
      throw betError('INVALID_SPORT', 'Invalid sport', 400);
    }

    // 1. Fetch event data from cache by eventId
    const eventJsonStamp = getEventDataFromCache(sport, eventId);
    if (!eventJsonStamp) {
      throw betConflict(
        'EVENT_DATA_NOT_AVAILABLE',
        'Event data not available. Please refresh and try again.'
      );
    }

    // 2. Find market by marketId
    const marketsArray = Array.isArray(eventJsonStamp) ? eventJsonStamp : eventJsonStamp.data || [];
    const matchedMarket =
      Array.isArray(marketsArray) && marketsArray.length
        ? marketsArray.find((m) => String(m.mid) === String(marketId))
        : null;

    if (!matchedMarket) {
      throw betConflict(
        'MARKET_NOT_FOUND',
        'Market not available. Please refresh and try again.'
      );
    }

    const marketName = matchedMarket.mname || null;

    // 3. Find section by selectionId
    const sections = Array.isArray(matchedMarket.section) ? matchedMarket.section : [];
    const matchedSection = sections.find((s) => String(s.sid) === String(selectionId));

    if (!matchedSection || !Array.isArray(matchedSection.odds)) {
      throw betConflict(
        'SELECTION_NOT_AVAILABLE',
        'Selection not available. Please refresh and try again.'
      );
    }

    // 4. Map betType to otype (back/lay or yes->back, no->lay)
    let otype;
    const backLayMarketTypes = [
      Bet.MARKET_TYPES.MATCH_ODDS,
      Bet.MARKET_TYPES.TIED_MATCH,
      Bet.MARKET_TYPES.TOS_MARKET,
      Bet.MARKET_TYPES.FANCY,
      Bet.MARKET_TYPES.OVER_BY_OVER,
      Bet.MARKET_TYPES.ODDEVEN,
    ];
    if (backLayMarketTypes.includes(effectiveMarketType)) {
      if (!['back', 'lay'].includes(betType)) {
        throw betError('INVALID_BET_TYPE', 'betType must be back or lay', 400);
      }
      otype = betType;
    } else if (effectiveMarketType === Bet.MARKET_TYPES.BOOKMAKERS_FANCY) {
      if (!['yes', 'no'].includes(betType)) {
        throw betError('INVALID_BET_TYPE', 'betType must be yes or no for BOOKMAKERS_FANCY', 400);
      }
      otype = betType === 'yes' ? 'back' : 'lay';
    } else {
      throw betError('UNSUPPORTED_MARKET_TYPE', `Market type ${effectiveMarketType} is not supported`, 400);
    }

    // 5. Validate odds is provided
    if (odds === undefined || odds === null) {
      throw betError('ODDS_REQUIRED', 'Odds are required', 400);
    }

    // 6. Validate priceOname is provided
    if (!clientPriceOname) {
      throw betError('PRICE_ONAME_REQUIRED', 'priceOname is required', 400);
    }

    // 7. Find exact odds row by priceOname (normalized) and verify odds match
    const ladder = matchedSection.odds;
    const normalizedClientOname = normalizeOname(clientPriceOname);
    
    const chosenRow = ladder.find(
      (p) =>
        String(p.otype).toLowerCase() === otype &&
        normalizeOname(p.oname) === normalizedClientOname &&
        floatEquals(p.odds, odds)
    );

    if (!chosenRow) {
      throw betConflict(
        'ODDS_NOT_MATCHED',
        'Odds not matched. Please refresh and try again.'
      );
    }

    // Provider quote snapshot to persist
    const priceTypeForBet = otype;
    const priceOname = chosenRow.oname || null;
    const priceSize = typeof chosenRow.size === 'number' ? chosenRow.size : null;
    const priceTno = typeof chosenRow.tno === 'number' ? chosenRow.tno : null;

    // For BOOKMAKERS_FANCY we conceptually treat "odds" as "rate"
    const effectiveRate =
      effectiveMarketType === Bet.MARKET_TYPES.BOOKMAKERS_FANCY
        ? odds
        : rawRate;

    const exposure = calculateExposure({
      marketType: effectiveMarketType,
      betType,
      stake,
      odds,
      rate: effectiveRate,
    });

    await lockExposure({
      session,
      userId,
      exposure,
      description: `Exposure locked for ${effectiveMarketType} bet`,
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
          marketType: effectiveMarketType,
          selectionId,
          selectionName,
          betType,
          odds: odds || null,
          rate: effectiveRate || null,
          priceType: priceTypeForBet,
          priceOname,
          priceSize,
          priceTno,
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
 * Get all user IDs under admin in hierarchy (users created by admin or by someone in their tree).
 * Uses createdBy chain: descendants = users whose createdBy eventually points to admin.
 */
const getDescendantUserIds = async (adminId) => {
  const result = await User.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(adminId) } },
    {
      $graphLookup: {
        from: 'users',
        startWith: '$_id',
        connectFromField: 'createdBy',
        connectToField: '_id',
        as: 'descendants',
      },
    },
    { $unwind: { path: '$descendants', preserveNullAndEmptyArrays: false } },
    { $group: { _id: null, userIds: { $addToSet: '$descendants._id' } } },
    { $project: { userIds: 1, _id: 0 } },
  ]);
  return result[0]?.userIds || [];
};

/**
 * Get bet list for admin filtered by hierarchy.
 * Admin sees bets only for users under them (createdBy chain).
 * Super_admin sees bets for all users.
 * Optional query.userId: restrict to that user (must be in hierarchy).
 */
const getAdminBetList = async (adminUserId, adminRole, query = {}) => {
  const { sport, status, marketType, userId: filterUserId, limit = 50, page = 1 } = query;
  const limitNum = Math.min(Number(limit) || 50, 100);
  const skip = (Math.max(1, Number(page)) - 1) * limitNum;

  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  if (!allowedUserIds.length) {
    return { bets: [], total: 0, page: 1, limit: limitNum, totalPages: 0 };
  }

  let targetUserIds = allowedUserIds;
  if (filterUserId) {
    const requestedId = mongoose.Types.ObjectId.isValid(filterUserId) ? new mongoose.Types.ObjectId(filterUserId) : null;
    if (!requestedId || !allowedUserIds.some((id) => id.toString() === requestedId.toString())) {
      throw betError('FORBIDDEN', 'You can only view bets for users in your hierarchy', 403);
    }
    targetUserIds = [requestedId];
  }

  const filter = { userId: { $in: targetUserIds } };
  if (sport) filter.sport = sport;
  if (status) filter.status = status;
  if (marketType) filter.marketType = marketType;

  const [bets, total] = await Promise.all([
    Bet.find(filter)
      .select('-eventJsonStamp')
      .populate('userId', 'username name role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    Bet.countDocuments(filter),
  ]);

  return {
    bets,
    total,
    page: Math.max(1, Number(page)),
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 0,
  };
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

// Fancy market (marketType = fancy): fixed ±stake P/L based on final run vs line
// line = bet.lineValue (preferred) or bet.odds (fallback)
const settleFancyMarket = async ({ session, marketId, eventId, finalValue, req }) => {
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.FANCY,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  for (const bet of bets) {
    const line = bet.lineValue != null ? bet.lineValue : bet.odds;
    if (line == null) {
      // Cannot settle without a line, treat as void
      await settleExposure({
        session,
        userId: bet.userId,
        exposure: bet.exposure,
        netWinAmount: 0,
        description: 'FANCY void settlement (no line)',
        req,
      });
      bet.status = Bet.BET_STATUS.SETTLED;
      bet.settlementResult = Bet.BET_RESULT.VOID;
      bet.settledAt = new Date();
      await bet.save(sessionOpts(session));
      continue;
    }

    let isWinner = false;
    if (bet.betType === 'back') {
      // back = YES / Over → win if actual >= line
      isWinner = finalValue >= line;
    } else if (bet.betType === 'lay') {
      // lay = NO / Under → win if actual < line
      isWinner = finalValue < line;
    }

    const netWinAmount = isWinner ? bet.stake : -bet.exposure;

    await settleExposure({
      session,
      userId: bet.userId,
      exposure: bet.exposure,
      netWinAmount,
      description: 'FANCY settlement',
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
      case Bet.MARKET_TYPES.FANCY:
        await settleFancyMarket({
          session,
          marketId,
          eventId,
          finalValue: payload.finalValue ?? payload.resultRun,
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
  getDescendantUserIds,
  getAdminBetList,
  getUserBets,
  getTodayBets,
  getTodayOpenBets,
  settleMarket,
};

