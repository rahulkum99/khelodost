const { body, query } = require('express-validator');
const Bet = require('../../models/Bet');

const validMarketTypes = Object.values(Bet.MARKET_TYPES);

const validatePlaceBet = [
  body('sport')
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('sport must be one of cricket, soccer, tennis'),
  body('eventId').notEmpty().withMessage('eventId is required'),
  body('eventName').notEmpty().withMessage('eventName is required'),
  // eventJsonStamp is fetched server-side from cached socket data, not from frontend
  body('marketId').notEmpty().withMessage('marketId is required'),
  // Accept all defined market types plus legacy/frontend alias "tos_maket"
  body('marketType')
    .custom((value) => {
      return validMarketTypes.includes(value) || value === 'tos_maket';
    })
    .withMessage('Invalid marketType'),
  body('selectionId').notEmpty().withMessage('selectionId is required'),
  body('selectionName').notEmpty().withMessage('selectionName is required'),
  body('betType')
    .isIn(['back', 'lay', 'yes', 'no', 'over', 'under'])
    .withMessage('Invalid betType'),
  body('stake')
    .isFloat({ gt: 0 })
    .withMessage('stake must be greater than 0'),
  // Odds are required for matching (both match_odds and bookmakers_fancy)
  body('odds')
    .isFloat({ gt: 0 })
    .withMessage('odds must be greater than 0'),
  // priceOname is required for exact quote matching
  body('priceOname')
    .isString()
    .notEmpty()
    .withMessage('priceOname is required'),
  body('lineValue')
    .optional()
    .isFloat()
    .withMessage('lineValue must be a number'),
];

const validateGetMyBets = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport'),
  query('status')
    .optional()
    .isIn(['open', 'settled'])
    .withMessage('Invalid status'),
  query('marketType')
    .optional()
    .isIn(validMarketTypes)
    .withMessage('Invalid marketType'),
];

const validateSettleMarket = [
  body('marketType')
    .isIn(validMarketTypes)
    .withMessage('Invalid marketType'),
  body('marketId').notEmpty().withMessage('marketId is required'),
  body('eventId').notEmpty().withMessage('eventId is required'),
];

module.exports = {
  validatePlaceBet,
  validateGetMyBets,
  validateSettleMarket,
};

