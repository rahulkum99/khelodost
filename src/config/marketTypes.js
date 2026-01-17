module.exports = {
  MARKET_TYPES: {
    MATCH_ODDS: {
      name: 'Match Odds',
      code: 'match_odds',
      description: 'Standard match winner betting',
      settlementType: 'winner'
    },
    BOOKMAKERS_FANCY: {
      name: 'Bookmakers Fancy',
      code: 'bookmakers_fancy',
      description: 'Fancy markets with custom rules',
      settlementType: 'custom'
    },
    LINE_MARKET: {
      name: 'Line Market',
      code: 'line_market',
      description: 'Line-based betting markets',
      settlementType: 'line'
    },
    METER_MARKET: {
      name: 'Meter Market',
      code: 'meter_market',
      description: 'Meter-based betting markets',
      settlementType: 'meter'
    },
    KADO_MARKET: {
      name: 'Kado Market',
      code: 'kado_market',
      description: 'Kado-style betting markets',
      settlementType: 'kado'
    }
  }
};
