const { body, param, query } = require('express-validator');

/**
 * Validation for placing a bet
 */
const validatePlaceBet = [
  body('marketId')
    .notEmpty()
    .withMessage('Market ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Market ID must be between 1 and 200 characters'),
  body('sectionId')
    .notEmpty()
    .withMessage('Section ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Section ID must be between 1 and 200 characters'),
  body('eventId')
    .notEmpty()
    .withMessage('Event ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Event ID must be between 1 and 200 characters'),
  body('marketName')
    .notEmpty()
    .withMessage('Market name is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Market name must be between 1 and 200 characters'),
  body('sectionName')
    .notEmpty()
    .withMessage('Section name is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Section name must be between 1 and 200 characters'),
  body('marketType')
    .optional()
    .isIn(['match_odds', 'bookmakers_fancy', 'line_market', 'meter_market', 'kado_market'])
    .withMessage('Invalid market type'),
  body('type')
    .notEmpty()
    .withMessage('Bet type is required')
    .isIn(['back', 'lay'])
    .withMessage('Bet type must be either "back" or "lay"'),
  body('odds')
    .notEmpty()
    .withMessage('Odds are required')
    .custom((value) => {
      const odds = parseFloat(value);
      if (isNaN(odds) || odds <= 0) {
        throw new Error('Odds must be a valid number greater than 0');
      }
      return true;
    }),
  body('stake')
    .notEmpty()
    .withMessage('Stake is required')
    .isFloat({ min: 0.01 })
    .withMessage('Stake must be at least 0.01')
];

/**
 * Validation for cancelling a bet
 */
const validateCancelBet = [
  param('betId')
    .notEmpty()
    .withMessage('Bet ID is required')
    .isMongoId()
    .withMessage('Invalid bet ID format')
];

/**
 * Validation for settling an event
 */
const validateSettleEvent = [
  body('eventId')
    .notEmpty()
    .withMessage('Event ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Event ID must be between 1 and 200 characters'),
  body('winningSectionId')
    .notEmpty()
    .withMessage('Winning section ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Winning section ID must be between 1 and 200 characters')
];

/**
 * Validation for getting user bets
 */
const validateGetUserBets = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('status')
    .optional()
    .isIn(['pending', 'matched', 'partially_matched', 'unmatched', 'cancelled', 'settled'])
    .withMessage('Invalid bet status'),
  query('type')
    .optional()
    .isIn(['back', 'lay'])
    .withMessage('Invalid bet type'),
  query('eventId')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Event ID must be between 1 and 200 characters'),
  query('marketId')
    .optional()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Market ID must be between 1 and 200 characters')
];

/**
 * Validation for bet ID parameter
 */
const validateBetIdParam = [
  param('betId')
    .notEmpty()
    .withMessage('Bet ID is required')
    .isMongoId()
    .withMessage('Invalid bet ID format')
];

module.exports = {
  validatePlaceBet,
  validateCancelBet,
  validateSettleEvent,
  validateGetUserBets,
  validateBetIdParam
};
