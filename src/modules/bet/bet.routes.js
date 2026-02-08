const express = require('express');
const router = express.Router();
const betController = require('./bet.controller');
const betValidation = require('./bet.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireMinRole } = require('../../middlewares/authorize.middleware');
const { ROLES } = require('../../models/User');
const { apiLimiter } = require('../../middlewares/security.middleware');

// Apply rate limiting to all routes
router.use(apiLimiter);

// All bet routes require authentication
router.use(authenticate);

// User bet routes
router.post('/place',
  ...betValidation.validatePlaceBet,
  betController.handleValidationErrors,
  betController.placeBet
);

router.get('/my-bets',
  ...betValidation.validateGetMyBets,
  betController.handleValidationErrors,
  betController.getMyBets
);

router.get('/today-bets',
  ...betValidation.validateGetMyBets,
  betController.handleValidationErrors,
  betController.getTodayBets
);

router.get('/today-open-bets',
  ...betValidation.validateGetMyBets,
  betController.handleValidationErrors,
  betController.getTodayOpenBets
);

// Get live markets (requires auth, but not admin)
router.get('/markets/live', betController.getLiveMarkets);

// Admin routes - require admin role or higher
router.use(requireMinRole(ROLES.ADMIN));

// Admin bet list (filtered by hierarchy)
router.get('/admin/bet-list',
  ...betValidation.validateAdminBetList,
  betController.handleValidationErrors,
  betController.getAdminBetList
);

// Settle market
router.post('/settle',
  ...betValidation.validateSettleMarket,
  betController.handleValidationErrors,
  betController.settleMarket
);

module.exports = router;
