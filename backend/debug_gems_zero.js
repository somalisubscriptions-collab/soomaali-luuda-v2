require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const MONGO_URI = process.env.CONNECTION_URI || 'mongodb://127.0.0.1:27017/ludo';

mongoose.connect(MONGO_URI).then(async () => {
    console.log('Connected to MongoDB. Checking for new gem_purchase transactions...\n');
    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const gemTxQuery = await User.aggregate([
        { $unwind: '$transactions' },
        { $match: {
            'transactions.type': 'gem_purchase'
        }},
        { $project: {
            username: 1,
            desc: '$transactions.description',
            gemCount: '$transactions.amount',
            type: '$transactions.type',
            ts: '$transactions.timestamp',
            cr: '$transactions.createdAt'
        }}
    ]);

    console.log(`Found ${gemTxQuery.length} TOTAL gem_purchase transactions (all time).`);
    
    const todayTxs = gemTxQuery.filter(tx => {
        const d = tx.ts || tx.cr;
        return d && new Date(d) >= startOfDay;
    });

    console.log(`\nOf those, ${todayTxs.length} are from TODAY (after ${startOfDay.toISOString()}).`);
    
    console.log('\n--- TODAY TRANSACTIONS ---');
    todayTxs.forEach(t => console.log(JSON.stringify(t, null, 2)));

    console.log('\n--- ALL TRANSACTIONS (Top 5 most recent) ---');
    gemTxQuery.sort((a,b) => new Date(b.cr || b.ts) - new Date(a.cr || a.ts))
        .slice(0, 5)
        .forEach(t => console.log(JSON.stringify(t, null, 2)));

    process.exit(0);
});
