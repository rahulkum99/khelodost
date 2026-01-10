const mongoose = require('mongoose');

const passwordChangeHistorySchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  changedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  changeType: {
    type: String,
    enum: ['self', 'admin'],
    required: true,
    default: 'self'
  },
  ipAddress: {
    type: String,
    required: true
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
passwordChangeHistorySchema.index({ user: 1, createdAt: -1 });
passwordChangeHistorySchema.index({ changedBy: 1, createdAt: -1 });
passwordChangeHistorySchema.index({ changeType: 1, createdAt: -1 });
passwordChangeHistorySchema.index({ createdAt: -1 });

const PasswordChangeHistory = mongoose.model('PasswordChangeHistory', passwordChangeHistorySchema);

module.exports = PasswordChangeHistory;
