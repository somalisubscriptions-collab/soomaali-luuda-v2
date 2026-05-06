const mongoose = require('mongoose');

const AuditLogSchema = new mongoose.Schema({
  userId:       { type: String, required: true },
  username:     { type: String },

  action: {
    type: String,
    enum: [
      'DEPOSIT',        // Money added via Sifalo/manual
      'WITHDRAWAL',     // Money withdrawn
      'GAME_WIN',       // Won a game
      'GAME_LOSS',      // Lost a game (stake consumed)
      'GAME_REFUND',    // Game cancelled, stake returned
      'ADMIN_CREDIT',   // Admin manually added money
      'ADMIN_DEBIT',    // Admin manually removed money
      'LOAN_ISSUED',    // Loan given to user
      'LOAN_REPAID',    // Loan deducted from balance
      'REFERRAL_EARN',  // Earned referral commission
      'GEM_PURCHASE',   // Bought gems/re-rolls
    ],
    required: true
  },

  // Balance snapshot
  balanceBefore:  { type: Number, required: true },
  balanceAfter:   { type: Number, required: true },
  change:         { type: Number, required: true }, // + or -

  // Context
  relatedId:    String,  // gameId, orderId, requestId, etc.
  triggeredBy:  String,  // 'Sifalo Pay', 'Admin', 'Game Engine', etc.
  note:         String,  // Human-readable description

  createdAt: { type: Date, default: Date.now }
}, {
  timestamps: false
});

// Indexes for fast admin queries
AuditLogSchema.index({ userId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });
AuditLogSchema.index({ createdAt: -1 });

// Keep audit logs for 1 year then auto-delete
AuditLogSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 365 * 24 * 60 * 60 } // 1 year
);

module.exports = mongoose.model('AuditLog', AuditLogSchema);
