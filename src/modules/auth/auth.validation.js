const { body } = require('express-validator');
const { ROLES, CURRENCIES } = require('../../models/User');

// Register validation
const validateRegister = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  
  body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  body('mobileNumber')
    .trim()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,10}$/)
    .withMessage('Please provide a valid mobile number'),
  
  body('commission')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Commission must be a number between 0 and 100'),
  
  body('rollingCommission')
    .isFloat({ min: 0, max: 100 })
    .withMessage('Rolling commission must be a number between 0 and 100'),
  
  body('currency')
    .optional()
    .isIn(Object.values(CURRENCIES))
    .withMessage(`Currency must be one of: ${Object.values(CURRENCIES).join(', ')}`),
  
  body('exposureLimit')
    .isNumeric()
    .withMessage('Exposure limit must be a number')
    .custom((value) => {
      const num = parseFloat(value);
      if (num < 0 || num > 9999999999) {
        throw new Error('Exposure limit must be between 0 and 9999999999 (10 digits)');
      }
      if (value.toString().length > 10) {
        throw new Error('Exposure limit cannot exceed 10 digits');
      }
      return true;
    }),
  
  body('role')
    .optional()
    .isIn(Object.values(ROLES))
    .withMessage('Invalid role specified')
];

// Login validation - username can be username, name, or email
const validateLogin = [
  body('username')
    .trim()
    .notEmpty()
    .withMessage('Username (username, name, or email) is required'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

// Change password validation
const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number')
];

// Update profile validation
const validateUpdateProfile = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  
  body('mobileNumber')
    .optional()
    .trim()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,10}$/)
    .withMessage('Please provide a valid mobile number')
];

// Update user validation (admin)
const validateUpdateUser = [
  body('username')
    .optional()
    .trim()
    .isLength({ min: 3, max: 30 })
    .withMessage('Username must be between 3 and 30 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores'),
  
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),
  
  body('email')
    .optional()
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  
  body('mobileNumber')
    .optional()
    .trim()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,10}$/)
    .withMessage('Please provide a valid mobile number'),
  
  body('commission')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Commission must be a number between 0 and 100'),
  
  body('rollingCommission')
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage('Rolling commission must be a number between 0 and 100'),
  
  body('currency')
    .optional()
    .isIn(Object.values(CURRENCIES))
    .withMessage(`Currency must be one of: ${Object.values(CURRENCIES).join(', ')}`),
  
  body('exposureLimit')
    .optional()
    .isNumeric()
    .withMessage('Exposure limit must be a number')
    .custom((value) => {
      const num = parseFloat(value);
      if (num < 0 || num > 9999999999) {
        throw new Error('Exposure limit must be between 0 and 9999999999 (10 digits)');
      }
      if (value.toString().length > 10) {
        throw new Error('Exposure limit cannot exceed 10 digits');
      }
      return true;
    }),
  
  body('role')
    .optional()
    .isIn(Object.values(ROLES))
    .withMessage('Invalid role specified'),
  
  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean')
];

module.exports = {
  validateRegister,
  validateLogin,
  validateChangePassword,
  validateUpdateProfile,
  validateUpdateUser
};
