const { ROLES, ROLE_HIERARCHY } = require('../models/User');

/**
 * Authorization middleware - checks if user has required role
 * @param {...string} roles - Roles that can access the route
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    const userRole = req.user.role;
    const userRoleLevel = ROLE_HIERARCHY[userRole] || 0;

    // Check if user has one of the required roles
    const hasAccess = roles.some(role => {
      const requiredRoleLevel = ROLE_HIERARCHY[role] || 0;
      return userRoleLevel >= requiredRoleLevel;
    });

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required role: ${roles.join(' or ')}. Your role: ${userRole}.`
      });
    }

    next();
  };
};

/**
 * Check if user has minimum role level
 * @param {string} minRole - Minimum role required
 */
const requireMinRole = (minRole) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required.'
      });
    }

    const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
    const minRoleLevel = ROLE_HIERARCHY[minRole] || 0;

    if (userRoleLevel < minRoleLevel) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Minimum role required: ${minRole}. Your role: ${req.user.role}.`
      });
    }

    next();
  };
};

/**
 * Check if user can manage another user (higher role or same user)
 */
const canManageUser = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.'
    });
  }

  const targetUserId = req.params.userId || req.body.userId;
  const userRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
  const targetUserRoleLevel = req.targetUser ? ROLE_HIERARCHY[req.targetUser.role] || 0 : 0;

  // Super admin can manage anyone
  if (req.user.role === ROLES.SUPER_ADMIN) {
    return next();
  }

  // User can manage themselves
  if (targetUserId && targetUserId.toString() === req.user._id.toString()) {
    return next();
  }

  // User must have higher role than target
  if (userRoleLevel > targetUserRoleLevel) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'You do not have permission to manage this user.'
  });
};

module.exports = {
  authorize,
  requireMinRole,
  canManageUser
};

