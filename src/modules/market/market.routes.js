const express = require('express');
const router = express.Router();
const marketController = require('./market.controller');
const marketSyncController = require('./marketSync.controller');
const marketValidation = require('./market.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireMinRole } = require('../../middlewares/authorize.middleware');
const { ROLES } = require('../../models/User');
const { apiLimiter } = require('../../middlewares/security.middleware');

// Apply rate limiting to all routes
router.use(apiLimiter);

// All market routes require authentication
router.use(authenticate);

// Public routes (authenticated users)
router.get('/event/:eventId',
  marketValidation.validateGetMarketsByEvent,
  marketController.handleValidationErrors,
  marketController.getMarketsByEvent
);

router.get('/type/:marketType',
  marketValidation.validateGetMarketsByType,
  marketController.handleValidationErrors,
  marketController.getMarketsByType
);

router.get('/:marketId',
  marketValidation.validateMarketIdParam,
  marketController.handleValidationErrors,
  marketController.getMarketById
);

router.get('/:marketId/stats',
  marketValidation.validateMarketIdParam,
  marketController.handleValidationErrors,
  marketController.getMarketStats
);

// Admin routes - require admin role or higher
router.use(requireMinRole(ROLES.ADMIN));

// Sync markets from API data
router.post('/sync',
  marketSyncController.handleValidationErrors,
  marketSyncController.syncMarkets
);

// Get market sections from API data
router.post('/:marketId/sections',
  marketValidation.validateMarketIdParam,
  marketSyncController.handleValidationErrors,
  marketSyncController.getMarketSections
);

router.post('/',
  marketValidation.validateCreateOrUpdateMarket,
  marketController.handleValidationErrors,
  marketController.createOrUpdateMarket
);

router.post('/:marketId/deactivate',
  marketValidation.validateMarketIdParam,
  marketController.handleValidationErrors,
  marketController.deactivateMarket
);

router.post('/:marketId/activate',
  marketValidation.validateMarketIdParam,
  marketController.handleValidationErrors,
  marketController.activateMarket
);

module.exports = router;
