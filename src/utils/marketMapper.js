const Market = require('../models/Market');

/**
 * Map API gtype and mname to internal market type
 */
const mapGtypeToMarketType = (gtype, mname) => {
  // Normalize inputs
  const normalizedGtype = (gtype || '').toLowerCase();
  const normalizedMname = (mname || '').toUpperCase();

  // Match Odds
  if (normalizedGtype === 'match' && normalizedMname === 'MATCH_ODDS') {
    return Market.MARKET_TYPES.MATCH_ODDS;
  }

  // Tied Match is also match odds
  if (normalizedGtype === 'match' && normalizedMname === 'TIED_MATCH') {
    return Market.MARKET_TYPES.MATCH_ODDS;
  }

  // Bookmakers Fancy
  if (normalizedGtype === 'match1' || normalizedMname === 'BOOKMAKER') {
    return Market.MARKET_TYPES.BOOKMAKERS_FANCY;
  }

  // Fancy markets (Normal, Over By Over, etc.)
  if (normalizedGtype === 'fancy') {
    return Market.MARKET_TYPES.BOOKMAKERS_FANCY;
  }

  // Line Market (Odd/Even)
  if (normalizedGtype === 'oddeven' || normalizedMname === 'ODDEVEN') {
    return Market.MARKET_TYPES.LINE_MARKET;
  }

  // Kado Market (Cricket Casino)
  if (normalizedGtype === 'cricketcasino' || normalizedMname.includes('CASINO')) {
    return Market.MARKET_TYPES.KADO_MARKET;
  }

  // Meter Market (for future use)
  // Can be added based on specific gtype values

  // Default to match_odds
  return Market.MARKET_TYPES.MATCH_ODDS;
};

/**
 * Convert API odds format to decimal odds
 * API format: 470 = 4.70, 101 = 1.01
 */
const convertApiOddsToDecimal = (apiOdds) => {
  if (!apiOdds || apiOdds === 0) {
    return null;
  }
  return apiOdds / 100;
};

/**
 * Convert decimal odds to API format
 * Decimal: 4.70 = 470, 1.01 = 101
 */
const convertDecimalToApiOdds = (decimalOdds) => {
  if (!decimalOdds || decimalOdds === 0) {
    return 0;
  }
  return Math.round(decimalOdds * 100);
};

/**
 * Check if market status allows betting
 */
const isMarketOpen = (status) => {
  const normalizedStatus = (status || '').toUpperCase();
  return normalizedStatus === 'OPEN';
};

/**
 * Check if section status allows betting
 */
const isSectionActive = (gstatus) => {
  const normalizedStatus = (gstatus || '').toUpperCase();
  return normalizedStatus === 'ACTIVE' || normalizedStatus === '';
};

/**
 * Get best available odds from odds array
 */
const getBestOdds = (oddsArray, otype) => {
  if (!oddsArray || !Array.isArray(oddsArray)) {
    return null;
  }

  const filteredOdds = oddsArray.filter(
    o => o.otype === otype && o.odds > 0 && o.size > 0
  );

  if (filteredOdds.length === 0) {
    return null;
  }

  // Sort by tier (tno: 0 = best, 1 = second, 2 = third)
  filteredOdds.sort((a, b) => a.tno - b.tno);

  const bestOdd = filteredOdds[0];
  return {
    odds: convertApiOddsToDecimal(bestOdd.odds),
    size: bestOdd.size,
    tier: bestOdd.tno,
    oname: bestOdd.oname
  };
};

/**
 * Get all available odds for a section
 */
const getAvailableOdds = (oddsArray) => {
  if (!oddsArray || !Array.isArray(oddsArray)) {
    return { back: null, lay: null };
  }

  return {
    back: getBestOdds(oddsArray, 'back'),
    lay: getBestOdds(oddsArray, 'lay')
  };
};

/**
 * Validate stake against market limits
 */
const validateStake = (stake, min, max) => {
  if (!stake || stake <= 0) {
    return { valid: false, error: 'Stake must be greater than 0' };
  }

  if (min && stake < min) {
    return { valid: false, error: `Stake must be at least ${min}` };
  }

  if (max && stake > max) {
    return { valid: false, error: `Stake cannot exceed ${max}` };
  }

  return { valid: true };
};

module.exports = {
  mapGtypeToMarketType,
  convertApiOddsToDecimal,
  convertDecimalToApiOdds,
  isMarketOpen,
  isSectionActive,
  getBestOdds,
  getAvailableOdds,
  validateStake
};
