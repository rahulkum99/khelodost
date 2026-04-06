const mongoose = require('mongoose');
const Bet = require('../../models/Bet');
const Wallet = require('../../models/Wallet');
const WalletTransaction = require('../../models/WalletTransaction');
const { User, ROLES, ROLE_HIERARCHY } = require('../../models/User');
const { withTransaction, getSession, commitSession, abortSession } = require('../../utils/transaction.helper');
const { withUserBetLock } = require('../../utils/userBetLock.helper');

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

/** Normalize user id for Wallet/Bet queries (avoids string/ObjectId mismatch). */
const toObjectId = (id) => {
  if (!id) return id;
  if (id instanceof mongoose.Types.ObjectId) return id;
  const s = String(id);
  if (!mongoose.Types.ObjectId.isValid(s)) return id;
  return new mongoose.Types.ObjectId(s);
};

// Helper: float comparison with tolerance
const FLOAT_EPSILON = 0.0001;
const floatEquals = (a, b) => Math.abs(Number(a) - Number(b)) < FLOAT_EPSILON;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Helper: normalize oname for comparison (remove spaces, lowercase)
// Provider: "back2", Frontend may send: "back 2" or "Back2"
const normalizeOname = (oname) => String(oname || '').replace(/\s+/g, '').toLowerCase();

// Helper: normalize frontend/provider marketType aliases
const normalizeMarketTypeAlias = (marketType) => {
  if (!marketType) return marketType;
  if (marketType === 'tos_maket' || marketType === 'fancy1') return Bet.MARKET_TYPES.TOS_MARKET;
  return marketType;
};

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

// Market types where selections are treated as mutually exclusive outcomes.
// For these, wallet.lockedBalance should represent worst-case net loss across outcomes,
// not the sum of individual bet liabilities.
const MATCH_ODDS_LIKE_MARKET_TYPES = new Set([
  Bet.MARKET_TYPES.MATCH_ODDS,
  Bet.MARKET_TYPES.TIED_MATCH,
  Bet.MARKET_TYPES.TOS_MARKET,
  Bet.MARKET_TYPES.OVER_BY_OVER,
  Bet.MARKET_TYPES.ODDEVEN,
]);

/**
 * Compute worst-case (most negative) net P/L, in paise, across all possible winners
 * for match-odds style bets.
 *
 * - Uses the SAME settlement P/L rules as settleMatchOdds/settleTOSMarket helpers.
 */
const computeMatchOddsNetLiabilityPaiseInt = (bets, outcomeSelectionIdsOverride = null) => {
  if (!bets || bets.length === 0) return 0;

  const outcomeSelectionIds = Array.isArray(outcomeSelectionIdsOverride) && outcomeSelectionIdsOverride.length
    ? Array.from(new Set(outcomeSelectionIdsOverride.map((x) => String(x))))
    : Array.from(new Set(bets.map((b) => String(b.selectionId))));

  // IMPORTANT:
  // If user has bets on >= 2 selections, we simulate only those selections as possible winners.
  // This matches your requirement that there is no 3rd outcome for tos_market/fancy1.
  // If user has bets on exactly 1 selection, we must also consider the opposite side winning,
  // otherwise first bet would incorrectly lock 0.
  const winnerScenarios =
    outcomeSelectionIds.length === 1
      ? [outcomeSelectionIds[0], '__OTHER__']
      : outcomeSelectionIds;

  let minNetPaise = null;
  for (const winnerSelectionId of winnerScenarios) {
    let netPaise = 0;

    for (const bet of bets) {
      const isWinner =
        winnerSelectionId === '__OTHER__'
          ? false
          : (winnerSelectionId !== null && String(bet.selectionId) === String(winnerSelectionId));

      if (bet.betType === 'back') {
        if (isWinner) {
          // profit = (odds - 1) * stake
          netPaise += toInt((Number(bet.odds || 1) - 1) * Number(bet.stake));
        } else {
          // loss = -exposure (for back exposure == stake)
          netPaise += -toInt(bet.exposure || bet.stake);
        }
      } else if (bet.betType === 'lay') {
        if (isWinner) {
          // loss = -exposure
          netPaise += -toInt(bet.exposure || bet.stake);
        } else {
          // profit = stake
          netPaise += toInt(bet.stake);
        }
      }
    }

    minNetPaise = minNetPaise === null ? netPaise : Math.min(minNetPaise, netPaise);
  }

  return minNetPaise < 0 ? -minNetPaise : 0;
};

// Extract all selectionIds under a market from a provider eventJsonStamp snapshot.
const extractMarketSelectionIdsFromStamp = ({ eventJsonStamp, marketId }) => {
  if (!eventJsonStamp || !marketId) return [];
  const marketsArray = Array.isArray(eventJsonStamp)
    ? eventJsonStamp
    : (Array.isArray(eventJsonStamp.data) ? eventJsonStamp.data : []);
  const matchedMarket = Array.isArray(marketsArray)
    ? marketsArray.find((m) => String(m.mid) === String(marketId))
    : null;
  const sections = Array.isArray(matchedMarket?.section) ? matchedMarket.section : [];
  return sections
    .map((s) => s?.sid)
    .filter((sid) => sid !== undefined && sid !== null && String(sid).trim() !== '')
    .map((sid) => String(sid));
};

/**
 * Compute worst-case net loss (paise) for BOOKMAKERS_FANCY open bets.
 * Uses the same P/L rules as settleBookmakersFancy:
 * - betType 'yes': win => +stake*rate/100, lose => -exposure
 * - betType 'no' : win => 0, lose => -exposure
 */
const computeBookmakersFancyNetLiabilityPaiseInt = (bets) => {
  if (!bets || bets.length === 0) return 0;

  const outcomeSelectionIds = Array.from(new Set(bets.map((b) => String(b.selectionId))));
  const winnerScenarios = outcomeSelectionIds;

  let minNetPaise = null;
  for (const winnerSelectionId of winnerScenarios) {
    let netPaise = 0;

    for (const bet of bets) {
      const isWinner = winnerSelectionId !== null && String(bet.selectionId) === String(winnerSelectionId);
      const exposurePaise = toInt(bet.exposure || bet.stake || 0);

      if (bet.betType === 'yes') {
        if (isWinner) {
          // profit = stake*rate/100
          netPaise += toInt((Number(bet.stake) * Number(bet.rate || 0)) / 100);
        } else {
          netPaise += -exposurePaise;
        }
      } else if (bet.betType === 'no') {
        if (!isWinner) {
          // win => 0
          netPaise += 0;
        } else {
          netPaise += -exposurePaise;
        }
      }
    }

    minNetPaise = minNetPaise === null ? netPaise : Math.min(minNetPaise, netPaise);
  }

  return minNetPaise < 0 ? -minNetPaise : 0;
};

/**
 * Total locked exposure (paise) from bet rows (same shape as OPEN bet lean docs).
 * Optionally include not-yet-saved rows (e.g. prospective place-bet) so limits run before insert.
 */
const computeLockedPaiseFromBetRows = (rows) => {
  const groups = new Map();
  for (const bet of rows) {
    const key = `${bet.sport}|${bet.eventId}|${bet.marketId}|${bet.marketType}`;
    const existing = groups.get(key);
    if (existing) existing.bets.push(bet);
    else groups.set(key, { marketType: bet.marketType, bets: [bet] });
  }

  let totalLockedPaise = 0;
  for (const { marketType, bets } of groups.values()) {
    if (MATCH_ODDS_LIKE_MARKET_TYPES.has(marketType)) {
      const outcomeIds = bets.map((b) => String(b.selectionId));
      totalLockedPaise += computeMatchOddsNetLiabilityPaiseInt(bets, outcomeIds);
    } else if (marketType === Bet.MARKET_TYPES.BOOKMAKERS_FANCY) {
      totalLockedPaise += computeBookmakersFancyNetLiabilityPaiseInt(bets);
    } else {
      totalLockedPaise += bets.reduce((acc, b) => acc + toInt(b.exposure || 0), 0);
    }
  }

  return totalLockedPaise;
};

/**
 * Compute wallet.lockedBalance (as paise integer) from ALL OPEN bets for one user.
 * For match-odds style markets, uses net worst-case loss per market (mutually exclusive).
 * For other market types, falls back to SUM of individual bet exposure.
 */
const computeUserLockedBalancePaiseInt = async ({ userId, session, extraBets = [] }) => {
  const uid = toObjectId(userId);
  const openBets = await withSession(
    Bet.find({
      userId: uid,
      status: Bet.BET_STATUS.OPEN,
    }).select('sport eventId marketId marketType selectionId betType stake odds exposure rate eventJsonStamp'),
    session
  ).exec();

  const rows = extraBets.length ? [...openBets, ...extraBets] : openBets;
  return computeLockedPaiseFromBetRows(rows);
};

/**
 * Sync wallet.balance + wallet.lockedBalance to match OPEN bets risk definition.
 * netWinAmountPaiseInt is a change to wallet total (balance + lockedBalance) due to settlement/cancel.
 */
