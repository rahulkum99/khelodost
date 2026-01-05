const ActivityLog = require('../models/ActivityLog');
const { getIpLocation, getClientIp, parseUserAgent } = require('../utils/ipLocation');

/**
 * Create activity log entry
 */
const createActivityLog = async (user, activityType, req, options = {}) => {
  try {
    // Skip if no user and it's not a failed login attempt
    if (!user && activityType !== 'login_failed') {
      return null;
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || '';
    const { device, browser, os } = parseUserAgent(userAgent);

    // Get location info (async, don't wait if slow)
    let locationInfo = {
      isp: 'Unknown',
      city: 'Unknown',
      state: 'Unknown',
      country: 'Unknown'
    };

    // Try to get location, but don't block if it fails
    try {
      locationInfo = await Promise.race([
        getIpLocation(ipAddress),
        new Promise((resolve) => setTimeout(() => resolve(locationInfo), 2000)) // 2 second timeout
      ]);
    } catch (error) {
      console.error('Error getting location:', error.message);
    }

    const activityData = {
      user: user && (user._id || user) ? (user._id || user) : null,
      activityType,
      loginStatus: options.loginStatus || 'success',
      ipAddress,
      isp: locationInfo.isp,
      city: locationInfo.city,
      state: locationInfo.state,
      country: locationInfo.country,
      userAgent,
      device,
      browser,
      os,
      failureReason: options.failureReason || null,
      metadata: options.metadata || {}
    };

    // Only create log if user exists or it's a failed login
    if (activityData.user || activityType === 'login_failed') {
      const activityLog = await ActivityLog.create(activityData);
      return activityLog;
    }

    return null;
  } catch (error) {
    console.error('Error creating activity log:', error.message);
    // Don't throw error, just log it
    return null;
  }
};

/**
 * Get activity logs for a user
 */
const getUserActivityLogs = async (userId, options = {}) => {
  const {
    page = 1,
    limit = 20,
    activityType,
    loginStatus,
    startDate,
    endDate,
    ipAddress
  } = options;

  const skip = (page - 1) * limit;
  const filter = { user: userId };

  if (activityType) {
    filter.activityType = activityType;
  }

  if (loginStatus) {
    filter.loginStatus = loginStatus;
  }

  if (ipAddress) {
    filter.ipAddress = { $regex: ipAddress, $options: 'i' };
  }

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) {
      filter.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      filter.createdAt.$lte = new Date(endDate);
    }
  }

  const logs = await ActivityLog.find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .populate('user', 'username name email');

  const total = await ActivityLog.countDocuments(filter);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
};

/**
 * Get account statement (summary of activities)
 */
const getAccountStatement = async (userId, options = {}) => {
  const {
    startDate,
    endDate
  } = options;

  const filter = { user: userId };

  if (startDate || endDate) {
    filter.createdAt = {};
    if (startDate) {
      filter.createdAt.$gte = new Date(startDate);
    }
    if (endDate) {
      filter.createdAt.$lte = new Date(endDate);
    }
  }

  // Get summary statistics
  const stats = await ActivityLog.aggregate([
    { $match: filter },
    {
      $group: {
        _id: '$activityType',
        count: { $sum: 1 },
        lastActivity: { $max: '$createdAt' }
      }
    }
  ]);

  // Get login statistics
  const loginStats = await ActivityLog.aggregate([
    {
      $match: {
        ...filter,
        activityType: 'login'
      }
    },
    {
      $group: {
        _id: '$loginStatus',
        count: { $sum: 1 }
      }
    }
  ]);

  // Get unique IPs
  const uniqueIPs = await ActivityLog.distinct('ipAddress', filter);

  // Get unique locations
  const uniqueLocations = await ActivityLog.aggregate([
    { $match: filter },
    {
      $group: {
        _id: {
          city: '$city',
          state: '$state',
          country: '$country'
        },
        count: { $sum: 1 }
      }
    }
  ]);

  // Get recent activities
  const recentActivities = await ActivityLog.find(filter)
    .sort({ createdAt: -1 })
    .limit(10)
    .select('activityType loginStatus createdAt ipAddress city country');

  return {
    summary: {
      totalActivities: stats.reduce((sum, stat) => sum + stat.count, 0),
      byType: stats,
      loginStats: loginStats.reduce((acc, stat) => {
        acc[stat._id] = stat.count;
        return acc;
      }, {}),
      uniqueIPs: uniqueIPs.length,
      uniqueLocations: uniqueLocations.length
    },
    recentActivities
  };
};

module.exports = {
  createActivityLog,
  getUserActivityLogs,
  getAccountStatement
};

