const { User, ROLES, CURRENCIES } = require('../../models/User');
const { generateAccessToken, generateRefreshToken, verifyRefreshToken } = require('../../utils/jwt');

/**
 * Register a new user
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
  const existingUser = await User.findOne({
    $or: [{ email }, { mobileNumber }, { username }]
  });

  if (existingUser) {
    if (existingUser.email === email) {
      throw new Error('Email already registered');
    }
    if (existingUser.mobileNumber === mobileNumber) {
      throw new Error('Mobile number already registered');
    }
    if (existingUser.username === username) {
      throw new Error('Username already taken');
    }
  }

  // Create user
  const user = await User.create({
    username,
    name,
    email,
    password,
    mobileNumber,
    commission,
    rollingCommission,
    currency,
    exposureLimit,
    role,
    createdBy: createdBy || null
  });

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
 * Login user - username can be username, name, or email
 */
const login = async (username, password) => {
  // Find user by username, email, or name
  const user = await User.findOne({
    $or: [
      { username: username.trim() },
      { email: username.toLowerCase().trim() },
      { name: username.trim() }
    ]
  }).select('+password');

  if (!user) {
    throw new Error('Invalid username or password');
  }

  // Check if account is locked
  if (user.isLocked()) {
    const lockTime = Math.ceil((user.lockUntil - Date.now()) / 1000 / 60);
    throw new Error(`Account locked. Try again in ${lockTime} minutes.`);
  }

  // Verify password
  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    await user.incLoginAttempts();
    throw new Error('Invalid username or password');
  }

  // Reset login attempts
  await user.resetLoginAttempts();

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

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
const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, {
    $unset: { refreshToken: 1, refreshTokenExpiry: 1 }
  });
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
const updateProfile = async (userId, updateData) => {
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

  return user.toJSON();
};

/**
 * Change password
 */
const changePassword = async (userId, currentPassword, newPassword) => {
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
