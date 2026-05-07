const mongoose = require('mongoose');
require('dotenv').config();

// Simple Schemas for import
const GameSchema = new mongoose.Schema({
    gameId: String,
    status: String,
    players: Array,
    winners: Array,
    stake: Number,
    createdAt: Date,
    updatedAt: Date
}, { strict: false });

const GameHistorySchema = new mongoose.Schema({
    gameId: { type: String, required: true, unique: true },
    winner: Object,
    loser: Object,
    stake: Number,
    totalPot: Number,
    commission: Number,
    outcome: String,
    startedAt: Date,
    endedAt: Date,
    durationSecs: Number
});

async function importFromGames() {
    try {
        console.log('🚀 Connecting to database...');
        const uri = process.env.CONNECTION_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo';
        await mongoose.connect(uri);
        
        const Game = mongoose.model('Game', GameSchema);
        const GameHistory = mongoose.model('GameHistory', GameHistorySchema);

        console.log('🔍 Searching for COMPLETED games in the main Games collection...');
        const games = await Game.find({ status: 'COMPLETED' }).sort({ createdAt: 1 });

        console.log(`📊 Found ${games.length} completed matches.`);

        let imported = 0;
        let skipped = 0;

        let count = 0;
        for (const g of games) {
            count++;
            console.log(`➡️ [${count}/${games.length}] Checking game: ${g.gameId}`);
            try {
                // Check if already in history
                const exists = await GameHistory.findOne({ gameId: g.gameId });
                if (exists) {
                    skipped++;
                    continue;
                }

                // Identify winner and loser by matching COLOR
                const winnerColor = g.winners && g.winners.length > 0 ? g.winners[0] : null;
                const winnerObj = g.players.find(p => p.color === winnerColor);
                // Loser is the other player (for 2-player games)
                const loserObj = g.players.find(p => p.color !== winnerColor && p.userId !== 'system');

                if (!winnerColor || !winnerObj || !loserObj) {
                    continue;
                }

                const stake = g.stake || 0;
                const totalPot = stake * 2;
                const commission = totalPot * 0.1;
                const payout = totalPot - commission;

                await GameHistory.create({
                    gameId: g.gameId,
                    winner: {
                        userId: winnerObj.userId,
                        username: winnerObj.username,
                        payout: payout
                    },
                    loser: {
                        userId: loserObj.userId,
                        username: loserObj.username,
                        loss: stake
                    },
                    stake: stake,
                    totalPot: totalPot,
                    commission: commission,
                    outcome: 'COMPLETED',
                    startedAt: g.createdAt,
                    endedAt: g.updatedAt || g.createdAt,
                    durationSecs: Math.floor(((g.updatedAt || g.createdAt) - g.createdAt) / 1000)
                });

                imported++;
            } catch (err) {
                console.error(`❌ Error importing ${g.gameId}:`, err.message);
            }
        }

        console.log('\n--- IMPORT COMPLETE ---');
        console.log(`✅ Imported: ${imported} records`);
        console.log(`⏭️ Skipped: ${skipped} existing records`);
        
        process.exit(0);
    } catch (err) {
        console.error('💥 Fatal Error:', err);
        process.exit(1);
    }
}

importFromGames();
