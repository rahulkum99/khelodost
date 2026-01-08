const { User } = require('../models/User');

/**
 * Middleware to require password confirmation for sensitive operations
 * This adds an extra layer of security by requiring admins to re-enter their password
 * before performing sensitive operations like creating, updating, or deleting users.
 */
const requirePasswordConfirmation = async (req, res, next) => {
  try {
    // Check if adminPassword (admin's password for confirmation) is provided
    // Use adminPassword to avoid conflict with new user's password field
    const adminPassword = req.body?.adminPassword || req.query?.adminPassword;

    if (!adminPassword) {
      return res.status(400).json({
        success: false,
        message: 'Admin password confirmation is required for this operation. Please provide your password in the "adminPassword" field.'
      });
    }

    // Get the authenticated user
    if (!req.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    // Fetch user with password field (normally excluded)
    const user = await User.findById(req.userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify the provided password matches the admin's password
    const isPasswordValid = await user.comparePassword(adminPassword);

    if (!isPasswordValid) {
      return res.status(403).json({
        success: false,
        message: 'Invalid admin password. Password confirmation failed.'
      });
    }

    // Password is valid, proceed to next middleware
    // Remove adminPassword from request body and query to prevent it from being saved/logged
    if (req.body) delete req.body.adminPassword;
    if (req.query) delete req.query.adminPassword;
    
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error verifying password confirmation',
      error: error.message
    });
  }
};

module.exports = { requirePasswordConfirmation };
