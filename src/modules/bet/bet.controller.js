const betService = require('./bet.service');
const { validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

/**
 * Place a bet
 */
const placeBet = async (req, res, next) => {
  try {
    const betData = req.body;
    const result = await betService.placeBet(req.userId, betData, req);

    res.json({
      success: true,
      message: 'Bet placed successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to place bet'
    });
  }
};

/**
 * Cancel a bet
 */
const cancelBet = async (req, res, next) => {
  try {
    const { betId } = req.params;
    const result = await betService.cancelBet(req.userId, betId, req);

    res.json({
      success: true,
      message: 'Bet cancelled successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to cancel bet'
    });
  }
};

/**
 * Settle an event (admin only)
 */
const settleEvent = async (req, res, next) => {
  try {
    const { eventId, winningSectionId } = req.body;
    const result = await betService.settleEvent(eventId, winningSectionId, req.userId, req);

    res.json({
      success: true,
      message: result.message,
      data: { settledCount: result.settledCount }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to settle event'
    });
  }
};

/**
 * Get user bets
 */
const getUserBets = async (req, res, next) => {
  try {
    const userId = req.params.userId || req.userId;
    
    // Users can only view their own bets unless they're admin
    if (req.params.userId && req.params.userId !== req.userId) {
      // Check if user is admin (this should be handled by middleware, but double check)
      const { ROLES } = require('../../models/User');
      if (!req.user || !['super_admin', 'admin'].includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'You can only view your own bets'
        });
      }
    }

    const result = await betService.getUserBets(userId, req.query);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch bets'
    });
  }
};

/**
 * Get bet by ID
 */
const getBetById = async (req, res, next) => {
  try {
    const { betId } = req.params;
    const userId = req.params.userId || req.userId;
    
    // Users can only view their own bets unless they're admin
    const bet = await betService.getBetById(betId, userId);

    res.json({
      success: true,
      data: { bet }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Bet not found'
    });
  }
};

module.exports = {
  handleValidationErrors,
  placeBet,
  cancelBet,
  settleEvent,
  getUserBets,
  getBetById
};
