const mongoose = require('mongoose');
require('dotenv').config();

// Define Schemas inline to avoid dependency issues in standalone script
const AuditLogSchema = new mongoose.Schema({
    userId: String,
    username: String,
    action: String,
    change: Number,
    relatedId: String,
    createdAt: Date
});

const GameHistorySchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    winner: {
        userId: String,
        username: String,
        payout: Number
    },
    loser: {
        userId: String,
        username: String,
        loss: Number
    },
    stake: Number,
    totalPot: Number,
    commission: Number,
    outcome: { type: String, default: 'COMPLETED' },
    startedAt: Date,
    endedAt: Date,
    durationSecs: Number,
    isBackfilled: { type: Boolean, default: true }
});

async function backfill() {
    try {
        console.log('🚀 Connecting to database...');
        const uri = process.env.CONNECTION_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo';
        await mongoose.connect(uri);
        
        const AuditLog = mongoose.model('AuditLog', AuditLogSchema);
        const GameHistory = mongoose.model('GameHistory', GameHistorySchema);

        console.log('🔍 Finding all game-related audit logs...');
        const gameLogs = await AuditLog.find({ 
            action: { $in: ['GAME_WIN', 'GAME_LOSS'] } 
        }).sort({ createdAt: 1 });

        console.log(`📊 Found ${gameLogs.length} game audit entries.`);

        // Group by relatedId (gameId)
        const gamesMap = new Map();

        for (const log of gameLogs) {
            if (!log.relatedId) continue;
            
            if (!gamesMap.has(log.relatedId)) {
                gamesMap.set(log.relatedId, {
                    gameId: log.relatedId,
                    endedAt: log.createdAt,
                    winner: null,
                    loser: null,
                    stake: 0,
                    totalPot: 0,
                    commission: 0
                });
            }

            const game = gamesMap.get(log.relatedId);

            if (log.action === 'GAME_WIN') {
                game.winner = {
                    userId: log.userId,
                    username: log.username,
                    payout: log.change
                };
                // In Ludo, commission is 10%. payout = pot * 0.9
                game.totalPot = Math.round((log.change / 0.9) * 100) / 100;
                game.commission = Math.round((game.totalPot * 0.1) * 100) / 100;
                game.stake = Math.round((game.totalPot / 2) * 100) / 100;
            } else if (log.action === 'GAME_LOSS') {
                game.loser = {
                    userId: log.userId,
                    username: log.username,
                    loss: Math.abs(log.change)
                };
                if (game.stake === 0) {
                    game.stake = Math.abs(log.change);
                }
            }
        }

        console.log(`🔄 Processing ${gamesMap.size} unique matches...`);

        let createdCount = 0;
        let skippedCount = 0;

        for (const [gameId, gameData] of gamesMap) {
            try {
                // Check if already exists
                const existing = await GameHistory.findOne({ gameId });
                if (existing) {
                    skippedCount++;
                    continue;
                }

                // If we have at least a winner or loser, we can reconstruct
                if (gameData.winner || gameData.loser) {
                    await GameHistory.create({
                        ...gameData,
                        durationSecs: 0, // We don't know the duration for old games
                        startedAt: gameData.endedAt, // Approximation
                    });
                    createdCount++;
                }
            } catch (err) {
                console.error(`❌ Error processing game ${gameId}:`, err.message);
            }
        }

        console.log('\n--- BACKFILL COMPLETE ---');
        console.log(`✅ Created: ${createdCount} new history records`);
        console.log(`⏭️ Skipped: ${skippedCount} existing records`);
        
        process.exit(0);
    } catch (err) {
        console.error('💥 Fatal Error:', err);
        process.exit(1);
    }
}

backfill();
