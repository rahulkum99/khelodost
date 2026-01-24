const { validationResult } = require('express-validator');
const betService = require('./bet.service');
const Bet = require('../../models/Bet');

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  next();
};

const placeBet = async (req, res) => {
  try {
    const bet = await betService.placeBet(req.userId, req.body, req);
    res.json({
      success: true,
      message: 'Bet placed successfully',
      data: bet,
    });
  } catch (err) {
    console.error('placeBet error:', err);
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to place bet',
    });
  }
};

const getMyBets = async (req, res) => {
  try {
    const bets = await betService.getUserBets(req.userId, req.query);
    res.json({
      success: true,
      data: bets,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to fetch bets',
    });
  }
};

const getTodayBets = async (req, res) => {
  try {
    const bets = await betService.getTodayBets(req.userId, req.query);
    res.json({
      success: true,
      data: bets,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to fetch today\'s bets',
    });
  }
};

const getTodayOpenBets = async (req, res) => {
  try {
    const bets = await betService.getTodayOpenBets(req.userId, req.query);
    res.json({
      success: true,
      data: bets,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to fetch today\'s open bets',
    });
  }
};

const settleMarket = async (req, res) => {
  try {
    await betService.settleMarket(req.body, req);
    res.json({
      success: true,
      message: 'Market settled successfully',
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to settle market',
    });
  }
};

// Simple live markets composition from cached sports data
const {
  getLatestCricketData,
} = require('../../services/cricket.service');
const {
  getLatestSoccerData,
} = require('../../services/soccer.service');
const {
  getLatestTennisData,
} = require('../../services/tennis.service');

const getLiveMarkets = async (req, res) => {
  try {
    const cricket = getLatestCricketData() || [];
    const soccer = getLatestSoccerData() || [];
    const tennis = getLatestTennisData() || [];

    res.json({
      success: true,
      data: {
        cricket,
        soccer,
        tennis,
      },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      message: err.message || 'Failed to fetch live markets',
    });
  }
};

module.exports = {
  handleValidationErrors,
  placeBet,
  getMyBets,
  getTodayBets,
  getTodayOpenBets,
  settleMarket,
  getLiveMarkets,
};

