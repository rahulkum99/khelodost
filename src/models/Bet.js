const mongoose = require('mongoose');

// Market types supported by the exchange
// gtype -> mname examples: match=MATCH_ODDS,TIED_MATCH | match1=Bookmaker | fancy1=fancy1(toss) | fancy=Normal,Over By Over | oddeven=oddeven
const MARKET_TYPES = {
  MATCH_ODDS: 'match_odds',
  TIED_MATCH: 'tied_match',
  BOOKMAKERS_FANCY: 'bookmakers_fancy',
  TOS_MARKET: 'tos_market',
  FANCY: 'fancy',                   // Normal fancy (overs, player runs, etc.)
  OVER_BY_OVER: 'over_by_over',     // Over-by-over fancy
  ODDEVEN: 'oddeven',               // Odd/even run markets
  LINE_MARKET: 'line_market',
  METER_MARKET: 'meter_market',
  KADO_MARKET: 'kado_market',
};

// Bet status
const BET_STATUS = {
  OPEN: 'open',
  SETTLED: 'settled',
};

// Settlement result
const BET_RESULT = {
  WON: 'won',
  LOST: 'lost',
  VOID: 'void',
};

const betSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    sport: {
      type: String,
      enum: ['cricket', 'soccer', 'tennis'],
      required: true,
      index: true,
    },
    eventId: {
      type: String,
      required: true,
      index: true,
    },
    eventName: {
      type: String,
      required: true,
    },
    eventJsonStamp: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    marketId: {
      type: String,
      required: true,
      index: true,
    },
    // Snapshot of provider market name (mname) at bet time
    marketName: {
      type: String,
      required: true,
    },
    marketType: {
      type: String,
      enum: Object.values(MARKET_TYPES),
      required: true,
      index: true,
    },
    selectionId: {
      type: String,
      required: true,
    },
    selectionName: {
      type: String,
      required: true,
    },

    // betType changes semantics based on marketType
    betType: {
      type: String,
      enum: ['back', 'lay', 'yes', 'no', 'over', 'under'],
      required: true,
    },

    // Exchange odds (MATCH_ODDS only)
    odds: {
      type: Number,
      min: 0,
    },

    // Fancy/session rate (BOOKMAKERS_FANCY)
    rate: {
      type: Number,
      min: 0,
    },

    // Provider quote snapshot at bet time (which ladder/row user matched)
    priceType: {
      type: String,
      enum: ['back', 'lay'],
      default: null,
    },
    priceOname: {
      type: String,
      default: null,
    },
    priceSize: {
      type: Number,
      default: null,
    },
    priceTno: {
      type: Number,
      default: null,
    },

    // Line / meter numeric value
    lineValue: {
      type: Number,
      min: 0,
    },

    stake: {
      type: Number,
      required: true,
      min: 0,
    },

    exposure: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: Object.values(BET_STATUS),
      default: BET_STATUS.OPEN,
      index: true,
    },
    settlementResult: {
      type: String,
      enum: Object.values(BET_RESULT),
      default: null,
    },

    settledAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

betSchema.index({ eventId: 1, marketId: 1, marketType: 1 });
betSchema.index({ userId: 1, createdAt: -1 });

/**
 * User-wise bet list (filters + pagination)
 *
 * @param {string|mongoose.Types.ObjectId} userId
 * @param {object} query
 * @returns {Promise<{bets: any[], total: number, page: number, limit: number, totalPages: number}>}
 */
betSchema.statics.getUserWiseBetList = async function getUserWiseBetList(userId, query = {}) {
  const BetModel = this;

  const {
    sport,
    status,
    marketType,
    eventId,
    marketId,
    settlementResult,
    from, // ISO date string
    to,   // ISO date string
    page = 1,
    limit = 50,
    includeEventJsonStamp = false,
    populateUser = false,
  } = query || {};

  const userObjectId =
    userId && mongoose.Types.ObjectId.isValid(userId)
      ? new mongoose.Types.ObjectId(userId)
      : userId instanceof mongoose.Types.ObjectId
        ? userId
        : null;

  if (!userObjectId) {
    throw new Error('Invalid userId');
  }

  const limitNum = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const pageNum = Math.max(Number(page) || 1, 1);
  const skip = (pageNum - 1) * limitNum;

  const filter = { userId: userObjectId };
  if (sport) filter.sport = sport;
  if (status) filter.status = status;
  if (marketType) filter.marketType = marketType;
  if (eventId) filter.eventId = String(eventId);
  if (marketId) filter.marketId = String(marketId);
  if (settlementResult) filter.settlementResult = settlementResult;

  if (from || to) {
    const createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) createdAt.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) createdAt.$lte = toDate;
    }
    if (Object.keys(createdAt).length) {
      filter.createdAt = createdAt;
    }
  }

  const projection = includeEventJsonStamp ? undefined : '-eventJsonStamp';

  let findQuery = BetModel.find(filter)
    .select(projection)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limitNum);

  if (populateUser) {
    findQuery = findQuery.populate('userId', 'username name role');
  }

  const [bets, total] = await Promise.all([
    findQuery.lean(),
    BetModel.countDocuments(filter),
  ]);

  return {
    bets,
    total,
    page: pageNum,
    limit: limitNum,
    totalPages: Math.ceil(total / limitNum) || 0,
  };
};

const Bet = mongoose.model('Bet', betSchema);

Bet.MARKET_TYPES = MARKET_TYPES;
Bet.BET_STATUS = BET_STATUS;
Bet.BET_RESULT = BET_RESULT;

module.exports = Bet;

