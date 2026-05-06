const mongoose = require('mongoose');

const GameHistorySchema = new mongoose.Schema({
  gameId:       { type: String, required: true, unique: true },
  gameType:     { type: String, enum: ['LUDO', 'JAR'], default: 'LUDO' },

  // Players
  winner: {
    userId:   String,
    username: String,
    color:    String,
  },
  loser: {
    userId:   String,
    username: String,
    color:    String,
  },
  players: [{
    userId:      String,
    username:    String,
    color:       String,
    isAI:        { type: Boolean, default: false },
    finalRank:   Number, // 1 = winner
    _id: false
  }],

  // Financials
  stake:       { type: Number, default: 0 },
  totalPot:    { type: Number, default: 0 },
  winnerPaid:  { type: Number, default: 0 }, // what winner actually received
  commission:  { type: Number, default: 0 }, // platform fee
  gemRevenue:  { type: Number, default: 0 }, // gem re-roll revenue

  // Timing
  startedAt:   { type: Date },
  endedAt:     { type: Date, default: Date.now },
  durationSecs:{ type: Number }, // how long the game lasted

  outcome:     { type: String, enum: ['WIN', 'DRAW', 'CANCELLED', 'REFUNDED'], default: 'WIN' },
}, {
  timestamps: true
});

// Indexes for fast queries
GameHistorySchema.index({ 'winner.userId': 1, endedAt: -1 });
GameHistorySchema.index({ 'loser.userId': 1, endedAt: -1 });
GameHistorySchema.index({ endedAt: -1 });
GameHistorySchema.index({ stake: 1 });

// NO TTL — permanent record forever

module.exports = mongoose.model('GameHistory', GameHistorySchema);
