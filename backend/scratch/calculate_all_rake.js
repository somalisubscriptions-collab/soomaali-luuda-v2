const mongoose = require('mongoose');
require('dotenv').config();

async function calculate() {
    try {
        console.log('🚀 Connecting to database...');
        const uri = process.env.CONNECTION_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo';
        await mongoose.connect(uri);
        
        const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({}, { strict: false }));
        const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({}, { strict: false }));

        console.log('🔍 Method 1: Calculating from Audit Logs (GAME_WIN)...');
        // In AuditLog, GAME_WIN change is (Pot - Rake). 
        // If rake is 10%, then Change = Pot * 0.9. 
        // Rake = Change / 9.
        const auditStats = await AuditLog.aggregate([
            { $match: { action: 'GAME_WIN' } },
            { $group: { 
                _id: null, 
                totalWinnings: { $sum: "$change" },
                count: { $sum: 1 }
            }}
        ]);

        let auditRake = 0;
        if (auditStats.length > 0) {
            auditRake = auditStats[0].totalWinnings / 9;
            console.log(`✅ Audit Logs found ${auditStats[0].count} wins.`);
            console.log(`💰 Rake from Audit Logs: $${auditRake.toFixed(2)}`);
        } else {
            console.log('❌ No GAME_WIN entries found in Audit Logs.');
        }

        console.log('\n🔍 Method 2: Calculating from Game History...');
        const historyStats = await GameHistory.aggregate([
            { $group: { 
                _id: null, 
                totalRake: { $sum: "$commission" },
                count: { $sum: 1 }
            }}
        ]);

        let historyRake = 0;
        if (historyStats.length > 0) {
            historyRake = historyStats[0].totalRake;
            console.log(`✅ Game History found ${historyStats[0].count} records.`);
            console.log(`💰 Rake from Game History: $${historyRake.toFixed(2)}`);
        }

        console.log('\n--- FINAL VERDICT ---');
        const maxRake = Math.max(auditRake, historyRake);
        console.log(`📊 Highest recorded Rake: $${maxRake.toFixed(2)}`);
        
        if (maxRake > historyRake) {
            console.log('\n⚠️ NOTE: Your Audit Logs show MORE revenue than your History.');
            console.log('You might want to run the backfill script again if you want to see them in the dashboard.');
        }

        process.exit(0);
    } catch (err) {
        console.error('💥 Error:', err);
        process.exit(1);
    }
}

calculate();
