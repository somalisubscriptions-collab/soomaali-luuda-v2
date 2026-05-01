const mongoose = require('mongoose');

const RevenueSchema = new mongoose.Schema({
  gameId: { type: String, required: true },
  gameType: { type: String, enum: ['LUDO', 'TIC_TAC_TOE'], default: 'LUDO' }, // NEW: Track game type
  amount: { type: Number, required: function() { return this.amount != null; }, default: 0 }, // The 10% commission (rake) - 0 allowed for gem-only records
  gemRevenue: { type: Number, default: 0 }, // Revenue from gem re-rolls in this game
  totalPot: { type: Number, required: function() { return this.totalPot != null; }, default: 0 }, // Total stake - 0 allowed for gem-only records
  winnerId: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  reason: { type: String, default: 'Game Commission' },
  gameDetails: {
    type: {
      players: [{
        userId: String,
        username: String,
        color: String
      }],
      winner: {
        userId: String,
        username: String,
        color: String
      },
      stake: Number,
      gameId: String
    },
    required: false // Optional for backwards compatibility
  }
});

// ===== INDEX OPTIMIZATION =====
// Index for revenue reports sorted by date
RevenueSchema.index({ timestamp: -1 });

// Index for finding revenue by game
RevenueSchema.index({ gameId: 1 });

// Index for filtering by game type and date
RevenueSchema.index({ gameType: 1, timestamp: -1 });

module.exports = mongoose.model('Revenue', RevenueSchema);