const syncWalletToOpenBetsRisk = async ({
  session,
  userId,
  netWinAmountPaiseInt = 0,
  exposureLimitPaiseInt = null,
  description,
  req,
  requireWalletAvailable = true,
}) => {
  const wallet = await withSession(Wallet.findOne({ user: toObjectId(userId) }), session).exec();
  if (!wallet) throw new Error('Wallet not found');
  if (requireWalletAvailable && !wallet.isAvailable()) {
    throw new Error(`Wallet is ${wallet.isLocked ? 'locked' : 'inactive'}. ${wallet.lockedReason || ''}`);
  }

  const balanceBeforePaise = toInt(wallet.balance);
  const lockedBeforePaise = toInt(wallet.lockedBalance);
  const totalBeforePaise = balanceBeforePaise + lockedBeforePaise;

  const lockedAfterPaise = await computeUserLockedBalancePaiseInt({ userId, session });
  if (
    exposureLimitPaiseInt != null &&
    Number.isFinite(exposureLimitPaiseInt) &&
    lockedAfterPaise > exposureLimitPaiseInt
  ) {
    throw betError(
      'EXPOSURE_LIMIT_EXCEEDED',
      `Exposure limit exceeded. Limit: ${fromInt(exposureLimitPaiseInt)}, current exposure: ${fromInt(lockedAfterPaise)}.`,
      400
    );
  }

  const totalAfterPaise = totalBeforePaise + netWinAmountPaiseInt;
  const balanceAfterPaise = totalAfterPaise - lockedAfterPaise;
  if (balanceAfterPaise < 0) {
    throw new Error('Insufficient wallet balance to lock exposure');
  }

  const balanceAfter = fromInt(balanceAfterPaise);
  const lockedAfter = fromInt(lockedAfterPaise);

  const deltaPaise = balanceAfterPaise - balanceBeforePaise;

  wallet.balance = balanceAfter;
  wallet.lockedBalance = lockedAfter;
  wallet.lastTransactionAt = new Date();
  await wallet.save(sessionOpts(session));

  if (deltaPaise !== 0) {
    const isCredit = deltaPaise > 0;
    await WalletTransaction.create(
      [
        {
          wallet: wallet._id,
          user: toObjectId(userId),
          transactionType: isCredit
            ? WalletTransaction.TRANSACTION_TYPES.CREDIT
            : WalletTransaction.TRANSACTION_TYPES.DEBIT,
          amount: fromInt(Math.abs(deltaPaise)),
          balanceBefore: fromInt(balanceBeforePaise),
          balanceAfter,
          currency: wallet.currency,
          status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
          description: description || 'Wallet risk sync',
          performedBy: toObjectId(userId),
          metadata: {
            type: 'bet_locked_balance_risk_sync',
            netWinAmountPaise: netWinAmountPaiseInt,
            lockedBeforePaise: lockedBeforePaise,
            lockedAfterPaise,
          },
          ipAddress: req ? req.ip : null,
          userAgent: req ? req.get('user-agent') : null,
        },
      ],
      sessionOpts(session)
    );
  }

  return { wallet, lockedAfter, balanceAfter };
};

/**
 * Lock exposure in user's wallet inside a transaction
 */
const lockExposure = async ({ session, userId, exposure, description, req }) => {
  if (exposure <= 0) {
    throw new Error('Exposure must be positive');
  }

  const wallet = await withSession(Wallet.findOne({ user: toObjectId(userId) }), session).exec();
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
        user: toObjectId(userId),
        transactionType: WalletTransaction.TRANSACTION_TYPES.DEBIT,
        amount: exposure,
        balanceBefore,
        balanceAfter,
        currency: wallet.currency,
        status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
        description: description || 'Exposure locked for bet',
        performedBy: toObjectId(userId),
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
  const wallet = await withSession(Wallet.findOne({ user: toObjectId(userId) }), session).exec();
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

  const lockedAfter = fromInt(lockedInt - exposureInt);
  const afterUnlockInt = availableInt + exposureInt;
  const balanceAfterUnlock = fromInt(afterUnlockInt);
  const finalBalanceInt = afterUnlockInt + netWinInt;
  const finalBalance = fromInt(finalBalanceInt);

  if (finalBalanceInt < 0) {
    throw new Error(
      'Settlement would make wallet balance negative; check exposure / net win amounts.'
    );
  }

  const balanceBeforeStart = wallet.balance;

  // Base description for ledger (e.g. "MATCH_ODDS settlement", "BOOKMAKERS_FANCY settlement")
  const baseDesc = description || 'Bet settlement';

  const txs = [];

  // 1) Unlock exposure only (ledger matches wallet math; do not apply netWin twice)
  txs.push({
    wallet: wallet._id,
    user: toObjectId(userId),
    transactionType: WalletTransaction.TRANSACTION_TYPES.CREDIT,
    amount: exposure,
    balanceBefore: balanceBeforeStart,
    balanceAfter: balanceAfterUnlock,
    currency: wallet.currency,
    status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
    description: `${baseDesc} — exposure returned`,
    performedBy: toObjectId(userId),
    metadata: {
      type: 'bet_exposure_unlock',
    },
    ipAddress: req ? req.ip : null,
    userAgent: req ? req.get('user-agent') : null,
  });

  // 2) Optional win/loss relative to unlocked funds
  if (netWinInt !== 0) {
    const isWin = netWinInt > 0;
    txs.push({
      wallet: wallet._id,
      user: toObjectId(userId),
      transactionType: isWin
        ? WalletTransaction.TRANSACTION_TYPES.CREDIT
        : WalletTransaction.TRANSACTION_TYPES.DEBIT,
      amount: Math.abs(netWinAmount),
      balanceBefore: balanceAfterUnlock,
      balanceAfter: finalBalance,
      currency: wallet.currency,
      status: WalletTransaction.TRANSACTION_STATUS.COMPLETED,
      description: isWin ? `${baseDesc} — win` : `${baseDesc} — loss`,
      performedBy: toObjectId(userId),
      metadata: {
        type: 'bet_settlement',
      },
      ipAddress: req ? req.ip : null,
      userAgent: req ? req.get('user-agent') : null,
    });
  }

  wallet.balance = finalBalance;
  wallet.lockedBalance = lockedAfter;
  wallet.lastTransactionAt = new Date();
  await wallet.save(sessionOpts(session));

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
  const lockUid = toObjectId(userId);
  return await withUserBetLock(
    lockUid,
    async () =>
      withTransaction(async (session) => {
        const uid = lockUid;
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

        if (!sport || !['cricket', 'soccer', 'tennis', 'casino'].includes(sport)) {
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

    // 7. Find exact odds row by priceOname (normalized) and verify odds match.
    // Match is intentionally checked only after 2 seconds using fresh cache data.
    const normalizedClientOname = normalizeOname(clientPriceOname);
    const findMatchingOddsRow = (oddsRows) =>
      oddsRows.find(
        (p) =>
          String(p.otype).toLowerCase() === otype &&
          normalizeOname(p.oname) === normalizedClientOname &&
          floatEquals(p.odds, odds)
      );

    await sleep(2000);

    const refreshedStamp = getEventDataFromCache(sport, eventId);
    const refreshedMarkets = Array.isArray(refreshedStamp) ? refreshedStamp : refreshedStamp?.data || [];
    const refreshedMarket = Array.isArray(refreshedMarkets)
      ? refreshedMarkets.find((m) => String(m.mid) === String(marketId))
      : null;
    const refreshedSections = Array.isArray(refreshedMarket?.section) ? refreshedMarket.section : [];
    const refreshedSection = refreshedSections.find((s) => String(s.sid) === String(selectionId));

    const chosenRow =
      refreshedSection && Array.isArray(refreshedSection.odds)
        ? findMatchingOddsRow(refreshedSection.odds)
        : null;

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

        const [userForLimit, walletForLimit] = await Promise.all([
          withSession(User.findById(uid).select('exposureLimit'), session).lean().exec(),
          withSession(Wallet.findOne({ user: uid }), session).exec(),
        ]);
        if (!userForLimit) {
          throw betError('USER_NOT_FOUND', 'User not found', 404);
        }
        if (!walletForLimit) {
          throw betError('WALLET_NOT_FOUND', 'Wallet not found', 404);
        }
        if (!walletForLimit.isAvailable()) {
          throw betError(
            'WALLET_UNAVAILABLE',
            `Wallet is ${walletForLimit.isLocked ? 'locked' : 'inactive'}. ${walletForLimit.lockedReason || ''}`.trim(),
            400
          );
        }

        // Insufficient funds / exposure is enforced in syncWalletToOpenBetsRisk using
        // total (balance + locked) vs recomputed locked from all OPEN bets (correct for hedging).

        const rawExposureLimit = userForLimit.exposureLimit;
        const exposureLimitPaiseInt =
          rawExposureLimit != null && Number.isFinite(Number(rawExposureLimit))
            ? toInt(Number(rawExposureLimit))
            : null;

        // Enforce exposure limit and total funds *before* insert so standalone Mongo (no txn)
        // cannot leave an OPEN bet when syncWalletToOpenBetsRisk throws afterward.
        const prospectiveBet = {
          sport,
          eventId,
          marketId,
          marketType: effectiveMarketType,
          selectionId,
          betType,
          stake,
          odds: odds || null,
          rate: effectiveRate || null,
          exposure,
          eventJsonStamp,
        };
        const lockedIfPlaced = await computeUserLockedBalancePaiseInt({
          userId: uid,
          session,
          extraBets: [prospectiveBet],
        });
        if (
          exposureLimitPaiseInt != null &&
          Number.isFinite(exposureLimitPaiseInt) &&
          lockedIfPlaced > exposureLimitPaiseInt
        ) {
          throw betError(
            'EXPOSURE_LIMIT_EXCEEDED',
            `Exposure limit exceeded. Limit: ${fromInt(exposureLimitPaiseInt)}, current exposure: ${fromInt(lockedIfPlaced)}.`,
            400
          );
        }
        const totalBeforePaise =
          toInt(Number(walletForLimit.balance || 0)) + toInt(Number(walletForLimit.lockedBalance || 0));
        if (totalBeforePaise - lockedIfPlaced < 0) {
          throw betError('INSUFFICIENT_WALLET_BALANCE', 'Insufficient wallet balance to place bet', 400);
        }

        const bet = await Bet.create(
          [
            {
              userId: uid,
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

        const { wallet: syncedWallet } = await syncWalletToOpenBetsRisk({
          session,
          userId: uid,
          netWinAmountPaiseInt: 0,
          exposureLimitPaiseInt,
          description: `Exposure risk sync for ${effectiveMarketType} bet`,
          req,
        });

        const placedBet = bet[0].toObject();
        return {
          ...placedBet,
          wallet: {
            balance: syncedWallet.balance,
            lockedBalance: syncedWallet.lockedBalance,
            exposure: syncedWallet.lockedBalance,
            exposer: syncedWallet.lockedBalance,
          },
        };
      }),
    { ttlMs: 8000, waitMs: 5000 }
  );
};

/**
 * Get all user IDs under admin in hierarchy (users created by admin or by someone in their tree).
 * Uses createdBy chain: descendants = users whose createdBy eventually points to admin.
 * 
 * Note: In the users collection, each child stores `createdBy` pointing to its parent.
 * For $graphLookup we must therefore:
 * - startWith: parent's `_id`
 * - connectFromField: `_id` (current node id)
 * - connectToField: `createdBy` (edge from child to parent)
 */
const getDescendantUserIds = async (adminId) => {
  const result = await User.aggregate([
    { $match: { _id: new mongoose.Types.ObjectId(adminId) } },
    {
      $graphLookup: {
        from: 'users',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'createdBy',
        as: 'descendants',
      },
    },
    { $unwind: { path: '$descendants', preserveNullAndEmptyArrays: false } },
    { $group: { _id: null, userIds: { $addToSet: '$descendants._id' } } },
    { $project: { userIds: 1, _id: 0 } },
  ]);
  return result[0]?.userIds || [];
};

const sortHierarchyNodes = (a, b) => {
  const aLvl = ROLE_HIERARCHY[a.role] || 0;
  const bLvl = ROLE_HIERARCHY[b.role] || 0;
  if (bLvl !== aLvl) return bLvl - aLvl;
  return String(a.username || '').localeCompare(String(b.username || ''), 'en', { sensitivity: 'base' });
};

const buildUserHierarchyTree = ({ users }) => {
  const byId = new Map();
  users.forEach((u) => {
    byId.set(String(u._id), { ...u, children: [] });
  });

  const roots = [];
  byId.forEach((node) => {
    const parentId = node.createdBy ? String(node.createdBy) : null;
    const parent = parentId ? byId.get(parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortDeep = (arr) => {
    arr.sort(sortHierarchyNodes);
    arr.forEach((n) => sortDeep(n.children));
  };
  sortDeep(roots);
  return roots;
};

/**
 * Get bet list for admin filtered by hierarchy.
 * Admin sees bets only for users under them (createdBy chain).
 * Super_admin sees bets for all users.
 * Optional query.userId: restrict to that user (must be in hierarchy).
 */
const getAdminBetList = async (adminUserId, adminRole, query = {}) => {
  const { sport, status, settlement, marketType, userId: filterUserId, from, to, limit = 50, page = 1 } = query;
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
  if (settlement) {
    if (settlement === 'settled') filter.status = Bet.BET_STATUS.SETTLED;
    if (settlement === 'unsettled') filter.status = Bet.BET_STATUS.OPEN;
    if (settlement === 'void') {
      filter.status = Bet.BET_STATUS.SETTLED;
      filter.settlementResult = Bet.BET_RESULT.VOID;
    }
  } else if (status) {
    filter.status = status;
  }
  if (marketType) filter.marketType = marketType;

  const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
  const toDate = to instanceof Date ? to : (to ? new Date(to) : null);
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) filter.createdAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) filter.createdAt.$lte = toDate;
    if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
  }

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
 * Simple market analysis for today: group bets by event and return total placed bets.
 * - Respects admin hierarchy (only users under admin).
 * - Super_admin sees all users.
 */
const getTodayInplayPlacedBets = async (adminUserId, adminRole, query = {}) => {
  const { sport, limit = 200 } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  // Determine which users this admin can see
  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  if (!allowedUserIds || !allowedUserIds.length) {
    return [];
  }

  // Today in UTC based on createdAt (bet placed time)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const match = {
    userId: { $in: allowedUserIds },
    // Only count unsettled/open bets for the market analysis.
    status: Bet.BET_STATUS.OPEN,
    createdAt: {
      $gte: today,
      $lt: tomorrow,
    },
  };

  if (sport) {
    match.sport = sport;
  } else {
    match.sport = { $ne: 'casino' };
  }

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          sport: '$sport',
          eventId: '$eventId',
          eventName: '$eventName',
        },
        totalBets: { $sum: 1 },
      },
    },
    {
      $project: {
        sport: '$_id.sport',
        eventId: '$_id.eventId',
        eventName: '$_id.eventName',
        totalBets: 1,
      },
    },
    {
      // Group again by sport to return events array per sport
      $group: {
        _id: '$sport',
        events: {
          $push: {
            eventId: '$eventId',
            eventName: '$eventName',
            totalBets: '$totalBets',
          },
        },
      },
    },
    {
      $project: {
        _id: 0,
        sport: '$_id',
        events: 1,
      },
    },
    { $sort: { sport: 1 } },
    { $limit: limitNum },
  ]);

  return rows;
};

