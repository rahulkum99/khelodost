const mongoose = require('mongoose');

// Bet types
const BET_TYPES = {
  BACK: 'back',
  LAY: 'lay'
};

// Bet status
const BET_STATUS = {
  PENDING: 'pending',
  MATCHED: 'matched',
  PARTIALLY_MATCHED: 'partially_matched',
  UNMATCHED: 'unmatched',
  CANCELLED: 'cancelled',
  SETTLED: 'settled'
};

// Settlement result
const SETTLEMENT_RESULT = {
  WIN: 'win',
  LOSE: 'lose'
};

const betSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  marketId: {
    type: String,
    required: true,
    index: true
  },
  sectionId: {
    type: String,
    required: true,
    index: true
  },
  eventId: {
    type: String,
    required: true,
    index: true
  },
  marketName: {
    type: String,
    required: true
  },
  sectionName: {
    type: String,
    required: true
  },
  marketType: {
    type: String,
    enum: ['match_odds', 'bookmakers_fancy', 'line_market', 'meter_market', 'kado_market'],
    default: 'match_odds',
    index: true
  },
  type: {
    type: String,
    enum: Object.values(BET_TYPES),
    required: true,
    index: true
  },
  odds: {
    type: Number,
    required: true,
    min: [1.01, 'Odds must be at least 1.01'],
    max: [1000, 'Odds cannot exceed 1000']
  },
  stake: {
    type: Number,
    required: true,
    min: [0.01, 'Stake must be at least 0.01']
  },
  status: {
    type: String,
    enum: Object.values(BET_STATUS),
    default: BET_STATUS.PENDING,
    index: true
  },
  matchedAmount: {
    type: Number,
    default: 0,
    min: [0, 'Matched amount cannot be negative']
  },
  unmatchedAmount: {
    type: Number,
    required: true,
    min: [0, 'Unmatched amount cannot be negative']
  },
  profit: {
    type: Number,
    default: 0
  },
  liability: {
    type: Number,
    default: 0,
    min: [0, 'Liability cannot be negative']
  },
  matchedWith: [{
    betId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bet',
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: [0.01, 'Match amount must be at least 0.01']
    },
    odds: {
      type: Number,
      required: true
    },
    matchedAt: {
      type: Date,
      default: Date.now
    }
  }],
  settlementResult: {
    type: String,
    enum: Object.values(SETTLEMENT_RESULT),
    default: null
  },
  settledAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Compound indexes for efficient matching queries
betSchema.index({ marketId: 1, sectionId: 1, type: 1, status: 1, odds: 1, marketType: 1 });
betSchema.index({ eventId: 1, status: 1, marketType: 1 });
betSchema.index({ userId: 1, status: 1, createdAt: -1 });
betSchema.index({ status: 1, createdAt: 1 }); // For matching priority
betSchema.index({ marketType: 1, status: 1 }); // For market type queries

// Virtual for total return if back bet wins
betSchema.virtual('totalReturn').get(function() {
  if (this.type === BET_TYPES.BACK) {
    return this.matchedAmount * this.odds;
  }
  return this.matchedAmount; // For lay, profit is just the stake
});

// Method to calculate required amount for lay bet
betSchema.methods.calculateRequiredAmount = function() {
  if (this.type === BET_TYPES.BACK) {
    return this.stake;
  } else {
    // Lay bet: stake + liability
    this.liability = this.stake * (this.odds - 1);
    return this.stake + this.liability;
  }
};

// Method to check if bet can be matched with another bet
betSchema.methods.canMatchWith = function(otherBet) {
  // Cannot match with same user
  if (this.userId.toString() === otherBet.userId.toString()) {
    return false;
  }

  // Cannot match with same type
  if (this.type === otherBet.type) {
    return false;
  }

  // Must be same market and section
  if (this.marketId !== otherBet.marketId || this.sectionId !== otherBet.sectionId) {
    return false;
  }

  // Both must be pending or partially matched
  if (![BET_STATUS.PENDING, BET_STATUS.PARTIALLY_MATCHED].includes(this.status)) {
    return false;
  }
  if (![BET_STATUS.PENDING, BET_STATUS.PARTIALLY_MATCHED].includes(otherBet.status)) {
    return false;
  }

  // Matching logic: back bet matches with lay bet if lay odds <= back odds
  if (this.type === BET_TYPES.BACK && otherBet.type === BET_TYPES.LAY) {
    return otherBet.odds <= this.odds;
  }

  // Matching logic: lay bet matches with back bet if back odds >= lay odds
  if (this.type === BET_TYPES.LAY && otherBet.type === BET_TYPES.BACK) {
    return otherBet.odds >= this.odds;
  }

  return false;
};

// Method to update status based on matched/unmatched amounts
betSchema.methods.updateStatus = function() {
  if (this.unmatchedAmount === 0 && this.matchedAmount > 0) {
    this.status = BET_STATUS.MATCHED;
  } else if (this.matchedAmount > 0 && this.unmatchedAmount > 0) {
    this.status = BET_STATUS.PARTIALLY_MATCHED;
  } else if (this.matchedAmount === 0 && this.unmatchedAmount > 0) {
    this.status = BET_STATUS.PENDING;
  }
};

const Bet = mongoose.model('Bet', betSchema);

// Export constants
Bet.BET_TYPES = BET_TYPES;
Bet.BET_STATUS = BET_STATUS;
Bet.SETTLEMENT_RESULT = SETTLEMENT_RESULT;

module.exports = Bet;
