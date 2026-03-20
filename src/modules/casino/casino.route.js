const express = require('express');
const { body } = require('express-validator');
const { validationResult } = require('express-validator');

const casinoController = require('./casino.controller');

const { authenticate } = require('../../middlewares/auth.middleware');
const { apiLimiter } = require('../../middlewares/security.middleware');

const router = express.Router();

// Apply rate limiting to all casino routes
router.use(apiLimiter);

const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array(),
    });
  }
  return next();
};

// Provider -> our server callback (no JWT auth)
router.post('/callback/bet', casinoController.betCallback);

// Public read endpoints (optional auth)
router.get('/game/providers', casinoController.getProviders);
router.get('/game/list', casinoController.getGameList);

// Everything below requires authenticated user
router.use(authenticate);

// User: get game url (seamless)
router.post(
  '/game/v1',
  body('game_uid').notEmpty().withMessage('game_uid is required'),
  body('language').optional().isString().notEmpty(),
  body('platform').optional().isIn(['1', '2']).withMessage('platform must be 1 (web) or 2 (H5)'),
  body('home_url').optional().isString(),
  body('callback_url').optional().isString(),
  handleValidationErrors,
  casinoController.getGameV1
);

// User: get game url (transfer mode)
router.post(
  '/game/v2',
  body('game_uid').optional().isString(),
  body('transfer_id').notEmpty().withMessage('transfer_id is required'),
  body('transfer_amount').optional().isFloat(),
  body('credit_amount').optional().isFloat(),
  body('language').optional().isString().notEmpty(),
  body('platform').optional().isIn(['1', '2']).withMessage('platform must be 1 (web) or 2 (H5)'),
  body('home_url').optional().isString(),
  handleValidationErrors,
  casinoController.getGameV2
);

// User: get transaction list (pass-through from provider)
router.post(
  '/game/transaction/list',
  body('from_date').notEmpty().withMessage('from_date is required (UTC+0 ms)'),
  body('to_date').notEmpty().withMessage('to_date is required (UTC+0 ms)'),
  body('page_no').optional().isInt({ min: 1 }),
  body('page_size').optional().isInt({ min: 1, max: 5000 }),
  handleValidationErrors,
  casinoController.getTransactionList
);

module.exports = router;