/**
 * Get bets for current user
 * If `from` and `to` are both omitted, defaults to today (UTC midnight → next midnight), same window as /today-bets.
 */
const getUserBets = async (userId, query = {}) => {
  const { sport, status, marketType, eventId, marketId, from, to, limit = 50 } = query;

  const filter = { userId };
  if (sport) filter.sport = sport;
  if (status) filter.status = status;
  if (marketType) filter.marketType = marketType;
  if (eventId) filter.eventId = String(eventId);
  if (marketId) filter.marketId = String(marketId);

  if (!from && !to) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    filter.createdAt = { $gte: todayStart, $lt: tomorrowStart };
  } else {
    const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
    const toDate = to instanceof Date ? to : (to ? new Date(to) : null);
    if (fromDate || toDate) {
      filter.createdAt = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) filter.createdAt.$gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) filter.createdAt.$lte = toDate;
      if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
    }
  }

  const bets = await Bet.find(filter)
    .select('-eventJsonStamp')
    .sort({ createdAt: -1 })
    .limit(Number(limit));

  return bets;
};

/**
 * User P/L grouped by event (settled bets only)
 * Returns: [{ sport, eventId, eventName, profitLoss, result, display, bets, lastSettledAt }]
 * If both from and to are omitted, defaults to today (UTC), same window as GET /my-bets.
 */
const getUserProfitLossByEvent = async (userId, query = {}) => {
  const { sport, from, to, limit = 200 } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  const match = {
    userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
    status: Bet.BET_STATUS.SETTLED,
  };

  if (sport) match.sport = sport;

  const hasFrom = from != null && from !== '';
  const hasTo = to != null && to !== '';

  if (!hasFrom && !hasTo) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    match.settledAt = { $gte: todayStart, $lt: tomorrowStart };
  } else {
    const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
    const toDate = to instanceof Date ? to : (to ? new Date(to) : null);
    if (fromDate || toDate) {
      match.settledAt = {};
      if (fromDate && !Number.isNaN(fromDate.getTime())) match.settledAt.$gte = fromDate;
      if (toDate && !Number.isNaN(toDate.getTime())) match.settledAt.$lte = toDate;
      if (Object.keys(match.settledAt).length === 0) delete match.settledAt;
    }
  }

  const matchOddsLike = [
    Bet.MARKET_TYPES.MATCH_ODDS,
    Bet.MARKET_TYPES.TIED_MATCH,
    Bet.MARKET_TYPES.TOS_MARKET,
    Bet.MARKET_TYPES.OVER_BY_OVER,
    Bet.MARKET_TYPES.ODDEVEN,
  ];

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $project: {
        sport: 1,
        eventId: 1,
        eventName: 1,
        marketType: 1,
        betType: 1,
        stake: 1,
        exposure: 1,
        odds: 1,
        rate: 1,
        winAmount: 1,
        settlementResult: 1,
        settledAt: 1,
      },
    },
    netWinAmountAddFields(matchOddsLike),
    {
      $group: {
        _id: { sport: '$sport', eventId: '$eventId', eventName: '$eventName' },
        profitLoss: { $sum: '$netWinAmount' },
        bets: { $sum: 1 },
        lastSettledAt: { $max: '$settledAt' },
      },
    },
    {
      $project: {
        _id: 0,
        sport: '$_id.sport',
        eventId: '$_id.eventId',
        eventName: '$_id.eventName',
        profitLoss: { $round: ['$profitLoss', 2] },
        bets: 1,
        lastSettledAt: 1,
      },
    },
    { $sort: { lastSettledAt: -1 } },
    { $limit: limitNum },
  ]);

  return rows.map((r) => {
    const profitLoss = Number(r.profitLoss || 0);
    const settlementResult =
      profitLoss > 0 ? Bet.BET_RESULT.WON : profitLoss < 0 ? Bet.BET_RESULT.LOST : Bet.BET_RESULT.VOID;
    const absAmount = Math.abs(profitLoss);
    return {
      ...r,
      result: settlementResult,
      display: `${absAmount} ${settlementResult}`,
    };
  });
};

const matchOddsLikeForPl = () => [
  Bet.MARKET_TYPES.MATCH_ODDS,
  Bet.MARKET_TYPES.TIED_MATCH,
  Bet.MARKET_TYPES.TOS_MARKET,
  Bet.MARKET_TYPES.OVER_BY_OVER,
  Bet.MARKET_TYPES.ODDEVEN,
];

/** Add netWinAmount per bet (for aggregation pipelines) */
const netWinAmountAddFields = (matchOddsLike) => ({
  $addFields: {
    netWinAmount: {
      $switch: {
        branches: [
          { case: { $eq: ['$settlementResult', Bet.BET_RESULT.VOID] }, then: 0 },
          { case: { $eq: ['$settlementResult', null] }, then: 0 },
          { case: { $eq: ['$settlementResult', Bet.BET_RESULT.LOST] }, then: { $multiply: ['$exposure', -1] } },
          {
            case: { $eq: ['$settlementResult', Bet.BET_RESULT.WON] },
            then: {
              $switch: {
                branches: [
                  {
                    case: { $eq: ['$marketType', Bet.MARKET_TYPES.CASINO] },
                    then: {
                      $subtract: [{ $ifNull: ['$winAmount', 0] }, '$stake'],
                    },
                  },
                  {
                    case: { $in: ['$marketType', matchOddsLike] },
                    then: {
                      $switch: {
                        branches: [
                          {
                            case: { $eq: ['$betType', 'back'] },
                            then: {
                              $multiply: [
                                { $subtract: [{ $ifNull: ['$odds', 1] }, 1] },
                                '$stake',
                              ],
                            },
                          },
                          { case: { $eq: ['$betType', 'lay'] }, then: '$stake' },
                        ],
                        default: '$stake',
                      },
                    },
                  },
                  {
                    case: { $eq: ['$marketType', Bet.MARKET_TYPES.BOOKMAKERS_FANCY] },
                    then: {
                      $switch: {
                        branches: [
                          {
                            case: { $eq: ['$betType', 'yes'] },
                            then: {
                              $divide: [{ $multiply: ['$stake', { $ifNull: ['$rate', 0] }] }, 100],
                            },
                          },
                          { case: { $eq: ['$betType', 'no'] }, then: 0 },
                        ],
                        default: 0,
                      },
                    },
                  },
                  {
                    case: { $eq: ['$marketType', Bet.MARKET_TYPES.KADO_MARKET] },
                    then: {
                      $let: {
                        vars: { multiplier: { $ifNull: ['$rate', 2] } },
                        in: { $multiply: ['$stake', { $subtract: ['$$multiplier', 1] }] },
                      },
                    },
                  },
                  {
                    case: {
                      $in: [
                        '$marketType',
                        [Bet.MARKET_TYPES.LINE_MARKET, Bet.MARKET_TYPES.METER_MARKET, Bet.MARKET_TYPES.FANCY],
                      ],
                    },
                    then: '$stake',
                  },
                ],
                default: '$stake',
              },
            },
          },
        ],
        default: 0,
      },
    },
  },
});

