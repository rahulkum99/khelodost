const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Define role hierarchy (higher number = higher privilege)
const ROLES = {
  USER: 'user',
  AGENT: 'agent',
  MASTER: 'master',
  SUPER_MASTER: 'super_master',
  ADMIN: 'admin',
  SUPER_ADMIN: 'super_admin'
};

const ROLE_HIERARCHY = {
  [ROLES.USER]: 1,
  [ROLES.AGENT]: 2,
  [ROLES.MASTER]: 3,
  [ROLES.SUPER_MASTER]: 4,
  [ROLES.ADMIN]: 5,
  [ROLES.SUPER_ADMIN]: 6
};

// Supported currencies
const CURRENCIES = {
  INR: 'INR',
  USD: 'USD',
  EUR: 'EUR'
};

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Username is required'],
    unique: true,
    trim: true,
    minlength: [3, 'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
    match: [/^[a-zA-Z0-9_]+$/, 'Username can only contain letters, numbers, and underscores']
  },
  name: {
    type: String,
    required: [false, 'Name is optional'],
    trim: true,
    minlength: [3, 'Name must be at least 3 characters'],
    maxlength: [30, 'Name cannot exceed 30 characters']
  },
  email: {
    type: String,
    required: [false, 'Email is optional'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [8, 'Password must be at least 8 characters'],
    select: false // Don't return password by default
  },
  mobileNumber: {
    type: String,
    required: [true, 'Mobile number is required'],
    trim: true,
    match: [/^[+]?[(]?[0-9]{1,4}[)]?[-\s.]?[(]?[0-9]{1,4}[)]?[-\s.]?[0-9]{1,10}$/, 'Please provide a valid mobile number']
  },
  commission: {
    type: Number,
    required: [true, 'Commission is required'],
    min: [0, 'Commission cannot be negative'],
    max: [100, 'Commission cannot exceed 100%'],
    default: 0
  },
  rollingCommission: {
    type: Number,
    required: [true, 'Rolling commission is required'],
    min: [0, 'Rolling commission cannot be negative'],
    max: [100, 'Rolling commission cannot exceed 100%'],
    default: 0
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    enum: Object.values(CURRENCIES),
    default: CURRENCIES.INR,
    uppercase: true
  },
  exposureLimit: {
    type: Number,
    required: [true, 'Exposure limit is required'],
    min: [0, 'Exposure limit cannot be negative'],
    max: [9999999999, 'Exposure limit cannot exceed 10 digits'],
    validate: {
      validator: function(v) {
        return v.toString().length <= 10;
      },
      message: 'Exposure limit must be a 10 digit number'
    }
  },
  role: {
    type: String,
    enum: Object.values(ROLES),
    default: ROLES.USER,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  lastLogin: {
    type: Date
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date
  },
  refreshToken: {
    type: String,
    select: false
  },
  refreshTokenExpiry: {
    type: Date,
    select: false
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index for faster queries
// Note: email and username already have indexes from 'unique: true'
userSchema.index({ name: 1 });
userSchema.index({ mobileNumber: 1 });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });

// Compound index for login (username, name, or email)
// This helps with login queries that search across multiple fields
userSchema.index({ email: 1, username: 1, name: 1 });

// Hash password before saving
// Use promise-based middleware without `next` to avoid callback issues in scripts
userSchema.pre('save', async function() {
  if (!this.isModified('password')) return;

  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to check if account is locked
userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
};

// Method to handle failed login attempts
userSchema.methods.incLoginAttempts = async function() {
  // If we have a previous lock that has expired, restart at 1
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Lock account after 5 failed attempts for 2 hours
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 }; // 2 hours
  }
  
  return this.updateOne(updates);
};

// Method to reset login attempts
userSchema.methods.resetLoginAttempts = async function() {
  return this.updateOne({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  });
};

// Method to check role hierarchy
userSchema.methods.hasRole = function(requiredRole) {
  const userRoleLevel = ROLE_HIERARCHY[this.role] || 0;
  const requiredRoleLevel = ROLE_HIERARCHY[requiredRole] || 0;
  return userRoleLevel >= requiredRoleLevel;
};

// Method to check if user can access resource
userSchema.methods.canAccess = function(requiredRole) {
  if (!this.isActive) return false;
  return this.hasRole(requiredRole);
};

// Static method to get role hierarchy
userSchema.statics.getRoleHierarchy = function() {
  return ROLE_HIERARCHY;
};

// Static method to get all roles
userSchema.statics.getRoles = function() {
  return ROLES;
};

// Static method to get all currencies
userSchema.statics.getCurrencies = function() {
  return CURRENCIES;
};

// Remove sensitive data from JSON output
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.__v;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = { User, ROLES, ROLE_HIERARCHY, CURRENCIES };
