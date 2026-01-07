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

/**
 * Check if user can create another user with a specific role
 * Hierarchy:
 * - Super Admin (Level 6) can create: Admin, Super Master, Master, Agent, User
 * - Admin (Level 5) can create: Super Master, Master, Agent, User
 * - Master (Level 3) can create: Agent, User
 * - Agent (Level 2) can create: User
 * - User (Level 1) cannot create anyone
 */
const canCreateUserWithRole = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.'
    });
  }

  const creatorRole = req.user.role;
  const creatorRoleLevel = ROLE_HIERARCHY[creatorRole] || 0;
  
  // Get the role to be created from request body
  const targetRole = req.body.role || ROLES.USER;
  const targetRoleLevel = ROLE_HIERARCHY[targetRole] || 0;

  // Define which roles each level can create
  const allowedRolesToCreate = {
    [ROLES.SUPER_ADMIN]: [ROLES.ADMIN, ROLES.SUPER_MASTER, ROLES.MASTER, ROLES.AGENT, ROLES.USER],
    [ROLES.ADMIN]: [ROLES.SUPER_MASTER, ROLES.MASTER, ROLES.AGENT, ROLES.USER],
    [ROLES.SUPER_MASTER]: [ROLES.MASTER, ROLES.AGENT, ROLES.USER],
    [ROLES.MASTER]: [ROLES.AGENT, ROLES.USER],
    [ROLES.AGENT]: [ROLES.USER],
    [ROLES.USER]: [],
  };

  const allowedRoles = allowedRolesToCreate[creatorRole] || [];

  if (!allowedRoles.includes(targetRole)) {
    return res.status(403).json({
      success: false,
      message: `You do not have permission to create a user with role '${targetRole}'. Your role '${creatorRole}' can only create: ${allowedRoles.join(', ') || 'none'}.`
    });
  }

  // Additional check: creator must have higher role level than target
  if (creatorRoleLevel <= targetRoleLevel) {
    return res.status(403).json({
      success: false,
      message: `You cannot create a user with role '${targetRole}' as it is equal to or higher than your role '${creatorRole}'.`
    });
  }

  next();
};

module.exports = {
  authorize,
  requireMinRole,
  canManageUser,
  canCreateUserWithRole
};

