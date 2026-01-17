const marketSyncService = require('./marketSync.service');
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
 * Sync markets from API data
 */
const syncMarkets = async (req, res, next) => {
  try {
    const { apiData, sportType = 'cricket' } = req.body;

    if (!apiData) {
      return res.status(400).json({
        success: false,
        message: 'API data is required'
      });
    }

    const result = await marketSyncService.syncMarketsFromApiData(apiData, sportType);

    res.json({
      success: true,
      message: `Synced ${result.synced} out of ${result.total} markets`,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to sync markets'
    });
  }
};

/**
 * Get market sections from API data
 */
const getMarketSections = async (req, res, next) => {
  try {
    const { marketId } = req.params;
    const { apiData } = req.body;

    if (!apiData) {
      return res.status(400).json({
        success: false,
        message: 'API data is required'
      });
    }

    const market = marketSyncService.findMarketInApiData(apiData, marketId);
    if (!market) {
      return res.status(404).json({
        success: false,
        message: 'Market not found in API data'
      });
    }

    const sections = marketSyncService.getMarketSections(market);

    res.json({
      success: true,
      data: { sections }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to get market sections'
    });
  }
};

module.exports = {
  handleValidationErrors,
  syncMarkets,
  getMarketSections
};
