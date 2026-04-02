const mongoose = require('mongoose');

const userBetLockSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    lockToken: {
      type: String,
      required: false,
      default: null,
    },
    lockedUntil: {
      type: Date,
      required: true,
      default: () => new Date(0),
      index: true,
    },
    purpose: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('UserBetLock', userBetLockSchema);

