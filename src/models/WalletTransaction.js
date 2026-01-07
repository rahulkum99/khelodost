const mongoose = require('mongoose');

// Transaction types
const TRANSACTION_TYPES = {
  CREDIT: 'credit',           // Money added to wallet
  DEBIT: 'debit',             // Money deducted from wallet
  TRANSFER: 'transfer',       // Transfer between wallets
  REFUND: 'refund',           // Refund transaction
  COMMISSION: 'commission',   // Commission earned
  ADJUSTMENT: 'adjustment'    // Manual adjustment by admin
};

// Transaction status
const TRANSACTION_STATUS = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

const walletTransactionSchema = new mongoose.Schema({
  wallet: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Wallet',
    required: true,
    index: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  transactionType: {
    type: String,
    enum: Object.values(TRANSACTION_TYPES),
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: [0, 'Amount cannot be negative'],
    get: function(value) {
      return Math.round(value * 100) / 100;
    }
  },
  balanceBefore: {
    type: Number,
    required: true,
    default: 0,
    get: function(value) {
      return Math.round(value * 100) / 100;
    }
  },
  balanceAfter: {
    type: Number,
    required: true,
    default: 0,
    get: function(value) {
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
  status: {
    type: String,
    enum: Object.values(TRANSACTION_STATUS),
    default: TRANSACTION_STATUS.COMPLETED,
    index: true
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: [500, 'Description cannot exceed 500 characters']
  },
  referenceId: {
    type: String,
    unique: true,
    sparse: true,
    index: true
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  relatedTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletTransaction',
    default: null
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  ipAddress: {
    type: String,
    default: null
  },
  userAgent: {
    type: String,
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
walletTransactionSchema.index({ wallet: 1, createdAt: -1 });
walletTransactionSchema.index({ user: 1, createdAt: -1 });
walletTransactionSchema.index({ transactionType: 1, createdAt: -1 });
walletTransactionSchema.index({ status: 1, createdAt: -1 });
walletTransactionSchema.index({ performedBy: 1, createdAt: -1 });
walletTransactionSchema.index({ createdAt: -1 });
walletTransactionSchema.index({ referenceId: 1 });

// Compound indexes
walletTransactionSchema.index({ wallet: 1, status: 1, createdAt: -1 });
walletTransactionSchema.index({ user: 1, transactionType: 1, createdAt: -1 });

// Virtual for formatted amount
walletTransactionSchema.virtual('formattedAmount').get(function() {
  return this.amount.toFixed(2);
});

// Method to generate unique reference ID
walletTransactionSchema.statics.generateReferenceId = function() {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `TXN${timestamp}${random}`;
};

// Pre-save hook to generate reference ID if not provided
walletTransactionSchema.pre('save', async function(next) {
  if (!this.referenceId && this.status === TRANSACTION_STATUS.COMPLETED) {
    let referenceId;
    let isUnique = false;
    
    while (!isUnique) {
      referenceId = WalletTransaction.generateReferenceId();
      const existing = await WalletTransaction.findOne({ referenceId });
      if (!existing) {
        isUnique = true;
      }
    }
    
    this.referenceId = referenceId;
  }
  next();
});

const WalletTransaction = mongoose.model('WalletTransaction', walletTransactionSchema);

// Export constants
WalletTransaction.TRANSACTION_TYPES = TRANSACTION_TYPES;
WalletTransaction.TRANSACTION_STATUS = TRANSACTION_STATUS;

module.exports = WalletTransaction;

