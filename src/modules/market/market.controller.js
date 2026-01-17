const marketService = require('./market.service');
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
 * Get markets by event
 */
const getMarketsByEvent = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const { marketType } = req.query;
    const markets = await marketService.getMarketsByEvent(eventId, marketType);
    
    res.json({
      success: true,
      data: { markets }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch markets'
    });
  }
};

/**
 * Get markets by type
 */
const getMarketsByType = async (req, res, next) => {
  try {
    const { marketType } = req.params;
    const { sportType } = req.query;
    const markets = await marketService.getMarketsByType(marketType, sportType);
    
    res.json({
      success: true,
      data: { markets }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch markets'
    });
  }
};

/**
 * Get market by ID
 */
const getMarketById = async (req, res, next) => {
  try {
    const { marketId } = req.params;
    const market = await marketService.getMarketById(marketId);
    
    res.json({
      success: true,
      data: { market }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Market not found'
    });
  }
};

/**
 * Get market statistics
 */
const getMarketStats = async (req, res, next) => {
  try {
    const { marketId } = req.params;
    const stats = await marketService.getMarketStats(marketId);
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'Market not found'
    });
  }
};

/**
 * Create or update market (admin only)
 */
const createOrUpdateMarket = async (req, res, next) => {
  try {
    const marketData = req.body;
    const market = await marketService.createOrUpdateMarket(marketData);
    
    res.json({
      success: true,
      message: 'Market created/updated successfully',
      data: { market }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create/update market'
    });
  }
};

/**
 * Deactivate market (admin only)
 */
const deactivateMarket = async (req, res, next) => {
  try {
    const { marketId } = req.params;
    const market = await marketService.deactivateMarket(marketId);
    
    res.json({
      success: true,
      message: 'Market deactivated successfully',
      data: { market }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to deactivate market'
    });
  }
};

/**
 * Activate market (admin only)
 */
const activateMarket = async (req, res, next) => {
  try {
    const { marketId } = req.params;
    const market = await marketService.activateMarket(marketId);
    
    res.json({
      success: true,
      message: 'Market activated successfully',
      data: { market }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to activate market'
    });
  }
};

module.exports = {
  handleValidationErrors,
  getMarketsByEvent,
  getMarketsByType,
  getMarketById,
  getMarketStats,
  createOrUpdateMarket,
  deactivateMarket,
  activateMarket
};
