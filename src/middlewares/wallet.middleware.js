const { User, ROLE_HIERARCHY } = require('../models/User');

/**
 * Middleware to check if user can manage wallet of target user
 * - Upper-level admins can manage lower-level users
 * - Admin can only manage wallets of users they created
 * - Super Admin can manage anyone
 */
const canManageWallet = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.'
    });
  }

  const targetUserId = req.params.userId || req.body.userId;
  
  // If no target user ID, allow (for own wallet operations)
  if (!targetUserId) {
    return next();
  }

  // If accessing own wallet, allow
  if (targetUserId.toString() === req.userId.toString()) {
    return next();
  }

  // For other users, check permissions asynchronously
  User.findById(targetUserId)
    .then(targetUser => {
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Target user not found'
        });
      }

      const performerRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
      const targetRoleLevel = ROLE_HIERARCHY[targetUser.role] || 0;

      // Super Admin can manage anyone
      if (req.user.role === 'super_admin') {
        return next();
      }

      // Check if performer has higher role
      if (performerRoleLevel <= targetRoleLevel) {
        return res.status(403).json({
          success: false,
          message: 'You can only manage wallets of users with lower role level'
        });
      }

      // Check if admin can only manage wallets of users they created
      if (targetUser.createdBy && targetUser.createdBy.toString() !== req.userId.toString()) {
        return res.status(403).json({
          success: false,
          message: 'You can only manage wallets of users you created'
        });
      }

      next();
    })
    .catch(error => {
      res.status(500).json({
        success: false,
        message: 'Error checking permissions'
      });
    });
};

module.exports = {
  canManageWallet
};