/**
 * User P/L by market within a single event.
 * Query.by === 'bet' → one row per bet (selectionName, betType, odd, stake, placedDate, profitLoss, result, display, settlementtime).
 * Otherwise → one row per market (aggregated profitLoss, bets count, first selection/betType/odd/stake/placedDate).
 */
const getUserProfitLossByEventMarkets = async (userId, query = {}) => {
  const { sport, eventId, from, to, limit = 200, by } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  if (!eventId) {
    throw betError('VALIDATION_ERROR', 'eventId is required');
  }

  const match = {
    userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
    status: Bet.BET_STATUS.SETTLED,
    eventId: String(eventId),
  };

  if (sport) match.sport = sport;
  if (query.marketId) match.marketId = String(query.marketId);

  const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
  const toDate = to instanceof Date ? to : (to ? new Date(to) : null);

  if (fromDate || toDate) {
    match.settledAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) match.settledAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) match.settledAt.$lte = toDate;
    if (Object.keys(match.settledAt).length === 0) delete match.settledAt;
  }

  const matchOddsLike = matchOddsLikeForPl();

  // Default: one row per bet (separate each bet settlement). Use by=market for aggregated per market.
  if (by !== 'market') {
    const rows = await Bet.aggregate([
      { $match: match },
      {
        $project: {
          sport: 1,
          eventId: 1,
          eventName: 1,
          marketId: 1,
          marketName: 1,
          selectionName: 1,
          betType: 1,
          stake: 1,
          exposure: 1,
          odds: 1,
          rate: 1,
          winAmount: 1,
          settlementResult: 1,
          settledAt: 1,
          createdAt: 1,
          marketType: 1,
        },
      },
      netWinAmountAddFields(matchOddsLike),
      {
        $project: {
          _id: 0,
          sport: 1,
          eventId: 1,
          eventName: 1,
          marketId: 1,
          marketName: 1,
          selectionName: 1,
          betType: 1,
          odd: '$odds',
          stake: 1,
          placedDate: '$createdAt',
          profitLoss: { $round: ['$netWinAmount', 2] },
          result: '$settlementResult',
          lastSettledAt: '$settledAt',
        },
      },
      { $sort: { lastSettledAt: -1 } },
      { $limit: limitNum },
    ]);

    return rows.map((r) => {
      const profitLoss = Number(r.profitLoss != null ? r.profitLoss : 0);
      const result = r.result || (profitLoss > 0 ? Bet.BET_RESULT.WON : profitLoss < 0 ? Bet.BET_RESULT.LOST : Bet.BET_RESULT.VOID);
      const absAmount = Math.abs(profitLoss);
      return {
        sport: r.sport,
        eventId: r.eventId,
        eventName: r.eventName,
        marketId: r.marketId,
        marketName: r.marketName,
        selectionName: r.selectionName,
        betType: (r.betType || '').toLowerCase(),
        odd: r.odd,
        stake: r.stake,
        placedDate: r.placedDate,
        bets: 1,
        lastSettledAt: r.lastSettledAt,
        profitLoss,
        result,
        display: `${absAmount} ${result}`,
        settlementtime: r.lastSettledAt,
      };
    });
  }

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $project: {
        sport: 1,
        eventId: 1,
        eventName: 1,
        marketId: 1,
        marketName: 1,
        marketType: 1,
        betType: 1,
        selectionName: 1,
        stake: 1,
        exposure: 1,
        odds: 1,
        rate: 1,
        winAmount: 1,
        settlementResult: 1,
        settledAt: 1,
        createdAt: 1,
      },
    },
    netWinAmountAddFields(matchOddsLike),
    {
      $group: {
        _id: {
          sport: '$sport',
          eventId: '$eventId',
          eventName: '$eventName',
          marketId: '$marketId',
          marketName: '$marketName',
        },
        profitLoss: { $sum: '$netWinAmount' },
        bets: { $sum: 1 },
        lastSettledAt: { $max: '$settledAt' },
        firstSelectionName: { $first: '$selectionName' },
        firstBetType: { $first: '$betType' },
        firstOdds: { $first: '$odds' },
        firstStake: { $first: '$stake' },
        firstPlacedAt: { $first: '$createdAt' },
      },
    },
    {
      $project: {
        _id: 0,
        sport: '$_id.sport',
        eventId: '$_id.eventId',
        eventName: '$_id.eventName',
        marketId: '$_id.marketId',
        marketName: '$_id.marketName',
        profitLoss: { $round: ['$profitLoss', 2] },
        bets: 1,
        lastSettledAt: 1,
        selectionName: '$firstSelectionName',
        betType: '$firstBetType',
        odd: '$firstOdds',
        stake: '$firstStake',
        placedDate: '$firstPlacedAt',
      },
    },
    { $sort: { lastSettledAt: -1 } },
    { $limit: limitNum },
  ]);

  return rows.map((r) => {
    const profitLoss = Number(r.profitLoss || 0);
    const settlementResult =
      profitLoss > 0 ? Bet.BET_RESULT.WON : profitLoss < 0 ? Bet.BET_RESULT.LOST : Bet.BET_RESULT.VOID;
    const absAmount = Math.abs(profitLoss);
    return {
      ...r,
      result: settlementResult,
      display: `${absAmount} ${settlementResult}`,
      settlementtime: r.lastSettledAt,
    };
  });
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

  const userNetAmountMapPaiseInt = new Map();
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

    const userKey = String(bet.userId);
    if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);
    userNetAmountMapPaiseInt.set(
      userKey,
      userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
    );

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }

  return userNetAmountMapPaiseInt;
};

const settleTOSMarket = async ({ session, marketId, eventId, winnerSelectionId, req }) => {
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.TOS_MARKET,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  const userNetAmountMapPaiseInt = new Map();
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

    const userKey = String(bet.userId);
    if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);
    userNetAmountMapPaiseInt.set(
      userKey,
      userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
    );

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }

  return userNetAmountMapPaiseInt;
};

const settleBookmakersFancy = async ({ session, marketId, eventId, winnerSelectionId, req }) => {
  const bets = await Bet.find({
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.BOOKMAKERS_FANCY,
    status: Bet.BET_STATUS.OPEN,
  })
    .session(session)
    .exec();

  const userNetAmountMapPaiseInt = new Map();
  for (const bet of bets) {
    const isWinnerSelection = bet.selectionId === String(winnerSelectionId);
    let netWinAmount = 0;

    if (bet.betType === 'yes') {
      if (isWinnerSelection) {
        netWinAmount = (bet.stake * bet.rate) / 100;
        bet.settlementResult = Bet.BET_RESULT.WON;
      } else {
        netWinAmount = -bet.exposure;
        bet.settlementResult = Bet.BET_RESULT.LOST;
      }
    } else if (bet.betType === 'no') {
      if (!isWinnerSelection) {
        netWinAmount = 0;
        bet.settlementResult = Bet.BET_RESULT.WON;
      } else {
        netWinAmount = -bet.exposure;
        bet.settlementResult = Bet.BET_RESULT.LOST;
      }
    }

    const userKey = String(bet.userId);
    if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);
    userNetAmountMapPaiseInt.set(
      userKey,
      userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
    );

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }

  return userNetAmountMapPaiseInt;
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

  const userNetAmountMapPaiseInt = new Map();
  for (const bet of bets) {
    let isWinner = false;
    if (bet.betType === 'over') {
      isWinner = finalValue > bet.lineValue;
    } else if (bet.betType === 'under') {
      isWinner = finalValue < bet.lineValue;
    }

    const netWinAmount = isWinner ? bet.stake : -bet.exposure;

    const userKey = String(bet.userId);
    if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);
    userNetAmountMapPaiseInt.set(
      userKey,
      userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
    );

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settlementResult = isWinner
      ? Bet.BET_RESULT.WON
      : Bet.BET_RESULT.LOST;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }

  return userNetAmountMapPaiseInt;
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

  const userNetAmountMapPaiseInt = new Map();
  for (const bet of bets) {
    // Example: bet wins if meter crossed lineValue
    const isWinner = finalValue >= bet.lineValue;
    const netWinAmount = isWinner ? bet.stake : -bet.exposure;

    const userKey = String(bet.userId);
    if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);
    userNetAmountMapPaiseInt.set(
      userKey,
      userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
    );

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settlementResult = isWinner
      ? Bet.BET_RESULT.WON
      : Bet.BET_RESULT.LOST;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }

  return userNetAmountMapPaiseInt;
};

// Fancy market (marketType = fancy): fixed ±stake P/L based on final run vs line
// line = bet.lineValue (preferred) or bet.odds (fallback)
const settleFancyMarket = async ({ session, marketId, eventId, selectionId, finalValue, req }) => {
  const filter = {
    marketId,
    eventId,
    marketType: Bet.MARKET_TYPES.FANCY,
    status: Bet.BET_STATUS.OPEN,
  };
  // Important: provider can have many sections (sid) under same mid.
  // If selectionId is provided, settle only that section's bets.
  if (selectionId !== undefined && selectionId !== null && String(selectionId).trim() !== '') {
    filter.selectionId = String(selectionId);
  }

  const bets = await Bet.find(filter)
    .session(session)
    .exec();

  const userNetAmountMapPaiseInt = new Map();
  for (const bet of bets) {
    const line = bet.lineValue != null ? bet.lineValue : bet.odds;
    if (line == null) {
      // Cannot settle without a line, treat as void
      const userKey = String(bet.userId);
      if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);

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

    const userKey = String(bet.userId);
    if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);
    userNetAmountMapPaiseInt.set(
      userKey,
      userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
    );

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settlementResult = isWinner
      ? Bet.BET_RESULT.WON
      : Bet.BET_RESULT.LOST;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }

  return userNetAmountMapPaiseInt;
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

  const userNetAmountMapPaiseInt = new Map();
  for (const bet of bets) {
    const isWinner = isWinForYes ? bet.betType === 'yes' : bet.betType === 'no';
    const multiplier = bet.rate || 2; // default x2 if not specified
    const netWinAmount = isWinner
      ? bet.stake * (multiplier - 1)
      : -bet.exposure;

    const userKey = String(bet.userId);
    if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);
    userNetAmountMapPaiseInt.set(
      userKey,
      userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
    );

    bet.status = Bet.BET_STATUS.SETTLED;
    bet.settlementResult = isWinner
      ? Bet.BET_RESULT.WON
      : Bet.BET_RESULT.LOST;
    bet.settledAt = new Date();
    await bet.save(sessionOpts(session));
  }

  return userNetAmountMapPaiseInt;
};

