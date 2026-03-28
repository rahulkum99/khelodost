const { body, param, query } = require('express-validator');

/**
 * Validation for adding amount to wallet (Super Admin only; adds to own wallet)
 */
const validateAddAmount = [
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 0.01, max: 9999999999 })
    .withMessage('Amount must be between 0.01 and 9999999999'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

/**
 * Validation for deducting amount from wallet
 */
const validateDeductAmount = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID format'),
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 0.01, max: 9999999999 })
    .withMessage('Amount must be between 0.01 and 9999999999'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

/**
 * Validation for getting transactions
 * Query: page, limit, optional fromDate, toDate, action (deposit|withdrawal), transactionType, status
 */
const validateGetTransactions = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('fromDate')
    .optional()
    .isISO8601()
    .withMessage('fromDate must be a valid ISO 8601 date'),
  query('toDate')
    .optional()
    .isISO8601()
    .withMessage('toDate must be a valid ISO 8601 date'),
  query('action')
    .optional()
    .isIn(['deposit', 'withdrawal'])
    .withMessage('action must be "deposit" or "withdrawal"'),
  query('transactionType')
    .optional()
    .isIn(['credit', 'debit', 'transfer', 'refund', 'commission', 'adjustment'])
    .withMessage('Invalid transaction type'),
  query('status')
    .optional()
    .isIn(['pending', 'completed', 'failed', 'cancelled'])
    .withMessage('Invalid transaction status'),
  query('startDate')
    .optional()
    .isISO8601()
    .withMessage('Start date must be a valid ISO 8601 date'),
  query('endDate')
    .optional()
    .isISO8601()
    .withMessage('End date must be a valid ISO 8601 date')
];

/**
 * Validation for locking/unlocking wallet
 */
const validateLockWallet = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID format'),
  body('reason')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Reason cannot exceed 200 characters')
];

const validateUnlockWallet = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID format')
];

/**
 * Validation for transferring amount between wallets
 */
const validateTransferAmount = [
  body('fromUserId')
    .notEmpty()
    .withMessage('Sender user ID is required')
    .isMongoId()
    .withMessage('Invalid sender user ID format'),
  body('toUserId')
    .notEmpty()
    .withMessage('Receiver user ID is required')
    .isMongoId()
    .withMessage('Invalid receiver user ID format'),
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 0.01, max: 9999999999 })
    .withMessage('Amount must be between 0.01 and 9999999999'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

/**
 * Validation for user ID parameter
 */
const validateUserIdParam = [
  param('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID format')
];

/**
 * Validation for hierarchical deposit (userId, amount, description)
 */
const validateHierarchyDeposit = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID format'),
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 0.01, max: 9999999999 })
    .withMessage('Amount must be between 0.01 and 9999999999'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

/**
 * Validation for hierarchical withdraw (userId, amount, description)
 */
const validateHierarchyWithdraw = [
  body('userId')
    .notEmpty()
    .withMessage('User ID is required')
    .isMongoId()
    .withMessage('Invalid user ID format'),
  body('amount')
    .notEmpty()
    .withMessage('Amount is required')
    .isFloat({ min: 0.01, max: 9999999999 })
    .withMessage('Amount must be between 0.01 and 9999999999'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

/**
 * Validation for bulk deposit + withdraw in one request
 * Body: { adminPassword, entries: [ { userId, amount, action: 'deposit'|'withdraw', description? } ] }
 */
const validateBulkAction = [
  body('adminPassword')
    .notEmpty()
    .withMessage('Admin password is required for bulk action'),
  body('entries')
    .isArray({ min: 1, max: 100 })
    .withMessage('entries must be a non-empty array (max 100 items)'),
  body('entries.*.userId')
    .notEmpty()
    .withMessage('userId is required in each entry')
    .isMongoId()
    .withMessage('Invalid userId in entry'),
  body('entries.*.amount')
    .notEmpty()
    .withMessage('amount is required in each entry')
    .isFloat({ min: 0.01, max: 9999999999 })
    .withMessage('amount must be between 0.01 and 9999999999'),
  body('entries.*.action')
    .notEmpty()
    .withMessage('action is required in each entry')
    .isIn(['deposit', 'withdraw'])
    .withMessage('action must be "deposit" or "withdraw"'),
  body('entries.*.description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot exceed 500 characters')
];

module.exports = {
  validateAddAmount,
  validateDeductAmount,
  validateTransferAmount,
  validateGetTransactions,
  validateLockWallet,
  validateUnlockWallet,
  validateUserIdParam,
  validateBulkAction,
  validateHierarchyDeposit,
  validateHierarchyWithdraw
};

