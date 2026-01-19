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
  betValidation.validatePlaceBet,
  betController.handleValidationErrors,
  betController.placeBet
);

router.get('/my-bets',
  betValidation.validateGetUserBets,
  betController.handleValidationErrors,
  betController.getUserBets
);

// This route must come after all specific routes (like /place, /my-bets)
// to avoid matching them as betId parameters
router.get('/:betId',
  betValidation.validateBetIdParam,
  betController.handleValidationErrors,
  betController.getBetById
);

router.post('/cancel/:betId',
  betValidation.validateCancelBet,
  betController.handleValidationErrors,
  betController.cancelBet
);

// Admin routes - require admin role or higher
router.use(requireMinRole(ROLES.ADMIN));

// Settle event
router.post('/settle',
  betValidation.validateSettleEvent,
  betController.handleValidationErrors,
  betController.settleEvent
);

// Get bets for any user (admin only)
router.get('/user/:userId',
  betValidation.validateGetUserBets,
  betController.handleValidationErrors,
  betController.getUserBets
);

module.exports = router;
