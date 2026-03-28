const { body, query, param } = require('express-validator');
const Bet = require('../../models/Bet');

const validMarketTypes = Object.values(Bet.MARKET_TYPES);

const validatePlaceBet = [
  body('sport')
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('sport must be one of cricket, soccer, tennis, casino'),
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
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
  query('status')
    .optional()
    .isIn(['open', 'settled'])
    .withMessage('Invalid status'),
  query('marketType')
    .optional()
    .isIn(validMarketTypes)
    .withMessage('Invalid marketType'),
  // Omit both to get today's bets (UTC day); same range as GET /today-bets
  query('from')
    .optional()
    .isISO8601()
    .withMessage('from must be a valid ISO 8601 date'),
  query('to')
    .optional()
    .isISO8601()
    .withMessage('to must be a valid ISO 8601 date'),
];

const validateGetMyProfitLoss = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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
    .exists({ checkFalsy: true })
    .withMessage('marketType is required')
    .bail()
    .customSanitizer((v) => String(v).trim().toLowerCase())
    .custom((value) => validMarketTypes.includes(value) || value === 'tos_maket' || value === 'fancy1')
    .withMessage('Invalid marketType'),
  body('marketId')
    .exists({ checkFalsy: true })
    .withMessage('marketId is required')
    .bail()
    .customSanitizer((v) => String(v).trim()),
  body('eventId')
    .exists({ checkFalsy: true })
    .withMessage('eventId is required')
    .bail()
    .customSanitizer((v) => String(v).trim()),
  // Optional: for markets that have multiple sections under same marketId (e.g. provider fancy sections).
  // When provided, settlement will apply only to that selectionId.
  body('selectionId')
    .optional({ nullable: true })
    .customSanitizer((v) => String(v).trim()),
  // For numeric-result markets (like fancy/line/meter), settlement needs a final value.
  body('finalValue')
    .optional({ nullable: true })
    .custom((v, { req }) => {
      const mt = String(req.body?.marketType || '').trim().toLowerCase();
      if ([Bet.MARKET_TYPES.FANCY, Bet.MARKET_TYPES.LINE_MARKET, Bet.MARKET_TYPES.METER_MARKET].includes(mt)) {
        return v !== undefined && v !== null && v !== '';
      }
      return true;
    })
    .withMessage('finalValue is required for this marketType')
    .bail()
    .custom((v, { req }) => {
      const mt = String(req.body?.marketType || '').trim().toLowerCase();
      if ([Bet.MARKET_TYPES.FANCY, Bet.MARKET_TYPES.LINE_MARKET, Bet.MARKET_TYPES.METER_MARKET].includes(mt)) {
        return !Number.isNaN(Number(v));
      }
      return true;
    })
    .withMessage('finalValue must be a number'),
];

const validateCancelMarket = [
  body('marketType')
    .exists({ checkFalsy: true })
    .withMessage('marketType is required')
    .bail()
    .customSanitizer((v) => String(v).trim().toLowerCase())
    .custom((value) => validMarketTypes.includes(value) || value === 'tos_maket' || value === 'fancy1')
    .withMessage('Invalid marketType'),
  body('marketId')
    .exists({ checkFalsy: true })
    .withMessage('marketId is required')
    .bail()
    .customSanitizer((v) => String(v).trim()),
  body('eventId')
    .exists({ checkFalsy: true })
    .withMessage('eventId is required')
    .bail()
    .customSanitizer((v) => String(v).trim()),
  body('selectionId')
    .optional({ nullable: true })
    .customSanitizer((v) => String(v).trim()),
  body('reason')
    .optional({ nullable: true })
    .isString()
    .isLength({ max: 200 })
    .withMessage('reason must be a string up to 200 chars'),
];

const validateAdminBetList = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
  query('settlement')
    .optional()
    .isIn(['settled', 'unsettled', 'void'])
    .withMessage('Invalid settlement filter'),
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
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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

// Admin: user-wise profit/loss (+ possible P/L) for a particular market within an event (hierarchy scoped)
const validateAdminHierarchyUserMarketProfitLoss = [
  query('eventId')
    .notEmpty()
    .withMessage('eventId is required'),
  query('marketId')
    .notEmpty()
    .withMessage('marketId is required'),
  // Accept marketType enums plus frontend/provider aliases for toss market
  query('marketType')
    .custom((value) => validMarketTypes.includes(value) || value === 'tos_maket' || value === 'fancy1')
    .withMessage('Invalid marketType'),
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
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
];

// Admin: hierarchy-wide bet list for a particular market (per bet rows, includes username)
const validateAdminHierarchyMarketBets = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
  query('eventId')
    .notEmpty()
    .withMessage('eventId is required'),
  query('marketId')
    .optional()
    .notEmpty()
    .withMessage('marketId must be non-empty if provided'),
  query('marketType')
    .optional()
    .custom((value) => validMarketTypes.includes(value) || value === 'tos_maket' || value === 'fancy1')
    .withMessage('Invalid marketType'),
  query('status')
    .optional()
    .isIn(['open', 'settled'])
    .withMessage('Invalid status'),
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

// Admin: simple market analysis for today — grouped by event with total placed bets
const validateGetTodayInplayPlacedBets = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

// Admin: profit/loss market analysis by selection within an event
const validateMarketAnalysisBySelection = [
  query('eventId')
    .notEmpty()
    .withMessage('eventId is required'),
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
  query('marketType')
    .optional()
    .isIn(validMarketTypes)
    .withMessage('Invalid marketType'),
  query('status')
    .optional()
    .isIn(['open', 'settled'])
    .withMessage('Invalid status'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 500 })
    .withMessage('limit must be between 1 and 500'),
];

// Internal: sport-wise unsettled bet list for settlement
const validateUnsettledBetsForSettlement = [
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
];

const validateAdminUserExposureGameList = [
  query('userId')
    .notEmpty()
    .withMessage('userId is required')
    .isMongoId()
    .withMessage('userId must be a valid MongoDB ID'),
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
];

const validateAdminUserMarketExposureBets = [
  query('userId')
    .notEmpty()
    .withMessage('userId is required')
    .isMongoId()
    .withMessage('userId must be a valid MongoDB ID'),
  query('marketId')
    .notEmpty()
    .withMessage('marketId is required'),
  query('eventId')
    .optional()
    .notEmpty()
    .withMessage('eventId must be non-empty if provided'),
  query('sport')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis', 'casino'])
    .withMessage('Invalid sport'),
  query('status')
    .optional()
    .isIn(['open', 'settled'])
    .withMessage('Invalid status'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 1000 })
    .withMessage('limit must be between 1 and 1000'),
];

module.exports = {
  validatePlaceBet,
  validateGetMyBets,
  validateGetMyProfitLoss,
  validateGetMyEventProfitLoss,
  validateSettleMarket,
  validateCancelMarket,
  validateAdminBetList,
  validateAdminUserBetList,
  validateAdminUserProfitLoss,
  validateAdminUserEventProfitLoss,
  validateAdminHierarchyProfitLossByEvent,
  validateAdminHierarchySettledBets,
  validateAdminHierarchyUserMarketProfitLoss,
  validateAdminHierarchyMarketBets,
  validateGetTodayInplayPlacedBets,
  validateMarketAnalysisBySelection,
  validateAdminUserExposureGameList,
  validateAdminUserMarketExposureBets,
  validateUnsettledBetsForSettlement,
};

