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
    res.status(err.status || 400).json({
      success: false,
      code: err.code || 'BET_PLACE_FAILED',
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

const getMyProfitLoss = async (req, res) => {
  try {
    const data = await betService.getUserProfitLossByEvent(req.userId, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to fetch profit/loss',
    });
  }
};

const getMyEventProfitLoss = async (req, res) => {
  try {
    const data = await betService.getUserProfitLossByEventMarkets(req.userId, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to fetch event profit/loss',
    });
  }
};

// Internal: sport-wise unsettled bet list for settlement
const getUnsettledBetsForSettlement = async (req, res) => {
  try {
    const rows = await betService.getUnsettledBetsForSettlement(req.query);

    // Group by sport (cricket / soccer / tennis)
    const sports = ['cricket', 'soccer', 'tennis', 'casino'];
    const grouped = sports.reduce((acc, s) => {
      acc[s] = [];
      return acc;
    }, {});

    for (const row of rows) {
      if (!grouped[row.sport]) grouped[row.sport] = [];
      grouped[row.sport].push({
        eventId: row.eventId,
        eventName: row.eventName,
        marketId: row.marketId,
        marketName: row.marketName,
        selectionId: row.selectionId,
        selectionName: row.selectionName,
        openBets: row.openBets,
        totalStake: row.totalStake,
        totalExposure: row.totalExposure,
      });
    }

    res.json({
      success: true,
      data: grouped,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to fetch unsettled bets for settlement',
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

const cancelMarket = async (req, res) => {
  try {
    const result = await betService.cancelMarket(req.body, req);
    res.json({
      success: true,
      message: 'Market cancelled successfully',
      data: result,
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'Failed to cancel market',
    });
  }
};

const getAdminBetList = async (req, res) => {
  try {
    const data = await betService.getAdminBetList(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch bet list',
    });
  }
};

// Admin: simple market analysis for today (grouped by event, total placed bets)
const getTodayInplayPlacedBets = async (req, res) => {
  try {
    const data = await betService.getTodayInplayPlacedBets(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch market analysis',
    });
  }
};

// Admin: fetch bets for a specific user (hierarchy enforced in service)
const getAdminUserBets = async (req, res) => {
  try {
    const data = await betService.getAdminBetList(req.userId, req.user.role, {
      ...req.query,
      userId: req.params.userId,
    });
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch user bets',
    });
  }
};

// Admin: get user profit/loss grouped by event
const getAdminUserProfitLoss = async (req, res) => {
  try {
    const data = await betService.getAdminUserProfitLoss(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch user profit/loss',
    });
  }
};

// Admin: get user profit/loss by markets/bets within an event
const getAdminUserEventProfitLoss = async (req, res) => {
  try {
    const data = await betService.getAdminUserEventProfitLoss(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch user event profit/loss',
    });
  }
};

// Admin: get hierarchy-wide profit/loss by event (all users under admin)
const getAdminHierarchyProfitLossByEvent = async (req, res) => {
  try {
    const data = await betService.getAdminHierarchyProfitLossByEvent(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch hierarchy profit/loss',
    });
  }
};

// Admin: hierarchy-wide settled bets list (per bet rows, includes username)
const getAdminHierarchySettledBets = async (req, res) => {
  try {
    const data = await betService.getAdminHierarchySettledBets(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch hierarchy settled bets',
    });
  }
};

// Admin: hierarchy-wide bet list for a particular market (per bet rows, includes username)
const getAdminHierarchyMarketBets = async (req, res) => {
  try {
    const data = await betService.getAdminHierarchyMarketBets(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch hierarchy market bets',
    });
  }
};

// Admin: user-wise profit/loss (+ possible profit/loss) for a particular market (hierarchy scoped)
const getAdminHierarchyUserMarketProfitLoss = async (req, res) => {
  try {
    const data = await betService.getAdminHierarchyUserMarketProfitLoss(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch user-wise market profit/loss',
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

const getMarketAnalysisBySelection = async (req, res) => {
  try {
    const data = await betService.getMarketAnalysisBySelection(req.userId, req.user.role, req.query);
    res.json({
      success: true,
      data,
    });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({
      success: false,
      message: err.message || 'Failed to fetch market analysis by selection',
    });
  }
};

const getAdminUserExposureGameList = async (req, res) => {
  try {
    const data = await betService.getAdminUserExposureGameList(req.userId, req.user.role, req.query);
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ success: false, message: err.message || 'Failed to fetch user exposure game list' });
  }
};

const getAdminUserMarketExposureBets = async (req, res) => {
  try {
    const data = await betService.getAdminUserMarketExposureBets(req.userId, req.user.role, req.query);
    res.json({ success: true, data });
  } catch (err) {
    const status = err.status || 400;
    res.status(status).json({ success: false, message: err.message || 'Failed to fetch user market exposure bets' });
  }
};

module.exports = {
  handleValidationErrors,
  placeBet,
  getMyBets,
  getTodayBets,
  getTodayOpenBets,
  getMyProfitLoss,
  getMyEventProfitLoss,
  settleMarket,
  cancelMarket,
  getTodayInplayPlacedBets,
  getMarketAnalysisBySelection,
  getAdminBetList,
  getAdminUserBets,
  getAdminUserProfitLoss,
  getAdminUserEventProfitLoss,
  getAdminHierarchyProfitLossByEvent,
  getAdminHierarchySettledBets,
  getAdminHierarchyMarketBets,
  getAdminHierarchyUserMarketProfitLoss,
  getAdminUserExposureGameList,
  getAdminUserMarketExposureBets,
  getLiveMarkets,
  getUnsettledBetsForSettlement,
};

