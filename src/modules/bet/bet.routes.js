const express = require('express');
const router = express.Router();
const betController = require('./bet.controller');
const betValidation = require('./bet.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireMinRole } = require('../../middlewares/authorize.middleware');
const { ROLES } = require('../../models/User');
const { apiLimiter } = require('../../middlewares/security.middleware');
const { settlementInternalAuth } = require('../../middlewares/settlementAuth.middleware');

// Apply rate limiting to all routes
router.use(apiLimiter);

// Settlement endpoint (server-to-server): protected by internal API key/IP only
router.post('/settle',
  settlementInternalAuth,
  ...betValidation.validateSettleMarket,
  betController.handleValidationErrors,
  betController.settleMarket
);

// Cancel/Void endpoint (server-to-server): refunds exposure for OPEN bets
router.post('/cancel',
  settlementInternalAuth,
  ...betValidation.validateCancelMarket,
  betController.handleValidationErrors,
  betController.cancelMarket
);

// Unsettled bet list for settlement (server-to-server)
router.get(
  '/settlement/unsettled-bets',
  settlementInternalAuth,
  ...betValidation.validateUnsettledBetsForSettlement,
  betController.handleValidationErrors,
  betController.getUnsettledBetsForSettlement
);

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

router.get('/my-profit-loss',
  ...betValidation.validateGetMyProfitLoss,
  betController.handleValidationErrors,
  betController.getMyProfitLoss
);

router.get('/my-event-profit-loss',
  ...betValidation.validateGetMyEventProfitLoss,
  betController.handleValidationErrors,
  betController.getMyEventProfitLoss
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
router.use(requireMinRole(ROLES.AGENT));


router.get(
  '/today-inplay-placed-bets',
  betValidation.validateGetTodayInplayPlacedBets,
  betController.handleValidationErrors,
  betController.getTodayInplayPlacedBets
);


// Admin: profit/loss market analysis by selectionId within an event
router.get(
  '/admin/market-analysis',
  betValidation.validateMarketAnalysisBySelection,
  betController.handleValidationErrors,
  betController.getMarketAnalysisBySelection
);

// Admin bet list (filtered by hierarchy)
router.get('/admin/bet-list',
  ...betValidation.validateAdminBetList,
  betController.handleValidationErrors,
  betController.getAdminBetList
);

// Admin: user-wise bet list (filtered by hierarchy)
router.get('/admin/users/:userId/bets',
  ...betValidation.validateAdminUserBetList,
  betController.handleValidationErrors,
  betController.getAdminUserBets
);

// Admin: get user profit/loss grouped by event
router.get('/admin/user-profit-loss',
  ...betValidation.validateAdminUserProfitLoss,
  betController.handleValidationErrors,
  betController.getAdminUserProfitLoss
);

// Admin: get user profit/loss by markets/bets within an event
router.get('/admin/user-event-profit-loss',
  ...betValidation.validateAdminUserEventProfitLoss,
  betController.handleValidationErrors,
  betController.getAdminUserEventProfitLoss
);

// Admin: hierarchy-wide profit/loss by event (all users under admin)
router.get('/admin/hierarchy-profit-loss',
  ...betValidation.validateAdminHierarchyProfitLossByEvent,
  betController.handleValidationErrors,
  betController.getAdminHierarchyProfitLossByEvent
);

// Admin: hierarchy-wide settled bets (per bet rows, includes username)
router.get('/admin/hierarchy-settled-bets',
  ...betValidation.validateAdminHierarchySettledBets,
  betController.handleValidationErrors,
  betController.getAdminHierarchySettledBets
);

// Admin: hierarchy-wide bet list for a particular market (per bet rows, includes username)
router.get('/admin/hierarchy-market-bets',
  ...betValidation.validateAdminHierarchyMarketBets,
  betController.handleValidationErrors,
  betController.getAdminHierarchyMarketBets
);

// Admin: user-wise profit/loss (+ possible profit/loss) for a particular market (hierarchy scoped)
router.get('/admin/hierarchy-user-market-profit-loss',
  ...betValidation.validateAdminHierarchyUserMarketProfitLoss,
  betController.handleValidationErrors,
  betController.getAdminHierarchyUserMarketProfitLoss
);

// Admin: user exposure game list — open bets grouped by sport > event > market
router.get('/admin/user-exposure-game-list',
  ...betValidation.validateAdminUserExposureGameList,
  betController.handleValidationErrors,
  betController.getAdminUserExposureGameList
);

// Admin: market exposure rows for a particular user + market
router.get('/admin/user-market-exposure-bets',
  ...betValidation.validateAdminUserMarketExposureBets,
  betController.handleValidationErrors,
  betController.getAdminUserMarketExposureBets
);

module.exports = router;
