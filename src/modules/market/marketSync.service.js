const Market = require('../../models/Market');
const marketService = require('./market.service');
const { mapGtypeToMarketType, isMarketOpen } = require('../../utils/marketMapper');

/**
 * Sync markets from API data
 * This function processes the API response and creates/updates markets in the database
 */
const syncMarketsFromApiData = async (apiResponse, sportType = 'cricket') => {
  if (!apiResponse || !apiResponse.data || !Array.isArray(apiResponse.data)) {
    throw new Error('Invalid API response format');
  }

  const syncedMarkets = [];
  const errors = [];

  for (const marketData of apiResponse.data) {
    try {
      // Extract market information
      const marketId = marketData.mid?.toString();
      const eventId = marketData.gmid?.toString();
      const marketName = marketData.mname || 'Unknown Market';
      const gtype = marketData.gtype;
      const status = marketData.status;
      const rem = marketData.rem || '';

      if (!marketId || !eventId) {
        errors.push({
          market: marketName,
          error: 'Missing marketId or eventId'
        });
        continue;
      }

      // Map to internal market type
      const marketType = mapGtypeToMarketType(gtype, marketName);

      // Determine if market is active
      const isActive = isMarketOpen(status);

      // Prepare market data
      const marketPayload = {
        marketId,
        marketName,
        marketType,
        eventId,
        sportType,
        description: rem,
        isActive,
        metadata: {
          gmid: marketData.gmid,
          pmid: marketData.pmid,
          gtype: marketData.gtype,
          status: marketData.status,
          maxb: marketData.maxb,
          max: marketData.max,
          min: marketData.min,
          biplay: marketData.biplay,
          boplay: marketData.boplay,
          iplay: marketData.iplay,
          btcnt: marketData.btcnt,
          rc: marketData.rc,
          ocnt: marketData.ocnt,
          dtype: marketData.dtype,
          visible: marketData.visible,
          sno: marketData.sno
        },
        settlementRules: {
          // Can be customized per market type
          settlementType: marketType === 'match_odds' ? 'winner' : 'custom'
        }
      };

      // Create or update market
      const market = await marketService.createOrUpdateMarket(marketPayload);
      syncedMarkets.push(market);

    } catch (error) {
      errors.push({
        market: marketData.mname || 'Unknown',
        error: error.message
      });
    }
  }

  return {
    success: true,
    synced: syncedMarkets.length,
    total: apiResponse.data.length,
    markets: syncedMarkets,
    errors: errors.length > 0 ? errors : undefined
  };
};

/**
 * Get market sections from API data
 */
const getMarketSections = (marketData) => {
  if (!marketData.section || !Array.isArray(marketData.section)) {
    return [];
  }

  return marketData.section.map(section => ({
    sectionId: section.sid?.toString(),
    sectionName: section.nat || 'Unknown',
    status: section.gstatus || '',
    max: section.max || 0,
    min: section.min || 0,
    odds: section.odds || []
  }));
};

/**
 * Find market in API data by marketId
 */
const findMarketInApiData = (apiResponse, marketId) => {
  if (!apiResponse || !apiResponse.data || !Array.isArray(apiResponse.data)) {
    return null;
  }

  return apiResponse.data.find(m => m.mid?.toString() === marketId.toString());
};

/**
 * Find section in market by sectionId
 */
const findSectionInMarket = (marketData, sectionId) => {
  if (!marketData || !marketData.section || !Array.isArray(marketData.section)) {
    return null;
  }

  return marketData.section.find(s => s.sid?.toString() === sectionId.toString());
};

module.exports = {
  syncMarketsFromApiData,
  getMarketSections,
  findMarketInApiData,
  findSectionInMarket
};
