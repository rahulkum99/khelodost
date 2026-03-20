const mongoose = require('mongoose');

const casinoExternalEventSchema = new mongoose.Schema(
  {
    // 'bet_callback' or 'transfer'
    type: {
      type: String,
      enum: ['bet_callback', 'transfer'],
      required: true,
      index: true,
    },

    // Idempotency key:
    // - bet_callback: serial_number
    // - transfer: transfer_id
    id: {
      type: String,
      required: true,
      index: true,
    },

    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    memberAccount: { type: String, default: null },
    currencyCode: { type: String, default: null },

    requestTimestamp: { type: String, default: null },

    // Common metadata
    gameUid: { type: String, default: null },
    gameRound: { type: String, default: null },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },

    // For bet callbacks
    serialNumber: { type: String, default: null },
    betAmount: { type: Number, default: null },
    winAmount: { type: Number, default: null },
    netAmount: { type: Number, default: null },

    // For transfer
    transferId: { type: String, default: null },

    // For responses
    code: { type: Number, default: 0 },
    msg: { type: String, default: null },
    creditBefore: { type: Number, default: null },
    creditAfter: { type: Number, default: null },

    // For debugging / troubleshooting
    rawRequest: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  {
    timestamps: true,
    toJSON: { getters: true, virtuals: true },
    toObject: { getters: true, virtuals: true },
  }
);

casinoExternalEventSchema.index({ type: 1, id: 1 }, { unique: true });

module.exports = mongoose.model('CasinoExternalEvent', casinoExternalEventSchema);

