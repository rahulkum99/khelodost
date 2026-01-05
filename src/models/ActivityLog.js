const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  activityType: {
    type: String,
    enum: ['login', 'logout', 'login_failed', 'password_change', 'profile_update', 'token_refresh'],
    required: true
  },
  loginStatus: {
    type: String,
    enum: ['success', 'failed', 'locked'],
    default: 'success'
  },
  ipAddress: {
    type: String,
    required: true
  },
  isp: {
    type: String,
    default: null
  },
  city: {
    type: String,
    default: null
  },
  state: {
    type: String,
    default: null
  },
  country: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
    default: null
  },
  device: {
    type: String,
    default: null
  },
  browser: {
    type: String,
    default: null
  },
  os: {
    type: String,
    default: null
  },
  failureReason: {
    type: String,
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for faster queries
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ activityType: 1, createdAt: -1 });
activityLogSchema.index({ loginStatus: 1, createdAt: -1 });
activityLogSchema.index({ ipAddress: 1 });
activityLogSchema.index({ createdAt: -1 });

// Virtual for formatted date
activityLogSchema.virtual('formattedDate').get(function() {
  return this.createdAt.toISOString();
});

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

module.exports = ActivityLog;