/**
 * Admin settlement entrypoint
 */
const settleMarket = async (payload, req) => {
  return await withTransaction(async (session) => {
    const { marketType, marketId, eventId } = payload;
    let userNetAmountMapPaiseInt = new Map();

    switch (marketType) {
      case Bet.MARKET_TYPES.MATCH_ODDS:
        userNetAmountMapPaiseInt = await settleMatchOdds({
          session,
          marketId,
          eventId,
          winnerSelectionId: payload.winnerSelectionId,
          req,
        });
        break;
      case Bet.MARKET_TYPES.TOS_MARKET:
        userNetAmountMapPaiseInt = await settleTOSMarket({
          session,
          marketId,
          eventId,
          winnerSelectionId: payload.winnerSelectionId,
          req,
        });
        break;
      case Bet.MARKET_TYPES.BOOKMAKERS_FANCY:
        userNetAmountMapPaiseInt = await settleBookmakersFancy({
          session,
          marketId,
          eventId,
          winnerSelectionId: payload.winnerSelectionId,
          req,
        });
        break;
      case Bet.MARKET_TYPES.LINE_MARKET:
        userNetAmountMapPaiseInt = await settleLineMarket({
          session,
          marketId,
          eventId,
          finalValue: payload.finalValue,
          req,
        });
        break;
      case Bet.MARKET_TYPES.METER_MARKET:
        userNetAmountMapPaiseInt = await settleMeterMarket({
          session,
          marketId,
          eventId,
          finalValue: payload.finalValue,
          req,
        });
        break;
      case Bet.MARKET_TYPES.FANCY:
        userNetAmountMapPaiseInt = await settleFancyMarket({
          session,
          marketId,
          eventId,
          selectionId: payload.selectionId,
          finalValue: payload.finalValue ?? payload.resultRun,
          req,
        });
        break;
      case Bet.MARKET_TYPES.KADO_MARKET:
        userNetAmountMapPaiseInt = await settleKadoMarket({
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

    // After bets are marked SETTLED, recompute wallet.lockedBalance for each affected user.
    // This keeps wallet math consistent with our new "net worst-case risk" definition.
    for (const [userKey, netWinPaiseInt] of userNetAmountMapPaiseInt.entries()) {
      await syncWalletToOpenBetsRisk({
        session,
        userId: userKey,
        netWinAmountPaiseInt: netWinPaiseInt,
        description: `${marketType} settlement`,
        req,
        requireWalletAvailable: false,
      });
    }
  });
};

/**
 * Admin revert settlement entrypoint
 * - Reopens previously SETTLED bets for a given market/event.
 * - Reverses the net win/loss that was applied to wallets during settlement.
 */
const revertMarketSettlement = async (payload, req) => {
  return await withTransaction(async (session) => {
    const { marketType, marketId, eventId, selectionId } = payload;

    const filter = {
      marketType,
      marketId,
      eventId,
      status: Bet.BET_STATUS.SETTLED,
    };

    // For markets that can be partially settled per selection (e.g. FANCY),
    // allow reverting only one selection if requested.
    if (selectionId !== undefined && selectionId !== null && String(selectionId).trim() !== '') {
      filter.selectionId = String(selectionId);
    }

    const bets = await Bet.find(filter).session(session).exec();
    if (!bets.length) {
      throw betError('NO_SETTLED_BETS', 'No settled bets found for this market to revert');
    }

    // Recompute the same netWinAmount that was applied on settlement,
    // so we can reverse it from each wallet.
    const userNetAmountMapPaiseInt = new Map();

    for (const bet of bets) {
      const userKey = String(bet.userId);
      if (!userNetAmountMapPaiseInt.has(userKey)) userNetAmountMapPaiseInt.set(userKey, 0);

      let netWinAmount = 0;

      switch (marketType) {
        case Bet.MARKET_TYPES.MATCH_ODDS:
        case Bet.MARKET_TYPES.TOS_MARKET: {
          if (bet.betType === 'back') {
            if (bet.settlementResult === Bet.BET_RESULT.WON) {
              netWinAmount = (bet.odds - 1) * bet.stake;
            } else if (bet.settlementResult === Bet.BET_RESULT.LOST) {
              netWinAmount = -bet.exposure;
            }
          } else if (bet.betType === 'lay') {
            if (bet.settlementResult === Bet.BET_RESULT.WON) {
              netWinAmount = bet.stake;
            } else if (bet.settlementResult === Bet.BET_RESULT.LOST) {
              netWinAmount = -bet.exposure;
            }
          }
          break;
        }

        case Bet.MARKET_TYPES.BOOKMAKERS_FANCY: {
          if (bet.betType === 'yes') {
            if (bet.settlementResult === Bet.BET_RESULT.WON) {
              netWinAmount = (bet.stake * (bet.rate || 0)) / 100;
            } else if (bet.settlementResult === Bet.BET_RESULT.LOST) {
              netWinAmount = -bet.exposure;
            }
          } else if (bet.betType === 'no') {
            if (bet.settlementResult === Bet.BET_RESULT.WON) {
              netWinAmount = 0;
            } else if (bet.settlementResult === Bet.BET_RESULT.LOST) {
              netWinAmount = -bet.exposure;
            }
          }
          break;
        }

        case Bet.MARKET_TYPES.LINE_MARKET:
        case Bet.MARKET_TYPES.METER_MARKET:
        case Bet.MARKET_TYPES.FANCY: {
          if (bet.settlementResult === Bet.BET_RESULT.WON) {
            netWinAmount = bet.stake;
          } else if (bet.settlementResult === Bet.BET_RESULT.LOST) {
            netWinAmount = -bet.exposure;
          } else {
            netWinAmount = 0;
          }
          break;
        }

        case Bet.MARKET_TYPES.KADO_MARKET: {
          if (bet.settlementResult === Bet.BET_RESULT.WON) {
            const multiplier = bet.rate || 2;
            netWinAmount = bet.stake * (multiplier - 1);
          } else if (bet.settlementResult === Bet.BET_RESULT.LOST) {
            netWinAmount = -bet.exposure;
          }
          break;
        }

        default:
          // Fallback: no wallet adjustment for unknown market type
          netWinAmount = 0;
      }

      userNetAmountMapPaiseInt.set(
        userKey,
        userNetAmountMapPaiseInt.get(userKey) + toInt(netWinAmount)
      );

      // Reopen bet
      bet.status = Bet.BET_STATUS.OPEN;
      bet.settlementResult = null;
      bet.settledAt = null;
      await bet.save(sessionOpts(session));
    }

    // Reverse the wallet changes: apply negative of the original netWinAmount
    for (const [userKey, netWinPaiseInt] of userNetAmountMapPaiseInt.entries()) {
      if (!netWinPaiseInt) continue;

      await syncWalletToOpenBetsRisk({
        session,
        userId: userKey,
        netWinAmountPaiseInt: -netWinPaiseInt,
        description: `${marketType} settlement revert`,
        req,
        requireWalletAvailable: false,
      });
    }

    return { revertedBets: bets.length };
  });
};

/**
 * Admin cancel/void entrypoint (refund exposure for OPEN bets)
 * - Cancels matching OPEN bets and returns their locked exposure.
 * - Marks settlementResult = VOID and status = SETTLED.
 * - Optional selectionId allows cancelling a specific section (sid) under same marketId.
 */
const cancelMarket = async (payload, req) => {
  return await withTransaction(async (session) => {
    const { marketType, marketId, eventId, selectionId, reason } = payload;

    const filter = {
      marketType,
      marketId,
      eventId,
      status: Bet.BET_STATUS.OPEN,
    };

    if (selectionId !== undefined && selectionId !== null && String(selectionId).trim() !== '') {
      filter.selectionId = String(selectionId);
    }

    const bets = await Bet.find(filter).session(session).exec();

    const affectedUserIds = new Set();
    for (const bet of bets) {
      affectedUserIds.add(String(bet.userId));

      bet.status = Bet.BET_STATUS.SETTLED;
      bet.settlementResult = Bet.BET_RESULT.VOID;
      bet.settledAt = new Date();
      await bet.save(sessionOpts(session));
    }

    for (const userKey of affectedUserIds) {
      await syncWalletToOpenBetsRisk({
        session,
        userId: userKey,
        netWinAmountPaiseInt: 0,
        description: `BET void/cancel${reason ? ` — ${String(reason).slice(0, 120)}` : ''}`,
        req,
        requireWalletAvailable: false,
      });
    }

    return { cancelledBets: bets.length };
  });
};

/**
 * Delete a single OPEN bet by Mongo _id (betUid).
 * - Removes the bet document (no audit row kept).
 * - Recomputes wallet risk for the bet user.
 * Settled bets cannot be deleted here; use settlement/cancel flows instead.
 */
const removeBetByUid = async (payload, req) => {
  return await withTransaction(async (session) => {
    const { betUid, reason } = payload;

    if (!mongoose.Types.ObjectId.isValid(String(betUid))) {
      throw betError('INVALID_BET_UID', 'betUid must be a valid MongoDB ID', 400);
    }

    const bet = await withSession(Bet.findById(betUid), session).exec();
    if (!bet) {
      throw betError('BET_NOT_FOUND', 'Bet not found', 404);
    }
    if (bet.status !== Bet.BET_STATUS.OPEN) {
      throw betError('BET_NOT_OPEN', 'Only OPEN bets can be deleted', 400);
    }

    const userIdStr = String(bet.userId);
    const snapshot = {
      deletedBetId: bet._id,
      userId: bet.userId,
      marketId: bet.marketId,
      eventId: bet.eventId,
      marketType: bet.marketType,
      selectionId: bet.selectionId,
    };

    const del = await withSession(Bet.deleteOne({ _id: bet._id }), session).exec();
    if (!del.deletedCount) {
      throw betError('BET_DELETE_FAILED', 'Bet could not be deleted', 500);
    }

    await syncWalletToOpenBetsRisk({
      session,
      userId: userIdStr,
      netWinAmountPaiseInt: 0,
      description: `BET deleted by UID${reason ? ` — ${String(reason).slice(0, 120)}` : ''}`,
      req,
      requireWalletAvailable: false,
    });

    return {
      deleted: true,
      ...snapshot,
    };
  });
};

/**
 * Admin: Get user profit/loss grouped by event (hierarchy enforced)
 * Similar to getUserProfitLossByEvent but admin can specify userId
 */
const getAdminUserProfitLoss = async (adminUserId, adminRole, query = {}) => {
  const { userId, sport, from, to, limit = 200 } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  if (!userId) {
    throw betError('VALIDATION_ERROR', 'userId is required');
  }

  // Check hierarchy
  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  const requestedId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
  if (!requestedId || !allowedUserIds.some((id) => id.toString() === requestedId.toString())) {
    throw betError('FORBIDDEN', 'You can only view profit/loss for users in your hierarchy', 403);
  }

  // Use the same logic as getUserProfitLossByEvent but with the requested userId
  return await getUserProfitLossByEvent(requestedId, { sport, from, to, limit: limitNum });
};

/**
 * Admin: Get user profit/loss by markets/bets within an event (hierarchy enforced)
 * Similar to getUserProfitLossByEventMarkets but admin can specify userId
 */
const getAdminUserEventProfitLoss = async (adminUserId, adminRole, query = {}) => {
  const { userId, sport, eventId, marketId, from, to, limit = 200, by } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  if (!userId) {
    throw betError('VALIDATION_ERROR', 'userId is required');
  }

  if (!eventId) {
    throw betError('VALIDATION_ERROR', 'eventId is required');
  }

  // Check hierarchy
  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  const requestedId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
  if (!requestedId || !allowedUserIds.some((id) => id.toString() === requestedId.toString())) {
    throw betError('FORBIDDEN', 'You can only view profit/loss for users in your hierarchy', 403);
  }

  // Use the same logic as getUserProfitLossByEventMarkets but with the requested userId
  return await getUserProfitLossByEventMarkets(requestedId, { sport, eventId, marketId, from, to, limit: limitNum, by });
};

/**
 * Admin: Get profit/loss by event for ALL users in admin's hierarchy
 * Filters: optional sport, from, to, limit
 * Returns array like:
 * [{ bets, lastSettledAt, sport, eventId, eventName, profitLoss }]
 */
const getAdminHierarchyProfitLossByEvent = async (adminUserId, adminRole, query = {}) => {
  const { sport, from, to, limit = 200 } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  // Determine which users this admin can see
  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  if (!allowedUserIds || !allowedUserIds.length) {
    return [];
  }

  const match = {
    userId: { $in: allowedUserIds },
    status: Bet.BET_STATUS.SETTLED,
  };

  if (sport) match.sport = sport;

  const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
  const toDate = to instanceof Date ? to : (to ? new Date(to) : null);

  if (fromDate || toDate) {
    match.settledAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) match.settledAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) match.settledAt.$lte = toDate;
    if (Object.keys(match.settledAt).length === 0) delete match.settledAt;
  }

  const matchOddsLike = matchOddsLikeForPl();

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $project: {
        sport: 1,
        eventId: 1,
        eventName: 1,
        marketType: 1,
        betType: 1,
        stake: 1,
        exposure: 1,
        odds: 1,
        rate: 1,
        winAmount: 1,
        settlementResult: 1,
        settledAt: 1,
      },
    },
    netWinAmountAddFields(matchOddsLike),
    {
      $group: {
        _id: {
          sport: '$sport',
          eventId: '$eventId',
          eventName: '$eventName',
        },
        profitLoss: { $sum: '$netWinAmount' },
        bets: { $sum: 1 },
        lastSettledAt: { $max: '$settledAt' },
      },
    },
    {
      $project: {
        _id: 0,
        sport: '$_id.sport',
        eventId: '$_id.eventId',
        eventName: '$_id.eventName',
        profitLoss: { $round: ['$profitLoss', 2] },
        bets: 1,
        lastSettledAt: 1,
      },
    },
    { $sort: { lastSettledAt: -1 } },
    { $limit: limitNum },
  ]);

  return rows;
};

