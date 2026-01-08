const { User, ROLES, CURRENCIES } = require('../../models/User');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../utils/jwt');
const { createActivityLog } = require('../../services/activityLog.service');
const Wallet = require('../../models/Wallet');

/**
 * Register a new user
 * Note: Users cannot register themselves. They must be created by authorized users.
 */
const register = async (userData, createdBy = null) => {
  const { 
    username,
    name, 
    email, 
    password, 
    mobileNumber,
    commission,
    rollingCommission,
    currency = CURRENCIES.INR,
    exposureLimit,
    role = ROLES.USER 
  } = userData;

  // Check if user already exists
  const orConditions = [{ username }];
  if (email) {
    orConditions.push({ email });
  }
  if (mobileNumber) {
    orConditions.push({ mobileNumber });
  }

  const existingUser = await User.findOne({
    $or: orConditions
  });

  if (existingUser) {
    if (email && existingUser.email === email) {
      throw new Error('Email already registered');
    }
    if (mobileNumber && existingUser.mobileNumber === mobileNumber) {
      throw new Error('Mobile number already registered');
    }
    if (existingUser.username === username) {
      throw new Error('Username already taken');
    }
  }

  // Create user
  const newUserData = {
    username,
    name,
    password,
    commission,
    rollingCommission,
    currency,
    exposureLimit,
    role,
    createdBy: createdBy || null
  };

  // Only include optional fields if provided
  if (email) {
    newUserData.email = email;
  }
  if (mobileNumber) {
    newUserData.mobileNumber = mobileNumber;
  }

  const user = await User.create(newUserData);
  await user.save({ validateBeforeSave: false });

  // Auto-create wallet for the new user
  try {
    await Wallet.getOrCreateWallet(user._id, currency);
  } catch (error) {
    // Log error but don't fail user creation
    console.error('Error creating wallet for user:', error);
  }

  return {
    user: user.toJSON()
  };
};

/**
 * Login user - username can be username, name, or email
 */
const login = async (username, password, req = null) => {
  // Find user by username, email, or name
  const user = await User.findOne({
    $or: [
      { username: username.trim() },
      { email: username.toLowerCase().trim() },
      { name: username.trim() }
    ]
  }).select('+password');

  if (!user) {
    // Log failed login attempt (without user)
    if (req) {
      await createActivityLog(
        null,
        'login_failed',
        req,
        {
          loginStatus: 'failed',
          failureReason: 'User not found',
          metadata: { attemptedUsername: username }
        }
      );
    }
    throw new Error('Invalid username or password');
  }

  // Check if account is locked
  if (user.isLocked()) {
    const lockTime = Math.ceil((user.lockUntil - Date.now()) / 1000 / 60);
    // Log locked account attempt
    if (req) {
      await createActivityLog(
        user,
        'login_failed',
        req,
        {
          loginStatus: 'locked',
          failureReason: 'Account locked'
        }
      );
    }
    throw new Error(`Account locked. Try again in ${lockTime} minutes.`);
  }

  // Verify password
  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    await user.incLoginAttempts();
    // Log failed login attempt
    if (req) {
      await createActivityLog(
        user,
        'login_failed',
        req,
        {
          loginStatus: 'failed',
          failureReason: 'Invalid password'
        }
      );
    }
    throw new Error('Invalid username or password');
  }

  // Reset login attempts
  await user.resetLoginAttempts();

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Log successful login
  if (req) {
    await createActivityLog(
      user,
      'login',
      req,
      {
        loginStatus: 'success'
      }
    );
  }

  // Generate tokens
  const accessToken = generateAccessToken({ userId: user._id, role: user.role });
  const refreshToken = generateRefreshToken({ userId: user._id });

  // Save refresh token
  user.refreshToken = refreshToken;
  user.refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  await user.save({ validateBeforeSave: false });

  return {
    user: user.toJSON(),
    accessToken,
    refreshToken
  };
};

/**
 * Refresh access token
 */
const refreshToken = async (refreshToken) => {
  try {
    const decoded = verifyRefreshToken(refreshToken);

    const user = await User.findById(decoded.userId).select('+refreshToken +refreshTokenExpiry');

    if (!user) {
      throw new Error('User not found');
    }

    if (user.refreshToken !== refreshToken) {
      throw new Error('Invalid refresh token');
    }

    if (user.refreshTokenExpiry < new Date()) {
      throw new Error('Refresh token expired');
    }

    // Generate new tokens
    const newAccessToken = generateAccessToken({ userId: user._id, role: user.role });
    const newRefreshToken = generateRefreshToken({ userId: user._id });

    // Update refresh token
    user.refreshToken = newRefreshToken;
    user.refreshTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await user.save({ validateBeforeSave: false });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken
    };
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
};

/**
 * Logout user
 */
const logout = async (userId, req = null) => {
  await User.findByIdAndUpdate(userId, {
    $unset: { refreshToken: 1, refreshTokenExpiry: 1 }
  });

  // Log logout activity
  if (req) {
    const user = await User.findById(userId);
    if (user) {
      await createActivityLog(
        user,
        'logout',
        req,
        {
          loginStatus: 'success'
        }
      );
    }
  }
};

/**
 * Get current user profile
 */
const getProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }
  return user.toJSON();
};

/**
 * Update user profile
 */
const updateProfile = async (userId, updateData, req = null) => {
  const allowedFields = ['name', 'mobileNumber'];
  const updateFields = {};

  Object.keys(updateData).forEach(key => {
    if (allowedFields.includes(key)) {
      updateFields[key] = updateData[key];
    }
  });

  const user = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true, runValidators: true }
  );

  if (!user) {
    throw new Error('User not found');
  }

  // Log profile update
  if (req) {
    await createActivityLog(
      user,
      'profile_update',
      req,
      {
        loginStatus: 'success',
        metadata: { updatedFields: Object.keys(updateFields) }
      }
    );
  }

  return user.toJSON();
};

/**
 * Change password
 */
const changePassword = async (userId, currentPassword, newPassword, req = null) => {
  const user = await User.findById(userId).select('+password');

  if (!user) {
    throw new Error('User not found');
  }

  const isPasswordValid = await user.comparePassword(currentPassword);

  if (!isPasswordValid) {
    throw new Error('Current password is incorrect');
  }

  user.password = newPassword;
  await user.save();

  // Log password change
  if (req) {
    await createActivityLog(
      user,
      'password_change',
      req,
      {
        loginStatus: 'success'
      }
    );
  }

  return { message: 'Password changed successfully' };
};

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  getProfile,
  updateProfile,
  changePassword
};
