const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  balance: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Balance cannot be negative'],
    get: function(value) {
      // Round to 2 decimal places for display
      return Math.round(value * 100) / 100;
    }
  },
  availableBalance: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Available balance cannot be negative'],
    get: function(value) {
      return Math.round(value * 100) / 100;
    }
  },
  lockedBalance: {
    type: Number,
    required: true,
    default: 0,
    min: [0, 'Locked balance cannot be negative'],
    get: function(value) {
      return Math.round(value * 100) / 100;
    }
  },
  totalDeposit: {
    type: Number,
    default: 0,
    min: [0, 'Total deposit cannot be negative']
  },
  totalWithdrawal: {
    type: Number,
    default: 0,
    min: [0, 'Total withdrawal cannot be negative']
  },
  totalProfit: {
    type: Number,
    default: 0
  },
  totalLoss: {
    type: Number,
    default: 0
  },
  currency: {
    type: String,
    required: true,
    enum: ['INR', 'USD', 'EUR'],
    default: 'INR',
    uppercase: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  lockedReason: {
    type: String,
    default: null
  },
  lastTransactionAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    getters: true
  },
  toObject: { 
    virtuals: true,
    getters: true
  }
});

// Indexes for faster queries
// Note: user field already has unique: true which creates an index automatically
walletSchema.index({ currency: 1 });
walletSchema.index({ isActive: 1 });
walletSchema.index({ balance: 1 });
walletSchema.index({ createdAt: -1 });

// Virtual for formatted balance
walletSchema.virtual('formattedBalance').get(function() {
  return this.balance.toFixed(2);
});

// Method to check if wallet is active and not locked
walletSchema.methods.isAvailable = function() {
  return this.isActive && !this.isLocked;
};

// Method to lock wallet
walletSchema.methods.lock = function(reason) {
  this.isLocked = true;
  this.lockedReason = reason || 'Wallet locked by administrator';
  return this.save();
};

// Method to unlock wallet
walletSchema.methods.unlock = function() {
  this.isLocked = false;
  this.lockedReason = null;
  return this.save();
};

// Method to lock balance for betting
walletSchema.methods.lockBalance = function(amount) {
  if (this.availableBalance < amount) {
    throw new Error('Insufficient available balance');
  }
  this.availableBalance -= amount;
  this.lockedBalance += amount;
  this.balance = this.availableBalance + this.lockedBalance;
  return this.save();
};

// Method to unlock balance
walletSchema.methods.unlockBalance = function(amount) {
  if (this.lockedBalance < amount) {
    throw new Error('Insufficient locked balance');
  }
  this.lockedBalance -= amount;
  this.availableBalance += amount;
  this.balance = this.availableBalance + this.lockedBalance;
  return this.save();
};

// Pre-save hook to ensure balance consistency
walletSchema.pre('save', function(next) {
  // Ensure balance = availableBalance + lockedBalance
  this.balance = this.availableBalance + this.lockedBalance;
  next();
});

// Static method to get or create wallet for user
walletSchema.statics.getOrCreateWallet = async function(userId, currency = 'INR') {
  let wallet = await this.findOne({ user: userId });
  
  if (!wallet) {
    wallet = await this.create({
      user: userId,
      balance: 0,
      currency: currency
    });
  }
  
  return wallet;
};

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;

