const authService = require('./auth.service');
const { validationResult } = require('express-validator');

/**
 * Handle validation errors
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

/**
 * Register new user (requires authentication and proper role permissions)
 * Users cannot register themselves - they must be created by authorized users
 */
const register = async (req, res, next) => {
  try {
    // Ensure user is authenticated (middleware should handle this, but double-check)
    if (!req.user || !req.userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required. Users cannot register themselves.'
      });
    }

    const createdBy = req.userId;
    const result = await authService.register(req.body, createdBy);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'User creation failed'
    });
  }
};

/**
 * Login user
 */
const login = async (req, res, next) => {
  try {
    const { username, password } = req.body;
    const result = await authService.login(username, password, req);

    // Set refresh token in HTTP-only cookie (optional, more secure)
    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    });

    res.json({
      success: true,
      message: 'Login successful',
      data: result
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.message || 'Login failed'
    });
  }
};

/**
 * Refresh access token
 */
const refreshAccessToken = async (req, res, next) => {
  try {
    const refreshToken = req.body.refreshToken || req.cookies.refreshToken;

    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    const result = await authService.refreshToken(refreshToken);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
      data: result
    });
  } catch (error) {
    res.status(401).json({
      success: false,
      message: error.message || 'Token refresh failed'
    });
  }
};

/**
 * Logout user
 */
const logout = async (req, res, next) => {
  try {
    await authService.logout(req.userId, req);

    // Clear refresh token cookie
    res.clearCookie('refreshToken');

    res.json({
      success: true,
      message: 'Logout successful'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Logout failed'
    });
  }
};

/**
 * Get current user profile
 */
const getProfile = async (req, res, next) => {
  try {
    const user = await authService.getProfile(req.userId);

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      message: error.message || 'User not found'
    });
  }
};

/**
 * Update user profile
 */
const updateProfile = async (req, res, next) => {
  try {
    const user = await authService.updateProfile(req.userId, req.body, req);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: { user }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Profile update failed'
    });
  }
};

/**
 * Change password (self)
 */
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    await authService.changePassword(req.userId, currentPassword, newPassword, req);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Password change failed'
    });
  }
};

/**
 * Admin change password for user below them
 */
const adminChangePassword = async (req, res, next) => {
  try {
    const { userId, newPassword } = req.body;
    const result = await authService.adminChangePassword(userId, newPassword, req.userId, req);

    res.json({
      success: true,
      message: result.message,
      data: result.user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Password change failed'
    });
  }
};

/**
 * Get password change history
 * Users can view their own history, admins can view history of users below them
 */
const getPasswordChangeHistory = async (req, res, next) => {
  try {
    const targetUserId = req.query.userId || req.userId;
    
    // If requesting another user's history, check permissions
    if (targetUserId !== req.userId.toString()) {
      const { User, ROLE_HIERARCHY, ROLES } = require('../../models/User');
      const targetUser = await User.findById(targetUserId);
      
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const adminRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
      const targetRoleLevel = ROLE_HIERARCHY[targetUser.role] || 0;

      // Super admin can view anyone's history
      if (req.user.role !== ROLES.SUPER_ADMIN && adminRoleLevel <= targetRoleLevel) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view password change history for this user.'
        });
      }
    }

    const result = await authService.getPasswordChangeHistory(targetUserId, req.query);

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to fetch password change history'
    });
  }
};

module.exports = {
  register,
  login,
  refreshAccessToken,
  logout,
  getProfile,
  updateProfile,
  changePassword,
  adminChangePassword,
  getPasswordChangeHistory,
  handleValidationErrors
};

