const mongoose = require('mongoose');
const { User, ROLES, ROLE_HIERARCHY } = require('../../models/User');
const Wallet = require('../../models/Wallet');
const authService = require('../auth/auth.service');
const { getLatestCricketData } = require('../../services/cricket.service');
const walletService = require('../wallet/wallet.service');
const { getDescendantUserIds, getUserTotalProfitLoss } = require('../bet/bet.service');

const sortHierarchyNodes = (a, b) => {
  const aLvl = ROLE_HIERARCHY[a.role] || 0;
  const bLvl = ROLE_HIERARCHY[b.role] || 0;
  if (bLvl !== aLvl) return bLvl - aLvl;
  return String(a.username || '').localeCompare(String(b.username || ''), 'en', { sensitivity: 'base' });
};

const buildUserHierarchyTree = ({ users }) => {
  const byId = new Map();
  users.forEach((u) => {
    byId.set(String(u._id), { ...u, children: [] });
  });

  const roots = [];
  byId.forEach((node) => {
    const parentId = node.createdBy ? String(node.createdBy) : null;
    const parent = parentId ? byId.get(parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortDeep = (arr) => {
    arr.sort(sortHierarchyNodes);
    arr.forEach((n) => sortDeep(n.children));
  };
  sortDeep(roots);
  return roots;
};

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

    // Support filtering by multiple roles:
    // - ?role=admin,user (comma separated)
    // - ?role=admin&role=user (repeated params -> array)
    if (role) {
      const roleValues = Array.isArray(role)
        ? role
        : String(role)
            .split(',')
            .map(r => r.trim())
            .filter(Boolean);

      if (roleValues.length === 1) {
        filter.role = roleValues[0];
      } else if (roleValues.length > 1) {
        filter.role = { $in: roleValues };
      }
    }
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Restrict visibility to users added under this admin/agent hierarchy.
    // Includes super admin as well (so they don't necessarily need global access in multi-root setups).
    if (req.user) {
      const descendantUserIds = await getDescendantUserIds(req.userId);
      filter._id = { $in: descendantUserIds };
    }

    const userDocs = await User.find(filter)
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    // Attach wallet balance and exposer (lockedBalance) for each user
    const userIds = userDocs.map(u => u._id);
    const wallets = await Wallet.find({ user: { $in: userIds } });
    const walletMap = new Map(
      wallets.map(w => [w.user.toString(), w])
    );

    const users = userDocs.map(doc => {
      const user = doc.toObject();
      const wallet = walletMap.get(user._id.toString());

      return {
        ...user,
        balance: wallet ? wallet.balance : 0,
        exposer: wallet ? wallet.lockedBalance : 0
      };
    });

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
 * Admin downline user list by adminId.
 * Returns users created under the provided admin (hierarchy descendants), excluding the admin itself.
 */
const getUsersByAdminId = async (req, res) => {
  try {
    const { adminId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { role, isActive, search } = req.query;

    if (!mongoose.Types.ObjectId.isValid(adminId)) {
      return res.status(400).json({ success: false, message: 'Invalid adminId' });
    }

    // Permission: caller can only query admins inside their own hierarchy.
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (req.user.role !== ROLES.SUPER_ADMIN) {
      const allowedAdminRoots = await getDescendantUserIds(req.userId);
      const allowedSet = new Set(allowedAdminRoots.map((oid) => oid.toString()));
      const isSelf = String(req.userId) === String(adminId);
      if (!isSelf && !allowedSet.has(String(adminId))) {
        return res.status(403).json({
          success: false,
          message: 'You can only view users for admins within your hierarchy'
        });
      }
    }

    const descendantUserIds = await getDescendantUserIds(adminId);
    const filter = { _id: { $in: descendantUserIds } };

    // Optional filters (same shape as GET /)
    if (role) {
      const roleValues = Array.isArray(role)
        ? role
        : String(role)
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean);

      if (roleValues.length === 1) filter.role = roleValues[0];
      else if (roleValues.length > 1) filter.role = { $in: roleValues };
    }

    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { username: { $regex: search, $options: 'i' } },
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const userDocs = await User.find(filter)
      .select('-password -refreshToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const userIds = userDocs.map((u) => u._id);
    const wallets = await Wallet.find({ user: { $in: userIds } });
    const walletMap = new Map(wallets.map((w) => [w.user.toString(), w]));

    const users = userDocs.map((doc) => {
      const user = doc.toObject();
      const wallet = walletMap.get(user._id.toString());
      return {
        ...user,
        balance: wallet ? wallet.balance : 0,
        exposer: wallet ? wallet.lockedBalance : 0
      };
    });

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

    // Permission check:
    // - User can always view themselves
    // - Super Admin can view anyone
    // - Other roles can only view users they directly created
    if (req.user) {
      const isSelf = user._id.toString() === req.userId.toString();

      if (!isSelf && req.user.role !== ROLES.SUPER_ADMIN) {
        if (!user.createdBy || user.createdBy.toString() !== req.userId.toString()) {
          return res.status(403).json({
            success: false,
            message: 'You do not have permission to view this user'
          });
        }
      }
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

    const openingBalanceRaw = req.body.openingBalance;
    const openingBalance = openingBalanceRaw !== undefined ? Number(openingBalanceRaw) : 0;

    // If openingBalance is provided and > 0, transfer it from creator's wallet to new user's wallet
    if (openingBalance > 0) {
      try {
        await walletService.transferAmount(
          req.userId,                 // from creator (admin) wallet
          result.user._id,            // to new user's wallet
          openingBalance,
          req.userId,                 // performedBy
          'Opening balance at user creation',
          req
        );
      } catch (walletError) {
        // User is created but opening balance transfer failed (e.g. insufficient balance)
        return res.status(400).json({
          success: false,
          message: walletError.message || 'User created but failed to transfer opening balance from admin wallet',
          data: {
            user: result.user,
          },
        });
      }
    }

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
      'role', 'isActive', 'isAccountLocked', 'isEmailVerified'
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
 * Set user status: active, suspended, or locked.
 * Admin and above; target must be self or in requester's hierarchy.
 */
const setUserStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const targetUser = await User.findById(id).select('_id isActive isAccountLocked createdBy');
    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Permission: Super Admin can set anyone; others only self or users in their hierarchy
    if (req.user.role !== ROLES.SUPER_ADMIN) {
      const isSelf = id === req.userId.toString();
      if (!isSelf) {
        const descendantIds = await getDescendantUserIds(String(req.userId));
        const allowedIds = new Set(descendantIds.map((oid) => oid.toString()));
        if (!allowedIds.has(id)) {
          return res.status(403).json({
            success: false,
            message: 'You can only set status for users in your hierarchy'
          });
        }
      }
    }

    const updates = {};
    switch (status) {
      case 'active':
        updates.isActive = true;
        updates.isAccountLocked = false;
        break;
      case 'suspended':
        updates.isActive = false;
        updates.isAccountLocked = false;
        break;
      case 'locked':
        updates.isAccountLocked = true;
        updates.isActive = false;
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'status must be active, suspended, or locked'
        });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true }
    ).select('-password -refreshToken');

    res.json({
      success: true,
      message: `User status set to ${status}`,
      data: { user }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to set user status'
    });
  }
};

/**
 * Delete user (admin only). Wallet balance must be zero.
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

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Require wallet balance and locked balance (exposure) to be zero before deletion
    const wallet = await Wallet.findOne({ user: id }).select('balance lockedBalance').lean();
    const balance = wallet ? Number(wallet.balance) || 0 : 0;
    const lockedBalance = wallet ? Number(wallet.lockedBalance) || 0 : 0;
    if (balance !== 0 || lockedBalance !== 0) {
      const parts = [];
      if (balance !== 0) parts.push('balance: ' + balance);
      if (lockedBalance !== 0) parts.push('locked balance (exposure): ' + lockedBalance);
      return res.status(400).json({
        success: false,
        message: 'Cannot delete user: wallet balance and locked balance must be zero. Current: ' + parts.join(', ')
      });
    }

    await User.findByIdAndDelete(id);

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

/**
 * Get hierarchical user list under a user.
 * - Without query.userId: returns hierarchy under the authenticated user.
 * - With query.userId: for non-super_admin, target user must be directly created by the authenticated user.
 */
const getUserHierarchy = async (req, res) => {
  try {
    const requesterId = req.userId;
    const requesterRole = req.user?.role;
    const targetUserId = req.query.userId || requesterId;

    // Permission check for non super_admin when requesting another user's hierarchy
    if (String(targetUserId) !== String(requesterId) && requesterRole !== ROLES.SUPER_ADMIN) {
      const targetUser = await User.findById(targetUserId).select('_id createdBy');

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'User not found'
        });
      }

      if (!targetUser.createdBy || String(targetUser.createdBy) !== String(requesterId)) {
        return res.status(403).json({
          success: false,
          message: 'You do not have permission to view this user hierarchy'
        });
      }
    }

    // Get all descendant user ids under the target user
    const descendantIds = await getDescendantUserIds(String(targetUserId));
    const allIds = [targetUserId, ...descendantIds];

    const users = await User.find({ _id: { $in: allIds } })
      .select('_id username name role createdBy isActive isAccountLocked')
      .lean();

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'User not found or no users under this user'
      });
    }

    // Optional filter: return only locked and/or suspended users in hierarchy (flat list)
    const statusFilter = req.query.status;
    const statusList = statusFilter
      ? String(statusFilter).toLowerCase().split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    if (statusList.length > 0) {
      const validStatuses = ['suspended', 'locked'];
      const statuses = statusList.filter((s) => validStatuses.includes(s));
      if (statuses.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'status must be one or more of: suspended, locked'
        });
      }
      // Exclude root; keep only descendants that match status
      const descendantOnly = users.filter((u) => String(u._id) !== String(targetUserId));
      const matchesStatus = (u) => {
        const suspended = !u.isActive && !u.isAccountLocked;
        const locked = !!u.isAccountLocked;
        if (statuses.includes('suspended') && statuses.includes('locked')) {
          return suspended || locked;
        }
        if (statuses.includes('suspended')) return suspended;
        if (statuses.includes('locked')) return locked;
        return false;
      };
      const filtered = descendantOnly.filter(matchesStatus).map((u) => ({
        _id: u._id,
        username: u.username,
        name: u.name,
        role: u.role,
        createdBy: u.createdBy,
        isActive: u.isActive,
        isAccountLocked: u.isAccountLocked,
        status: u.isAccountLocked ? 'locked' : (!u.isActive ? 'suspended' : 'active')
      }));
      return res.json({
        success: true,
        data: filtered,
        meta: {
          rootUserId: String(targetUserId),
          total: filtered.length,
          filter: statuses
        }
      });
    }

    const roots = buildUserHierarchyTree({ users });
    const rootNode =
      roots.find((node) => String(node._id) === String(targetUserId)) || roots[0];

    // If from/to query is provided, compute total profitLoss only for the root user (user level)
    const { from, to, sport } = req.query;
    let rootProfitLoss = null;
    if (from || to || sport) {
      try {
        const pl = await getUserTotalProfitLoss(targetUserId, { from, to, sport });
        rootProfitLoss = pl.profitLoss;
      } catch (e) {
        // If PL calculation fails, still return hierarchy without breaking
      }
    }

    // Do not include the root user itself inside the main data list,
    // return only users under this user hierarchically.
    res.json({
      success: true,
      data: rootNode.children || [],
      meta: {
        rootUserId: String(targetUserId),
        rootProfitLoss
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch user hierarchy'
    });
  }
};

