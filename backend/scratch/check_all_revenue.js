const mongoose = require('mongoose');
require('dotenv').config();

async function checkRevenue() {
    try {
        console.log('🚀 Connecting to database...');
        const uri = process.env.CONNECTION_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo';
        await mongoose.connect(uri);
        
        const Revenue = mongoose.model('Revenue', new mongoose.Schema({}, { strict: false }));

        const stats = await Revenue.aggregate([
            {
                $group: {
                    _id: null,
                    totalCommission: { $sum: "$amount" },
                    totalGemRevenue: { $sum: "$gemRevenue" },
                    totalMatches: { $sum: 1 }
                }
            }
        ]);

        if (!stats || stats.length === 0) {
            console.log('❌ No revenue records found in the Revenue collection.');
            process.exit(0);
        }

        const data = stats[0];
        const grandTotal = data.totalCommission + data.totalGemRevenue;

        console.log('\n--- 💰 TOTAL PLATFORM REVENUE ---');
        console.log(`🎮 Game Commission (Rake): $${data.totalCommission.toFixed(2)}`);
        console.log(`💎 Gem Re-roll Revenue:   $${data.totalGemRevenue.toFixed(2)}`);
        console.log('---------------------------------');
        console.log(`🔥 GRAND TOTAL EARNINGS:  $${grandTotal.toFixed(2)}`);
        console.log(`📊 Total Recorded Matches: ${data.totalMatches}`);
        
        process.exit(0);
    } catch (err) {
        console.error('💥 Error:', err);
        process.exit(1);
    }
}

checkRevenue();
