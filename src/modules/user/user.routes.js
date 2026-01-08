const express = require('express');
const router = express.Router();
const userController = require('./user.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { authorize, requireMinRole, canCreateUserWithRole } = require('../../middlewares/authorize.middleware');
const { requirePasswordConfirmation } = require('../../middlewares/passwordConfirmation.middleware');
const { ROLES } = require('../../models/User');
const { apiLimiter } = require('../../middlewares/security.middleware');
const { validateUpdateUser, validatePasswordConfirmation } = require('../auth/auth.validation');
const { handleValidationErrors } = require('../auth/auth.controller');

// Apply rate limiting to all routes
router.use(apiLimiter);

// Public route - get cricket matches (existing)
router.get('/cricket', userController.getCricketMatches);

// Protected routes - require authentication
router.use(authenticate);

// User can access their own profile
router.get('/me', (req, res) => {
  req.params.id = req.userId;
  userController.getUserById(req, res);
});

// User creation route - available to all authenticated users (permissions checked by middleware)
// Requires password confirmation for security
router.post(
  '/', 
  canCreateUserWithRole, 
  validatePasswordConfirmation,
  handleValidationErrors,
  requirePasswordConfirmation,
  validateUpdateUser, 
  handleValidationErrors, 
  userController.createUser
);

// Admin routes - require admin role or higher for viewing/managing all users
router.use(requireMinRole(ROLES.ADMIN));

router.get('/', userController.getAllUsers);
router.get('/stats', userController.getUserStats);
router.get('/:id', userController.getUserById);

// Update user - requires password confirmation
router.put(
  '/:id', 
  validatePasswordConfirmation,
  handleValidationErrors,
  requirePasswordConfirmation,
  validateUpdateUser, 
  handleValidationErrors, 
  userController.updateUser
);

// Delete user - requires password confirmation
router.delete(
  '/:id', 
  validatePasswordConfirmation,
  handleValidationErrors,
  requirePasswordConfirmation,
  userController.deleteUser
);

module.exports = router;
