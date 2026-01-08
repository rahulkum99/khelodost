const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const activityLogController = require('./activityLog.controller');
const authValidation = require('./auth.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { requirePasswordConfirmation } = require('../../middlewares/passwordConfirmation.middleware');
const { authLimiter } = require('../../middlewares/security.middleware');

// Public routes
router.post(
  '/login',
  authLimiter,
  authValidation.validateLogin,
  authController.handleValidationErrors,
  authController.login
);

router.post(
  '/refresh-token',
  authController.refreshAccessToken
);

// Protected routes
router.use(authenticate); // All routes below require authentication

// User creation route - requires authentication and proper role permissions
// Requires password confirmation for security
const { canCreateUserWithRole } = require('../../middlewares/authorize.middleware');
router.post(
  '/register',
  authLimiter,
  canCreateUserWithRole,
  authValidation.validatePasswordConfirmation,
  authController.handleValidationErrors,
  requirePasswordConfirmation,
  authValidation.validateRegister,
  authController.handleValidationErrors,
  authController.register
);

router.post('/logout', authController.logout);
router.get('/profile', authController.getProfile);
router.put(
  '/profile',
  authValidation.validateUpdateProfile,
  authController.handleValidationErrors,
  authController.updateProfile
);
router.put(
  '/change-password',
  authValidation.validateChangePassword,
  authController.handleValidationErrors,
  authController.changePassword
);

// Activity Log routes
router.get('/activity-logs', activityLogController.getActivityLogs);
router.get('/account-statement', activityLogController.getAccountStatement);

module.exports = router;