/**
 * Admin: User-wise profit/loss (+ possible profit/loss) for a particular market within an event.
 * Filters: eventId (gameId), marketId, marketType; optional sport, from/to (createdAt range)
 * Hierarchy-scoped: only users under the admin (SUPER_ADMIN = all users).
 *
 * Returns:
 * {
 *   eventId, marketId, marketType,
 *   users: [{ _id, username, role, createdBy, profitLoss, possibleProfit, possibleLoss, bets, openBets, settledBets, totalStake, totalExposure }],
 *   tree:  [same users but nested via children[]]
 * }
 */
const getAdminHierarchyUserMarketProfitLoss = async (adminUserId, adminRole, query = {}) => {
  const { eventId, marketId, marketType, sport, from, to } = query;

  if (!eventId) throw betError('VALIDATION_ERROR', 'eventId is required');
  if (!marketId) throw betError('VALIDATION_ERROR', 'marketId is required');
  if (!marketType) throw betError('VALIDATION_ERROR', 'marketType is required');

  const effectiveMarketType = normalizeMarketTypeAlias(String(marketType));

  // Determine which users this admin can see
  let visibleUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    visibleUserIds = ids.map((u) => u._id);
  } else {
    const descendants = await getDescendantUserIds(adminUserId);
    const selfId = new mongoose.Types.ObjectId(adminUserId);
    visibleUserIds = [...descendants, selfId];
  }

  if (!visibleUserIds || !visibleUserIds.length) {
    return {
      eventId: String(eventId),
      marketId: String(marketId),
      marketType: effectiveMarketType,
      users: [],
      tree: [],
    };
  }

  // Load users (for username/role + hierarchy)
  const userDocs = await User.find({ _id: { $in: visibleUserIds } })
    .select('_id username role createdBy')
    .lean();

  const match = {
    userId: { $in: visibleUserIds },
    eventId: String(eventId),
    marketId: String(marketId),
    marketType: effectiveMarketType,
  };
  if (sport) match.sport = sport;

  const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
  const toDate = to instanceof Date ? to : (to ? new Date(to) : null);
  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) match.createdAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) match.createdAt.$lte = toDate;
    if (Object.keys(match.createdAt).length === 0) delete match.createdAt;
  }

  const matchOddsLike = matchOddsLikeForPl();

  const stats = await Bet.aggregate([
    { $match: match },
    {
      $project: {
        userId: 1,
        status: 1,
        marketType: 1,
        betType: 1,
        stake: 1,
        exposure: 1,
        odds: 1,
        rate: 1,
        winAmount: 1,
        settlementResult: 1,
      },
    },
    netWinAmountAddFields(matchOddsLike),
    {
      $addFields: {
        betPossibleProfit: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.CASINO] },
                then: { $ifNull: ['$winAmount', 0] },
              },
              {
                case: { $in: ['$marketType', matchOddsLike] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'back'] },
                    {
                      $multiply: [
                        { $subtract: [{ $ifNull: ['$odds', 1] }, 1] },
                        '$stake',
                      ],
                    },
                    '$stake',
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.BOOKMAKERS_FANCY] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'yes'] },
                    { $divide: [{ $multiply: ['$stake', { $ifNull: ['$rate', 0] }] }, 100] },
                    '$stake',
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.KADO_MARKET] },
                then: {
                  $let: {
                    vars: { multiplier: { $ifNull: ['$rate', 2] } },
                    in: { $multiply: ['$stake', { $subtract: ['$$multiplier', 1] }] },
                  },
                },
              },
              {
                case: {
                  $in: [
                    '$marketType',
                    [Bet.MARKET_TYPES.LINE_MARKET, Bet.MARKET_TYPES.METER_MARKET, Bet.MARKET_TYPES.FANCY],
                  ],
                },
                then: '$stake',
              },
            ],
            default: 0,
          },
        },
        betPossibleLoss: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.CASINO] },
                then: '$stake',
              },
              {
                case: { $in: ['$marketType', matchOddsLike] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'back'] },
                    '$stake',
                    {
                      $multiply: [
                        { $subtract: [{ $ifNull: ['$odds', 1] }, 1] },
                        '$stake',
                      ],
                    },
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.BOOKMAKERS_FANCY] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'yes'] },
                    '$stake',
                    { $divide: [{ $multiply: ['$stake', { $ifNull: ['$rate', 0] }] }, 100] },
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.KADO_MARKET] },
                then: '$stake',
              },
              {
                case: {
                  $in: [
                    '$marketType',
                    [Bet.MARKET_TYPES.LINE_MARKET, Bet.MARKET_TYPES.METER_MARKET, Bet.MARKET_TYPES.FANCY],
                  ],
                },
                then: '$stake',
              },
            ],
            default: 0,
          },
        },
      },
    },
    {
      $group: {
        _id: '$userId',
        profitLoss: { $sum: '$netWinAmount' },
        possibleProfit: { $sum: '$betPossibleProfit' },
        possibleLoss: { $sum: '$betPossibleLoss' },
        totalStake: { $sum: '$stake' },
        totalExposure: { $sum: '$exposure' },
        bets: { $sum: 1 },
        openBets: { $sum: { $cond: [{ $eq: ['$status', Bet.BET_STATUS.OPEN] }, 1, 0] } },
        settledBets: { $sum: { $cond: [{ $eq: ['$status', Bet.BET_STATUS.SETTLED] }, 1, 0] } },
      },
    },
    {
      $project: {
        _id: 0,
        userId: '$_id',
        profitLoss: { $round: ['$profitLoss', 2] },
        possibleProfit: { $round: ['$possibleProfit', 2] },
        possibleLoss: { $round: ['$possibleLoss', 2] },
        totalStake: { $round: ['$totalStake', 2] },
        totalExposure: { $round: ['$totalExposure', 2] },
        bets: 1,
        openBets: 1,
        settledBets: 1,
      },
    },
  ]);

  const statsByUserId = new Map(stats.map((s) => [String(s.userId), s]));

  // Only include users who actually have at least one bet in this market
  const mergedUsers = userDocs
    .map((u) => {
      const s = statsByUserId.get(String(u._id));
      if (!s) return null;
      return {
        _id: u._id,
        username: u.username,
        role: u.role,
        createdBy: u.createdBy || null,
        profitLoss: Number(s.profitLoss || 0),
        possibleProfit: Number(s.possibleProfit || 0),
        possibleLoss: Number(s.possibleLoss || 0),
        totalStake: Number(s.totalStake || 0),
        totalExposure: Number(s.totalExposure || 0),
        bets: Number(s.bets || 0),
        openBets: Number(s.openBets || 0),
        settledBets: Number(s.settledBets || 0),
      };
    })
    .filter(Boolean);

  const usersSorted = mergedUsers.slice().sort(sortHierarchyNodes);
  const tree = buildUserHierarchyTree({ users: mergedUsers });

  return {
    eventId: String(eventId),
    marketId: String(marketId),
    marketType: effectiveMarketType,
    users: usersSorted,
    tree,
  };
};

