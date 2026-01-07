const express = require('express');
const router = express.Router();
const userController = require('./user.controller');
const { authenticate } = require('../../middlewares/auth.middleware');
const { authorize, requireMinRole, canCreateUserWithRole } = require('../../middlewares/authorize.middleware');
const { ROLES } = require('../../models/User');
const { apiLimiter } = require('../../middlewares/security.middleware');
const { validateUpdateUser } = require('../auth/auth.validation');
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
router.post('/', canCreateUserWithRole, validateUpdateUser, handleValidationErrors, userController.createUser);

// Admin routes - require admin role or higher for viewing/managing all users
router.use(requireMinRole(ROLES.ADMIN));

router.get('/', userController.getAllUsers);
router.get('/stats', userController.getUserStats);
router.get('/:id', userController.getUserById);
router.put('/:id', validateUpdateUser, handleValidationErrors, userController.updateUser);
router.delete('/:id', userController.deleteUser);

module.exports = router;
