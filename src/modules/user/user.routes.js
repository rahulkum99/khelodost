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

// User management routes
// - List/get users: available to Agent and above (scoped to users they created)
// - Stats/update/delete: restricted to Admin and above
router.get('/', requireMinRole(ROLES.AGENT), userController.getAllUsers);
router.get('/hierarchy', requireMinRole(ROLES.AGENT), userController.getUserHierarchy);
router.get('/stats', requireMinRole(ROLES.ADMIN), userController.getUserStats);
router.get('/:id', requireMinRole(ROLES.AGENT), userController.getUserById);

// Update user - requires admin role and password confirmation
router.put(
  '/:id',
  requireMinRole(ROLES.ADMIN),
  validatePasswordConfirmation,
  handleValidationErrors,
  requirePasswordConfirmation,
  validateUpdateUser,
  handleValidationErrors,
  userController.updateUser
);

// Delete user - requires admin role and password confirmation
router.delete(
  '/:id',
  requireMinRole(ROLES.ADMIN),
  validatePasswordConfirmation,
  handleValidationErrors,
  requirePasswordConfirmation,
  userController.deleteUser
);

module.exports = router;
