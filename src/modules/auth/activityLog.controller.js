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
  getAccountStatement
};

