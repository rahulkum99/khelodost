const mongoose = require('mongoose');

// Market types supported by the exchange
const MARKET_TYPES = {
  MATCH_ODDS: 'match_odds',
  BOOKMAKERS_FANCY: 'bookmakers_fancy',
  LINE_MARKET: 'line_market',
  METER_MARKET: 'meter_market',
  KADO_MARKET: 'kado_market',
};

// Bet status
const BET_STATUS = {
  OPEN: 'open',
  PARTIALLY_MATCHED: 'partially_matched',
  MATCHED: 'matched',
  CANCELLED: 'cancelled',
  SETTLED: 'settled',
};

// Settlement result
const BET_RESULT = {
  WON: 'won',
  LOST: 'lost',
  VOID: 'void',
};

const matchedWithSchema = new mongoose.Schema(
  {
    betId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bet',
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    odds: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

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
    marketId: {
      type: String,
      required: true,
      index: true,
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

    matchedAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    unmatchedAmount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    matchedWith: {
      type: [matchedWithSchema],
      default: [],
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

const Bet = mongoose.model('Bet', betSchema);

Bet.MARKET_TYPES = MARKET_TYPES;
Bet.BET_STATUS = BET_STATUS;
Bet.BET_RESULT = BET_RESULT;

module.exports = Bet;