/**
 * Update exposure limit for self or a user in hierarchy (Agent+). Super Admin: any user.
 */
const updateUserExposure = async (req, res) => {
  try {
    const { id } = req.params;
    const { exposureLimit } = req.body;

    if (req.user.role !== ROLES.SUPER_ADMIN) {
      const isSelf = id === req.userId.toString();
      if (!isSelf) {
        const descendantIds = await getDescendantUserIds(String(req.userId));
        const allowed = new Set(descendantIds.map((oid) => oid.toString()));
        if (!allowed.has(id)) {
          return res.status(403).json({
            success: false,
            message: 'You can only set exposure for yourself or users in your hierarchy'
          });
        }
      }
    }

    const user = await User.findByIdAndUpdate(
      id,
      { $set: { exposureLimit: Number(exposureLimit) } },
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
      message: 'Exposure limit updated',
      data: { user }
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to update exposure limit'
    });
  }
};

/**
 * Change password for a hierarchy user (not self). Reuses auth admin password flow + logging.
 */
const changeHierarchyUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (id === req.userId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'To change your own password, use PUT /api/auth/change-password with your current password'
      });
    }

    if (req.user.role !== ROLES.SUPER_ADMIN) {
      const descendantIds = await getDescendantUserIds(String(req.userId));
      const allowed = new Set(descendantIds.map((oid) => oid.toString()));
      if (!allowed.has(id)) {
        return res.status(403).json({
          success: false,
          message: 'You can only change passwords for users in your hierarchy'
        });
      }
    }

    const result = await authService.adminChangePassword(id, newPassword, req.userId, req);
    res.json({
      success: true,
      message: result.message,
      data: result.user
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Failed to change password'
    });
  }
};

module.exports = {
  getCricketMatches,
  getAllUsers,
  getUsersByAdminId,
  getUserById,
  createUser,
  updateUser,
  setUserStatus,
  deleteUser,
  getUserStats,
  getUserHierarchy,
  updateUserExposure,
  changeHierarchyUserPassword
};