/**
 * Admin: hierarchy-wide bet list for a particular market (per bet rows, includes username).
 * Filters: required eventId; optional sport, marketId, marketType, userId, from, to, limit.
 * Always returns only unsettled bets (status = open).
 * Hierarchy-scoped: only users under the admin (SUPER_ADMIN = all users).
 *
 * Returns array of rows like:
 * {
 *   userId, username, role,
 *   sport, eventId, eventName, marketId, marketName, marketType,
 *   selectionId, selectionName, betType, odds, rate,
 *   priceType, priceOname, priceSize, priceTno,
 *   stake, exposure, status, createdAt
 * }
 */
const getAdminHierarchyMarketBets = async (adminUserId, adminRole, query = {}) => {
  const { sport, eventId, marketId, marketType, userId, from, to, limit = 200 } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  if (!eventId) {
    throw betError('VALIDATION_ERROR', 'eventId is required');
  }

  // Determine which users this admin can see
  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  if (!allowedUserIds || !allowedUserIds.length) {
    return [];
  }

  let targetUserIds = allowedUserIds;
  if (userId) {
    const requestedId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
    if (!requestedId || !allowedUserIds.some((id) => id.toString() === requestedId.toString())) {
      throw betError('FORBIDDEN', 'You can only view bets for users in your hierarchy', 403);
    }
    targetUserIds = [requestedId];
  }

  const match = {
    userId: { $in: targetUserIds },
    eventId: String(eventId),
    status: Bet.BET_STATUS.OPEN,
  };

  if (sport) match.sport = sport;
  if (marketId) match.marketId = String(marketId);
  if (marketType) match.marketType = normalizeMarketTypeAlias(String(marketType));

  const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
  const toDate = to instanceof Date ? to : (to ? new Date(to) : null);
  if (fromDate || toDate) {
    match.createdAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) match.createdAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) match.createdAt.$lte = toDate;
    if (Object.keys(match.createdAt).length === 0) delete match.createdAt;
  }

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        userId: '$userId',
        username: '$user.username',
        role: '$user.role',
        sport: 1,
        eventId: 1,
        eventName: 1,
        marketId: 1,
        marketName: 1,
        marketType: 1,
        selectionId: 1,
        selectionName: 1,
        betType: 1,
        odds: 1,
        rate: 1,
        priceType: 1,
        priceOname: 1,
        priceSize: 1,
        priceTno: 1,
        stake: 1,
        exposure: 1,
        status: 1,
        createdAt: 1,
      },
    },
    { $sort: { createdAt: -1 } },
    { $limit: limitNum },
  ]);

  return rows;
};

/**
 * Admin: Settled bets list for ALL users in admin's hierarchy (per bet rows)
 * Filters: optional sport, from, to, eventId, marketId, userId, limit
 * Returns rows like:
 * [{ sport, username, eventId, eventName, marketId, marketName, selectionName, betType, odd, stake,
 *    placedDate, bets:1, lastSettledAt, profitLoss, result, display, settlementtime }]
 */
const getAdminHierarchySettledBets = async (adminUserId, adminRole, query = {}) => {
  const { sport, from, to, eventId, marketId, userId, limit = 200 } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  // Determine which users this admin can see
  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  if (!allowedUserIds || !allowedUserIds.length) {
    return [];
  }

  let targetUserIds = allowedUserIds;
  if (userId) {
    const requestedId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
    if (!requestedId || !allowedUserIds.some((id) => id.toString() === requestedId.toString())) {
      throw betError('FORBIDDEN', 'You can only view bets for users in your hierarchy', 403);
    }
    targetUserIds = [requestedId];
  }

  const match = {
    userId: { $in: targetUserIds },
    status: Bet.BET_STATUS.SETTLED,
  };

  if (sport) match.sport = sport;
  if (eventId) match.eventId = String(eventId);
  if (marketId) match.marketId = String(marketId);

  const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
  const toDate = to instanceof Date ? to : (to ? new Date(to) : null);
  if (fromDate || toDate) {
    match.settledAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) match.settledAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) match.settledAt.$lte = toDate;
    if (Object.keys(match.settledAt).length === 0) delete match.settledAt;
  }

  const matchOddsLike = matchOddsLikeForPl();

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        sport: 1,
        eventId: 1,
        eventName: 1,
        marketId: 1,
        marketName: 1,
        marketType: 1,
        selectionName: 1,
        betType: 1,
        stake: 1,
        exposure: 1,
        odds: 1,
        rate: 1,
        winAmount: 1,
        settlementResult: 1,
        settledAt: 1,
        createdAt: 1,
        username: '$user.username',
      },
    },
    netWinAmountAddFields(matchOddsLike),
    {
      $project: {
        _id: 0,
        sport: 1,
        username: 1,
        eventId: 1,
        eventName: 1,
        marketId: 1,
        marketName: 1,
        selectionName: 1,
        betType: 1,
        odd: '$odds',
        stake: 1,
        placedDate: '$createdAt',
        bets: { $literal: 1 },
        lastSettledAt: '$settledAt',
        profitLoss: { $round: ['$netWinAmount', 2] },
        result: '$settlementResult',
      },
    },
    { $sort: { lastSettledAt: -1 } },
    { $limit: limitNum },
  ]);

  return rows.map((r) => {
    const profitLoss = Number(r.profitLoss != null ? r.profitLoss : 0);
    const result =
      r.result || (profitLoss > 0 ? Bet.BET_RESULT.WON : profitLoss < 0 ? Bet.BET_RESULT.LOST : Bet.BET_RESULT.VOID);
    const absAmount = Math.abs(profitLoss);
    return {
      ...r,
      betType: (r.betType || '').toLowerCase(),
      result,
      display: `${absAmount} ${result}`,
      settlementtime: r.lastSettledAt,
    };
  });
};

/**
 * Admin: Profit/loss market analysis by selectionId within an event.
 * Groups bets by selectionId/selectionName and computes:
 * - totalBets, totalStake, totalExposure
 * - profitLoss (settled bets only, computed via netWinAmount)
 * Hierarchy-scoped: only users under the admin.
 *
 * This endpoint returns only unsettled/open bets.
 */
