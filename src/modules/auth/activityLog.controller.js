const activityLogService = require('../../services/activityLog.service');

/**
 * Get activity logs for current user
 */
const getActivityLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      activityType,
      loginStatus,
      startDate,
      endDate,
      ipAddress
    } = req.query;

    const result = await activityLogService.getUserActivityLogs(req.userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      activityType,
      loginStatus,
      startDate,
      endDate,
      ipAddress
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch activity logs'
    });
  }
};

/**
 * Get activity logs for a specific user (user-wise)
 * - Normal users can only see their own logs
 * - Higher role users can see logs of users below them
 */
const getUserActivityLogsForAdmin = async (req, res) => {
  try {
    const { User, ROLE_HIERARCHY, ROLES } = require('../../models/User');

    const {
      page = 1,
      limit = 20,
      activityType,
      loginStatus,
      startDate,
      endDate,
      ipAddress,
      userId: requestedUserId
    } = req.query;

    let targetUserId = req.userId; // default to current user

    // If a different userId is requested, enforce role hierarchy checks
    if (requestedUserId && requestedUserId !== String(req.userId)) {
      const targetUser = await User.findById(requestedUserId);

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      const adminRoleLevel = ROLE_HIERARCHY[req.user.role] || 0;
      const targetRoleLevel = ROLE_HIERARCHY[targetUser.role] || 0;

      // Super admin can view anyone's activity logs
      if (req.user.role !== ROLES.SUPER_ADMIN && adminRoleLevel <= targetRoleLevel) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view activity logs for this user.'
        });
      }

      targetUserId = requestedUserId;
    }

    const result = await activityLogService.getUserActivityLogs(targetUserId, {
      page: parseInt(page),
      limit: parseInt(limit),
      activityType,
      loginStatus,
      startDate,
      endDate,
      ipAddress
    });

    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch user activity logs'
    });
  }
};

/**
 * Get account statement (summary)
 */
const getAccountStatement = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const statement = await activityLogService.getAccountStatement(req.userId, {
      startDate,
      endDate
    });

    res.json({
      success: true,
      data: statement
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch account statement'
    });
  }
};

module.exports = {
  getActivityLogs,
  getUserActivityLogsForAdmin,
  getAccountStatement
};

