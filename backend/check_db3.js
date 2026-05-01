const mongoose = require('mongoose');
const FinancialRequest = require('./models/FinancialRequest');

mongoose.connect('mongodb+srv://ludo:ilyaas@laandhuu-online.6lc4tez.mongodb.net/ludo?appName=laandhuu-online')
.then(async () => {
    console.log('✅ Connected to database:', mongoose.connection.host);

    // Check ALL withdrawal statuses
    const all = await FinancialRequest.find({ type: 'WITHDRAWAL' }).sort({ timestamp: -1 }).limit(10);
    console.log(`\nLast 10 WITHDRAWAL records:`);
    all.forEach(r => {
        console.log(`  - Status: "${r.status}" | Amount: $${r.amount} | Created: ${r.timestamp || r.createdAt}`);
    });

    // Count each status
    const pending    = await FinancialRequest.countDocuments({ type: 'WITHDRAWAL', status: 'PENDING' });
    const processing = await FinancialRequest.countDocuments({ type: 'WITHDRAWAL', status: 'PROCESSING' });
    const approved   = await FinancialRequest.countDocuments({ type: 'WITHDRAWAL', status: 'APPROVED' });

    console.log(`\nSummary: PENDING=${pending}, PROCESSING=${processing}, APPROVED=${approved}`);
    process.exit(0);
})
.catch(err => {
    console.error('❌ DB connection failed:', err.message);
    process.exit(1);
});
