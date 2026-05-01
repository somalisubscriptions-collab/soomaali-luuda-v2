
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  _id: String, // Explicitly define _id as String to allow frontend-generated IDs (e.g., 'u123456')
  username: { type: String, required: true, unique: true },
  phone: { type: String, sparse: true, unique: true }, // Phone number for login - sparse allows multiple nulls
  password: { type: String }, // Optional - Google OAuth users won't have a password
  googleId: { type: String, sparse: true, unique: true }, // Google OAuth user ID
  email: { type: String },
  balance: { type: Number, default: 100.00 },
  reservedBalance: { type: Number, default: 0 }, // For holding bets during matches
  gems: { type: Number, default: 0 }, // Virtual currency for re-rolls ($0.01 per gem)
  avatar: { type: String },
  role: { type: String, enum: ['USER', 'ADMIN', 'SUPER_ADMIN'], default: 'USER' },
  status: { type: String, enum: ['Active', 'Suspended'], default: 'Active' },
  createdAt: { type: Date, default: Date.now },

  // Progression System
  xp: { type: Number, default: 0 }, // Total experience points
  level: { type: Number, default: 1 }, // Current player level

  // Referral System
  referralCode: { type: String, unique: true, sparse: true }, // User's unique code to share (e.g., LUDO-ABC123)
  referredBy: { type: String, ref: 'User' }, // ID of user who referred this user
  referralEarnings: { type: Number, default: 0 }, // Total earned from referred users (20% of their rakes)
  referredUsers: [{ type: String, ref: 'User' }], // Array of user IDs this user has referred
  resetPasswordToken: { type: String },
  resetPasswordExpires: { type: Date },
  stats: {
    gamesPlayed: { type: Number, default: 0 },
    wins: { type: Number, default: 0 }, // Kept for compatibility, 'gamesWon' is preferred
    gamesWon: { type: Number, default: 0 },
    gamesLost: { type: Number, default: 0 },
    totalWinnings: { type: Number, default: 0 },
    totalLosses: { type: Number, default: 0 },
  },

  // OneSignal Player ID for push notifications
  oneSignalPlayerId: { type: String },
  transactions: [{
    type: {
      type: String,
      enum: ['deposit', 'withdrawal', 'game_win', 'game_loss', 'game_refund', 'refund', 'match_stake', 'match_unstake', 'referral_earning', 'gem_purchase', 'gem_usage', 'gem_giveaway', 'gem_purchase_archived', 'loan_auto_repayment']
    },
    amount: Number,
    matchId: String,
    description: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  _id: false,
  timestamps: true,
  toObject: { getters: true },
  toJSON: { getters: true },
  versionKey: false
});

// ===== INDEX OPTIMIZATION =====
// Compound index for admin dashboard (filter by role and status)
UserSchema.index({ role: 1, status: 1 });
// Index for referral queries
UserSchema.index({ referredBy: 1 });

module.exports = mongoose.model('User', UserSchema);
