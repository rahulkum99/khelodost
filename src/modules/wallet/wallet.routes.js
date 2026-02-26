const express = require('express');
const router = express.Router();
const walletController = require('./wallet.controller');
const walletValidation = require('./wallet.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requireMinRole } = require('../../middlewares/authorize.middleware');
const { canManageWallet } = require('../../middlewares/wallet.middleware');
const { requirePasswordConfirmation } = require('../../middlewares/passwordConfirmation.middleware');
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

// Banking & bulk admin routes
// - Banking lists: available to Agent and above (scoped in service to users/admins they created)
// - Bulk deposit/withdraw: requires Agent role and password confirmation
// Banking lists (username, balance, exposer)
router.get('/banking/users', requireMinRole(ROLES.AGENT), walletController.getBankingUsers);
router.get('/banking/admins', requireMinRole(ROLES.AGENT), walletController.getBankingAdmins);

// Bulk deposit and withdraw in one request - require admin role + admin password
router.post('/bulk/action',
  requireMinRole(ROLES.AGENT),
  walletValidation.validateBulkAction,
  walletController.handleValidationErrors,
  requirePasswordConfirmation,
  walletController.bulkDepositAndWithdraw
);

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

