const express = require('express');
const router = express.Router();
const walletController = require('./wallet.controller');
const walletValidation = require('./wallet.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireMinRole } = require('../../middlewares/authorize.middleware');
const { canManageWallet } = require('../../middlewares/wallet.middleware');
const { ROLES } = require('../../models/User');
const { apiLimiter } = require('../../middlewares/security.middleware');

// Apply rate limiting to all routes
router.use(apiLimiter);

// All wallet routes require authentication
router.use(authenticate);

// User's own wallet routes
router.get('/me', walletController.getMyWallet);
router.get('/me/balance', walletController.getMyBalance);
router.get('/me/transactions', 
  walletValidation.validateGetTransactions,
  walletController.handleValidationErrors,
  walletController.getTransactions
);
router.get('/me/stats', walletController.getWalletStats);

// Transfer route - available to all authenticated users
router.post('/transfer',
  walletValidation.validateTransferAmount,
  walletController.handleValidationErrors,
  walletController.transferAmount
);

// Admin routes - require admin role or higher
router.use(requireMinRole(ROLES.ADMIN));

// Add amount to wallet - ONLY Super Admin
router.post('/add',
  walletValidation.validateAddAmount,
  walletController.handleValidationErrors,
  requireMinRole(ROLES.SUPER_ADMIN),
  canManageWallet,
  walletController.addAmount
);

// Deduct amount from wallet
router.post('/deduct',
  walletValidation.validateDeductAmount,
  walletController.handleValidationErrors,
  canManageWallet,
  walletController.deductAmount
);

// Lock wallet
router.post('/lock',
  walletValidation.validateLockWallet,
  walletController.handleValidationErrors,
  canManageWallet,
  walletController.lockWallet
);

// Unlock wallet
router.post('/unlock',
  walletValidation.validateUnlockWallet,
  walletController.handleValidationErrors,
  canManageWallet,
  walletController.unlockWallet
);

// Get wallet for specific user
router.get('/:userId',
  walletValidation.validateUserIdParam,
  walletController.handleValidationErrors,
  canManageWallet,
  walletController.getWallet
);

// Get transactions for specific user
router.get('/:userId/transactions',
  walletValidation.validateUserIdParam,
  walletValidation.validateGetTransactions,
  walletController.handleValidationErrors,
  canManageWallet,
  walletController.getTransactions
);

// Get wallet statistics for specific user
router.get('/:userId/stats',
  walletValidation.validateUserIdParam,
  walletController.handleValidationErrors,
  canManageWallet,
  walletController.getWalletStats
);

module.exports = router;

