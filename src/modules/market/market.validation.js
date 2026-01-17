const { body, param, query } = require('express-validator');
const Market = require('../../models/Market');

/**
 * Validation for creating/updating market
 */
const validateCreateOrUpdateMarket = [
  body('marketId')
    .notEmpty()
    .withMessage('Market ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Market ID must be between 1 and 200 characters'),
  body('marketName')
    .notEmpty()
    .withMessage('Market name is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Market name must be between 1 and 200 characters'),
  body('marketType')
    .notEmpty()
    .withMessage('Market type is required')
    .isIn(Object.values(Market.MARKET_TYPES))
    .withMessage('Invalid market type'),
  body('eventId')
    .notEmpty()
    .withMessage('Event ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Event ID must be between 1 and 200 characters'),
  body('sportType')
    .notEmpty()
    .withMessage('Sport type is required')
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport type'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

/**
 * Validation for getting markets by event
 */
const validateGetMarketsByEvent = [
  param('eventId')
    .notEmpty()
    .withMessage('Event ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Event ID must be between 1 and 200 characters'),
  query('marketType')
    .optional()
    .isIn(Object.values(Market.MARKET_TYPES))
    .withMessage('Invalid market type')
];

/**
 * Validation for getting markets by type
 */
const validateGetMarketsByType = [
  param('marketType')
    .notEmpty()
    .withMessage('Market type is required')
    .isIn(Object.values(Market.MARKET_TYPES))
    .withMessage('Invalid market type'),
  query('sportType')
    .optional()
    .isIn(['cricket', 'soccer', 'tennis'])
    .withMessage('Invalid sport type')
];

/**
 * Validation for market ID parameter
 */
const validateMarketIdParam = [
  param('marketId')
    .notEmpty()
    .withMessage('Market ID is required')
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Market ID must be between 1 and 200 characters')
];

module.exports = {
  validateCreateOrUpdateMarket,
  validateGetMarketsByEvent,
  validateGetMarketsByType,
  validateMarketIdParam
};
