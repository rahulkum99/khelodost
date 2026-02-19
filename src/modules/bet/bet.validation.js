const { body, query, param } = require('express-validator');
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

const validateGetMyProfitLoss = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport'),
  // ISO dates, e.g. 2026-02-17 or 2026-02-17T12:00:00Z
  query('from')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('from must be a valid ISO date'),
  query('to')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('to must be a valid ISO date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

const validateGetMyEventProfitLoss = [
  query('eventId')
    .notEmpty()
    .withMessage('eventId is required'),
  query('marketId')
    .optional()
    .notEmpty()
    .withMessage('marketId must be non-empty if provided'),
  query('by')
    .optional()
    .isIn(['market', 'bet'])
    .withMessage('by must be market or bet'),
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport'),
  query('from')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('from must be a valid ISO date'),
  query('to')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('to must be a valid ISO date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

const validateSettleMarket = [
  body('marketType')
    .isIn(validMarketTypes)
    .withMessage('Invalid marketType'),
  body('marketId').notEmpty().withMessage('marketId is required'),
  body('eventId').notEmpty().withMessage('eventId is required'),
];

const validateAdminBetList = [
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
  query('userId')
    .optional()
    .isMongoId()
    .withMessage('userId must be a valid MongoDB ID'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be a positive integer'),
];

// Admin: get bets for a specific userId (path param), plus optional filters + pagination
const validateAdminUserBetList = [
  param('userId')
    .isMongoId()
    .withMessage('userId must be a valid MongoDB ID'),
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
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('limit must be between 1 and 100'),
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('page must be a positive integer'),
];

// Admin: get user profit/loss grouped by event
const validateAdminUserProfitLoss = [
  query('userId')
    .isMongoId()
    .withMessage('userId must be a valid MongoDB ID'),
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport'),
  query('from')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('from must be a valid ISO date'),
  query('to')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('to must be a valid ISO date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

// Admin: get user profit/loss by markets/bets within an event
const validateAdminUserEventProfitLoss = [
  query('userId')
    .isMongoId()
    .withMessage('userId must be a valid MongoDB ID'),
  query('eventId')
    .notEmpty()
    .withMessage('eventId is required'),
  query('marketId')
    .optional()
    .notEmpty()
    .withMessage('marketId must be non-empty if provided'),
  query('by')
    .optional()
    .isIn(['market', 'bet'])
    .withMessage('by must be market or bet'),
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport'),
  query('from')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('from must be a valid ISO date'),
  query('to')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('to must be a valid ISO date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

// Admin: hierarchy-wide profit/loss by event (all users under admin)
const validateAdminHierarchyProfitLossByEvent = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport'),
  query('from')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('from must be a valid ISO date'),
  query('to')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('to must be a valid ISO date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

// Admin: hierarchy-wide settled bets list (per bet rows, includes username)
const validateAdminHierarchySettledBets = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport'),
  query('eventId')
    .optional()
    .notEmpty()
    .withMessage('eventId must be non-empty if provided'),
  query('marketId')
    .optional()
    .notEmpty()
    .withMessage('marketId must be non-empty if provided'),
  query('userId')
    .optional()
    .isMongoId()
    .withMessage('userId must be a valid MongoDB ID'),
  query('from')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('from must be a valid ISO date'),
  query('to')
    .optional()
    .isISO8601()
    .toDate()
    .withMessage('to must be a valid ISO date'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

module.exports = {
  validatePlaceBet,
  validateGetMyBets,
  validateGetMyProfitLoss,
  validateGetMyEventProfitLoss,
  validateSettleMarket,
  validateAdminBetList,
  validateAdminUserBetList,
  validateAdminUserProfitLoss,
  validateAdminUserEventProfitLoss,
  validateAdminHierarchyProfitLossByEvent,
  validateAdminHierarchySettledBets,
};

