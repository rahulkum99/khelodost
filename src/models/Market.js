const mongoose = require('mongoose');

const MARKET_TYPES = {
  MATCH_ODDS: 'match_odds',
  BOOKMAKERS_FANCY: 'bookmakers_fancy',
  LINE_MARKET: 'line_market',
  METER_MARKET: 'meter_market',
  KADO_MARKET: 'kado_market'
};

const marketSchema = new mongoose.Schema({
  marketId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  marketName: {
    type: String,
    required: true
  },
  marketType: {
    type: String,
    enum: Object.values(MARKET_TYPES),
    required: true,
    index: true
  },
  eventId: {
    type: String,
    required: true,
    index: true
  },
  sportType: {
    type: String,
    enum: ['cricket', 'soccer', 'tennis'],
    required: true,
    index: true
  },
  description: {
    type: String,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  settlementRules: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for faster queries
marketSchema.index({ eventId: 1, marketType: 1 });
marketSchema.index({ sportType: 1, marketType: 1, isActive: 1 });
marketSchema.index({ marketType: 1, isActive: 1 });

const Market = mongoose.model('Market', marketSchema);

// Export constants
Market.MARKET_TYPES = MARKET_TYPES;

module.exports = Market;
