const express = require('express');
const router = express.Router();
const authController = require('./auth.controller');
const authValidation = require('./auth.validation');
const { authenticate } = require('../../middlewares/auth.middleware');
const { authLimiter } = require('../../middlewares/security.middleware');

// Public routes
router.post(
  '/register',
  authLimiter,
  authValidation.validateRegister,
  authController.handleValidationErrors,
  authController.register
);

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

module.exports = router;

