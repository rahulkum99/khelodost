const Market = require('../../models/Market');
const Bet = require('../../models/Bet');
const mongoose = require('mongoose');

/**
 * Create or update a market
 */
const createOrUpdateMarket = async (marketData) => {
  const {
    marketId,
    marketName,
    marketType,
    eventId,
    sportType,
    description,
    settlementRules,
    metadata
  } = marketData;

  // Validate market type
  if (!Object.values(Market.MARKET_TYPES).includes(marketType)) {
    throw new Error('Invalid market type');
  }

  const market = await Market.findOneAndUpdate(
    { marketId },
    {
      marketName,
      marketType,
      eventId,
      sportType,
      description,
      settlementRules,
      metadata,
      isActive: true
    },
    { upsert: true, new: true, runValidators: true }
  );

  return market;
};

/**
 * Get markets by event
 */
const getMarketsByEvent = async (eventId, marketType = null) => {
  const filter = { eventId, isActive: true };
  if (marketType) {
    if (!Object.values(Market.MARKET_TYPES).includes(marketType)) {
      throw new Error('Invalid market type');
    }
    filter.marketType = marketType;
  }

  const markets = await Market.find(filter).sort({ createdAt: 1 });
  return markets;
};

/**
 * Get markets by type
 */
const getMarketsByType = async (marketType, sportType = null) => {
  if (!Object.values(Market.MARKET_TYPES).includes(marketType)) {
    throw new Error('Invalid market type');
  }

  const filter = { marketType, isActive: true };
  if (sportType) {
    if (!['cricket', 'soccer', 'tennis'].includes(sportType)) {
      throw new Error('Invalid sport type');
    }
    filter.sportType = sportType;
  }

  const markets = await Market.find(filter).sort({ createdAt: -1 });
  return markets;
};

/**
 * Get market by ID
 */
const getMarketById = async (marketId) => {
  const market = await Market.findOne({ marketId, isActive: true });
  if (!market) {
    throw new Error('Market not found');
  }
  return market;
};

/**
 * Get market statistics
 */
const getMarketStats = async (marketId) => {
  const market = await Market.findOne({ marketId });
  if (!market) {
    throw new Error('Market not found');
  }

  const stats = await Bet.aggregate([
    { 
      $match: { 
        marketId, 
        status: { $in: ['matched', 'partially_matched', 'settled'] } 
      } 
    },
    {
      $group: {
        _id: '$type',
        totalBets: { $sum: 1 },
        totalStake: { $sum: '$stake' },
        totalMatched: { $sum: '$matchedAmount' },
        totalProfit: { 
          $sum: { 
            $cond: [
              { $eq: ['$settlementResult', 'win'] }, 
              { $cond: [
                { $eq: ['$type', 'back'] },
                { $multiply: ['$matchedAmount', { $subtract: ['$odds', 1] }] },
                '$matchedAmount'
              ]}, 
              0
            ] 
          } 
        },
        totalLoss: { 
          $sum: { 
            $cond: [
              { $eq: ['$settlementResult', 'lose'] }, 
              { $cond: [
                { $eq: ['$type', 'back'] },
                '$matchedAmount',
                { $multiply: ['$matchedAmount', { $subtract: ['$odds', 1] }] }
              ]}, 
              0
            ] 
          } 
        }
      }
    }
  ]);

  const totalBets = await Bet.countDocuments({ marketId });
  const pendingBets = await Bet.countDocuments({ marketId, status: 'pending' });
  const matchedBets = await Bet.countDocuments({ marketId, status: { $in: ['matched', 'partially_matched'] } });
  const settledBets = await Bet.countDocuments({ marketId, status: 'settled' });

  return {
    market,
    stats: stats.reduce((acc, stat) => {
      acc[stat._id] = {
        totalBets: stat.totalBets,
        totalStake: stat.totalStake,
        totalMatched: stat.totalMatched,
        totalProfit: stat.totalProfit || 0,
        totalLoss: stat.totalLoss || 0
      };
      return acc;
    }, {}),
    summary: {
      totalBets,
      pendingBets,
      matchedBets,
      settledBets
    }
  };
};

/**
 * Deactivate market
 */
const deactivateMarket = async (marketId) => {
  const market = await Market.findOneAndUpdate(
    { marketId },
    { isActive: false },
    { new: true }
  );

  if (!market) {
    throw new Error('Market not found');
  }

  return market;
};

/**
 * Activate market
 */
const activateMarket = async (marketId) => {
  const market = await Market.findOneAndUpdate(
    { marketId },
    { isActive: true },
    { new: true }
  );

  if (!market) {
    throw new Error('Market not found');
  }

  return market;
};

module.exports = {
  createOrUpdateMarket,
  getMarketsByEvent,
  getMarketsByType,
  getMarketById,
  getMarketStats,
  deactivateMarket,
  activateMarket
};
