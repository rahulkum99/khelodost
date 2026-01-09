const { User, ROLES } = require('../../models/User');
const authService = require('../auth/auth.service');
const { getLatestCricketData } = require('../../services/cricket.service');
const walletService = require('../wallet/wallet.service');

/**
 * Get cricket matches (public route)
 */
const getCricketMatches = (req, res) => {
  try {
    const data = getLatestCricketData();
    res.json({
      success: true,
      data: data || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch cricket matches'
    });
  }
};

/**
 * Get all users (with pagination and filters)
 */
const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { role, isActive, search } = req.query;

    // Build filter
    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(filter)
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await User.countDocuments(filter);

    res.json({
      success: true,
      data: {
        users,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch users'
    });
  }
};

/**
 * Get user by ID
 */
const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Get wallet balance for the user
    let wallet = null;
    try {
      wallet = await walletService.getBalance(req.params.id);
    } catch (error) {
      // Wallet might not exist yet, set default values
      wallet = {
        balance: 0,
        currency: user.currency || 'INR',
        isActive: true,
        isLocked: false
      };
    }

    res.json({
      success: true,
      data: { 
        user,
        wallet
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch user'
    });
  }
};

/**
 * Create new user (admin only)
 */
const createUser = async (req, res) => {
  try {
    const result = await authService.register(req.body, req.userId);

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: result
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to create user'
    });
  }
};

/**
 * Update user (admin only)
 */
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Don't allow password update through this route
    delete updateData.password;
    delete updateData.refreshToken;
    delete updateData.refreshTokenExpiry;

    // Allowed fields for update
    const allowedFields = [
      'username', 'name', 'email', 'mobileNumber', 'commission', 
      'rollingCommission', 'agentRollingCommission', 'currency', 'exposureLimit', 
      'role', 'isActive', 'isEmailVerified'
    ];
    
    const filteredData = {};
    Object.keys(updateData).forEach(key => {
      if (allowedFields.includes(key)) {
        filteredData[key] = updateData[key];
      }
    });

    const user = await User.findByIdAndUpdate(
      id,
      { $set: filteredData },
      { new: true, runValidators: true }
    ).select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update user'
    });
  }
};

/**
 * Delete user (admin only)
 */
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (id === req.userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to delete user'
    });
  }
};

/**
 * Get user statistics
 */
const getUserStats = async (req, res) => {
  try {
    const stats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    const totalUsers = await User.countDocuments();
    const activeUsers = await User.countDocuments({ isActive: true });

    res.json({
      success: true,
      data: {
        total: totalUsers,
        active: activeUsers,
        byRole: stats.reduce((acc, stat) => {
          acc[stat._id] = stat.count;
          return acc;
        }, {})
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch statistics'
    });
  }
};

module.exports = {
  getCricketMatches,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getUserStats
};
