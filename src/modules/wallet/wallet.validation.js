const { body, param, query } = require('express-validator');

/**
 * Validation for adding amount to wallet
 */
const validateAddAmount = [
  // body('userId')
  //   .notEmpty()
  //   .withMessage('User ID is required')
  //   .isMongoId()
  //   .withMessage('Invalid user ID format'),
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

module.exports = {
  validateAddAmount,
  validateDeductAmount,
  validateTransferAmount,
  validateGetTransactions,
  validateLockWallet,
  validateUnlockWallet,
  validateUserIdParam
};