const getMarketAnalysisBySelection = async (adminUserId, adminRole, query = {}) => {
  const { eventId, sport, marketType, limit = 200 } = query;
  const limitNum = Math.min(Number(limit) || 200, 500);

  if (!eventId) {
    throw betError('VALIDATION_ERROR', 'eventId is required');
  }

  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  if (!allowedUserIds || !allowedUserIds.length) {
    return [];
  }

  const match = {
    userId: { $in: allowedUserIds },
    eventId: String(eventId),
  };

  if (sport) match.sport = sport;
  if (marketType) match.marketType = marketType;
  // This endpoint is for "unsettled bets only".
  match.status = Bet.BET_STATUS.OPEN;

  const matchOddsLike = matchOddsLikeForPl();

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $project: {
        sport: 1,
        eventId: 1,
        eventName: 1,
        marketId: 1,
        marketName: 1,
        marketType: 1,
        selectionId: 1,
        selectionName: 1,
        betType: 1,
        stake: 1,
        exposure: 1,
        odds: 1,
        rate: 1,
        winAmount: 1,
        status: 1,
        settlementResult: 1,
      },
    },
    netWinAmountAddFields(matchOddsLike),
    {
      $addFields: {
        betPl: {
          $cond: [
            { $eq: ['$status', Bet.BET_STATUS.SETTLED] },
            '$netWinAmount',
            { $multiply: ['$exposure', -1] },
          ],
        },
        betPossibleProfit: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.CASINO] },
                then: { $ifNull: ['$winAmount', 0] },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.MATCH_ODDS] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'back'] },
                    {
                      $multiply: [
                        { $subtract: [{ $ifNull: ['$odds', 1] }, 1] },
                        '$stake',
                      ],
                    },
                    '$stake',
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.TOS_MARKET] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'back'] },
                    {
                      $multiply: [
                        { $subtract: [{ $ifNull: ['$odds', 1] }, 1] },
                        '$stake',
                      ],
                    },
                    '$stake',
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.BOOKMAKERS_FANCY] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'yes'] },
                    {
                      $divide: [
                        { $multiply: ['$stake', { $ifNull: ['$rate', 0] }] },
                        100,
                      ],
                    },
                    '$stake',
                  ],
                },
              },
              {
                case: {
                  $in: [
                    '$marketType',
                    [
                      Bet.MARKET_TYPES.LINE_MARKET,
                      Bet.MARKET_TYPES.METER_MARKET,
                      Bet.MARKET_TYPES.FANCY,
                    ],
                  ],
                },
                then: '$stake',
              },
            ],
            default: 0,
          },
        },
        betPossibleLoss: {
          $switch: {
            branches: [
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.CASINO] },
                then: '$stake',
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.MATCH_ODDS] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'back'] },
                    '$stake',
                    {
                      $multiply: [
                        { $subtract: [{ $ifNull: ['$odds', 1] }, 1] },
                        '$stake',
                      ],
                    },
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.TOS_MARKET] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'back'] },
                    '$stake',
                    {
                      $multiply: [
                        { $subtract: [{ $ifNull: ['$odds', 1] }, 1] },
                        '$stake',
                      ],
                    },
                  ],
                },
              },
              {
                case: { $eq: ['$marketType', Bet.MARKET_TYPES.BOOKMAKERS_FANCY] },
                then: {
                  $cond: [
                    { $eq: ['$betType', 'yes'] },
                    '$stake',
                    {
                      $divide: [
                        { $multiply: ['$stake', { $ifNull: ['$rate', 0] }] },
                        100,
                      ],
                    },
                  ],
                },
              },
              {
                case: {
                  $in: [
                    '$marketType',
                    [
                      Bet.MARKET_TYPES.LINE_MARKET,
                      Bet.MARKET_TYPES.METER_MARKET,
                      Bet.MARKET_TYPES.FANCY,
                    ],
                  ],
                },
                then: '$stake',
              },
            ],
            default: 0,
          },
        },
      },
    },
    {
      $group: {
        _id: {
          selectionId: '$selectionId',
          selectionName: '$selectionName',
          marketId: '$marketId',
          marketName: '$marketName',
          marketType: '$marketType',
          sport: '$sport',
          eventId: '$eventId',
          eventName: '$eventName',
        },
        totalBets: { $sum: 1 },
        totalStake: { $sum: '$stake' },
        totalExposure: { $sum: '$exposure' },
        totalPossibleProfit: { $sum: '$betPossibleProfit' },
        totalPossibleLoss: { $sum: '$betPossibleLoss' },
        profitLoss: { $sum: '$betPl' },
        settledPl: {
          $sum: {
            $cond: [{ $eq: ['$status', Bet.BET_STATUS.SETTLED] }, '$netWinAmount', 0],
          },
        },
        unsettledExposure: {
          $sum: {
            $cond: [{ $eq: ['$status', Bet.BET_STATUS.OPEN] }, '$exposure', 0],
          },
        },
        openBets: {
          $sum: { $cond: [{ $eq: ['$status', Bet.BET_STATUS.OPEN] }, 1, 0] },
        },
        settledBets: {
          $sum: { $cond: [{ $eq: ['$status', Bet.BET_STATUS.SETTLED] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        sport: '$_id.sport',
        eventId: '$_id.eventId',
        eventName: '$_id.eventName',
        marketId: '$_id.marketId',
        marketName: '$_id.marketName',
        marketType: '$_id.marketType',
        selectionId: '$_id.selectionId',
        selectionName: '$_id.selectionName',
        totalBets: 1,
        openBets: 1,
        settledBets: 1,
        totalStake: { $round: ['$totalStake', 2] },
        totalExposure: { $round: ['$totalExposure', 2] },
        totalPossibleProfit: { $round: ['$totalPossibleProfit', 2] },
        totalPossibleLoss: { $round: ['$totalPossibleLoss', 2] },
        profitLoss: { $round: ['$profitLoss', 2] },
        settledPl: { $round: ['$settledPl', 2] },
        unsettledExposure: { $round: ['$unsettledExposure', 2] },
      },
    },
    { $sort: { totalBets: -1 } },
    { $limit: limitNum },
  ]);

  return rows;
};

/**
 * Get total profit/loss for a single user over a date range.
 * Uses settled bets only (like getUserProfitLossByEvent), summed across all events/markets.
 *
 * @param {string|ObjectId} userId
 * @param {{ from?: string|Date, to?: string|Date, sport?: string }} query
 * @returns {{ userId: ObjectId, profitLoss: number }}
 */
const getUserTotalProfitLoss = async (userId, query = {}) => {
  const { sport, from, to } = query;

  const match = {
    userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
    status: Bet.BET_STATUS.SETTLED,
  };

  if (sport) match.sport = sport;

  const fromDate = from instanceof Date ? from : (from ? new Date(from) : null);
  const toDate = to instanceof Date ? to : (to ? new Date(to) : null);

  if (fromDate || toDate) {
    match.settledAt = {};
    if (fromDate && !Number.isNaN(fromDate.getTime())) match.settledAt.$gte = fromDate;
    if (toDate && !Number.isNaN(toDate.getTime())) match.settledAt.$lte = toDate;
    if (Object.keys(match.settledAt).length === 0) delete match.settledAt;
  }

  const matchOddsLike = matchOddsLikeForPl();

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $project: {
        status: 1,
        marketType: 1,
        betType: 1,
        stake: 1,
        exposure: 1,
        odds: 1,
        rate: 1,
        winAmount: 1,
        settlementResult: 1,
      },
    },
    netWinAmountAddFields(matchOddsLike),
    {
      $group: {
        _id: '$userId',
        profitLoss: { $sum: '$netWinAmount' },
      },
    },
  ]);

  if (!rows.length) {
    return {
      userId: mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : userId,
      profitLoss: 0,
    };
  }

  return {
    userId: rows[0]._id,
    profitLoss: Number(rows[0].profitLoss || 0),
  };
};

/**
 * Internal: sport-wise unsettled bet list for settlement.
 * Returns one row per (sport, eventId, eventName, marketId, marketName, selectionId, selectionName)
 * with aggregate counts/exposure.
 */
const getUnsettledBetsForSettlement = async (query = {}) => {
  const { sport } = query;

  const match = {
    status: Bet.BET_STATUS.OPEN,
  };

  if (sport) {
    match.sport = sport;
  }

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          sport: '$sport',
          eventId: '$eventId',
          eventName: '$eventName',
          marketId: '$marketId',
          marketName: '$marketName',
          selectionId: '$selectionId',
          selectionName: '$selectionName',
        },
        openBets: { $sum: 1 },
        totalStake: { $sum: '$stake' },
        totalExposure: { $sum: '$exposure' },
      },
    },
    {
      $project: {
        _id: 0,
        sport: '$_id.sport',
        eventId: '$_id.eventId',
        eventName: '$_id.eventName',
        marketId: '$_id.marketId',
        marketName: '$_id.marketName',
        selectionId: '$_id.selectionId',
        selectionName: '$_id.selectionName',
        openBets: 1,
        totalStake: 1,
        totalExposure: 1,
      },
    },
    {
      $sort: {
        sport: 1,
        eventName: 1,
        marketName: 1,
        selectionName: 1,
      },
    },
  ]);

  return rows;
};

/**
 * Admin: User exposure game list — open bets grouped by sport > event > market.
 * Returns: [{ sport, eventId, eventName, marketId, marketName, betCount, totalStake, totalExposure }]
 */
const getAdminUserExposureGameList = async (adminUserId, adminRole, query = {}) => {
  const { userId, sport } = query;

  if (!userId) {
    throw betError('VALIDATION_ERROR', 'userId is required');
  }

  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  const requestedId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
  if (!requestedId || !allowedUserIds.some((id) => id.toString() === requestedId.toString())) {
    throw betError('FORBIDDEN', 'You can only view exposure for users in your hierarchy', 403);
  }

  const match = {
    userId: requestedId,
    status: Bet.BET_STATUS.OPEN,
  };
  if (sport) match.sport = sport;

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          sport: '$sport',
          eventId: '$eventId',
          eventName: '$eventName',
          marketId: '$marketId',
          marketName: '$marketName',
        },
        betCount: { $sum: 1 },
        totalStake: { $sum: '$stake' },
        totalExposure: { $sum: '$exposure' },
      },
    },
    {
      $project: {
        _id: 0,
        sport: '$_id.sport',
        eventId: '$_id.eventId',
        eventName: '$_id.eventName',
        marketId: '$_id.marketId',
        marketName: '$_id.marketName',
        betCount: 1,
        totalStake: { $round: ['$totalStake', 2] },
        totalExposure: { $round: ['$totalExposure', 2] },
      },
    },
    { $sort: { sport: 1, eventName: 1, marketName: 1 } },
  ]);

  return rows;
};

/**
 * Admin: user market exposure rows for modal/table view.
 * Required: userId, marketId
 * Optional: eventId, sport, limit, status (defaults to OPEN)
 */
const getAdminUserMarketExposureBets = async (adminUserId, adminRole, query = {}) => {
  const { userId, marketId, eventId, sport, status, limit = 500 } = query;
  const limitNum = Math.min(Number(limit) || 500, 1000);

  if (!userId) {
    throw betError('VALIDATION_ERROR', 'userId is required');
  }
  if (!marketId) {
    throw betError('VALIDATION_ERROR', 'marketId is required');
  }

  let allowedUserIds;
  if (adminRole === ROLES.SUPER_ADMIN) {
    const ids = await User.find({}).select('_id').lean();
    allowedUserIds = ids.map((u) => u._id);
  } else {
    allowedUserIds = await getDescendantUserIds(adminUserId);
  }

  const requestedId = mongoose.Types.ObjectId.isValid(userId) ? new mongoose.Types.ObjectId(userId) : null;
  if (!requestedId || !allowedUserIds.some((id) => id.toString() === requestedId.toString())) {
    throw betError('FORBIDDEN', 'You can only view exposure for users in your hierarchy', 403);
  }

  const match = {
    userId: requestedId,
    marketId: String(marketId),
    status: status || Bet.BET_STATUS.OPEN,
  };
  if (eventId) match.eventId = String(eventId);
  if (sport) match.sport = sport;

  const rows = await Bet.aggregate([
    { $match: match },
    {
      $project: {
        _id: 0,
        betId: '$_id',
        sport: 1,
        eventId: 1,
        eventName: 1,
        marketId: 1,
        marketName: 1,
        runnerName: '$selectionName',
        selectionId: 1,
        betType: { $toUpper: '$betType' },
        userPrice: {
          $ifNull: ['$odds', { $ifNull: ['$rate', 0] }],
        },
        rate: { $ifNull: ['$rate', 0] },
        amount: '$stake',
        placeDate: '$createdAt',
        matchDate: '$updatedAt',
        createdAt: 1,
        updatedAt: 1,
        stake: 1,
        exposure: 1,
        status: 1,
      },
    },
    { $sort: { placeDate: -1 } },
    { $limit: limitNum },
  ]);

  return rows;
};

module.exports = {
  placeBet,
  getDescendantUserIds,
  getAdminBetList,
  getTodayInplayPlacedBets,
  getMarketAnalysisBySelection,
  getUserBets,
  getUserProfitLossByEvent,
  getUserProfitLossByEventMarkets,
  getAdminUserProfitLoss,
  getAdminUserEventProfitLoss,
  getAdminHierarchyProfitLossByEvent,
  getAdminHierarchySettledBets,
  getAdminHierarchyMarketBets,
  getAdminHierarchyUserMarketProfitLoss,
  getAdminUserExposureGameList,
  getAdminUserMarketExposureBets,
  getTodayBets,
  getTodayOpenBets,
  settleMarket,
  cancelMarket,
  removeBetByUid,
  revertMarketSettlement,
  getUserTotalProfitLoss,
  getUnsettledBetsForSettlement,
};

