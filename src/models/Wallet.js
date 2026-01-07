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

