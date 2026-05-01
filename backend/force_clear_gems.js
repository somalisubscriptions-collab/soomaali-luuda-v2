require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const MONGO_URI = process.env.CONNECTION_URI || 'mongodb://127.0.0.1:27017/ludo';

mongoose.connect(MONGO_URI).then(async () => {
    console.log('Connected to MongoDB successfully.');
    
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const gemTxQuery = await User.aggregate([
        { $unwind: '$transactions' },
        { $match: {
            'transactions.type': 'gem_purchase',
            $or: [
                { 'transactions.timestamp': { $gte: startOfDay } },
                { 'transactions.createdAt': { $gte: startOfDay } }
            ]
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

    console.log(`Found ${gemTxQuery.length} gem transactions from today to archive.`);
    
    // forcefully rename all of them
    for(const u of gemTxQuery) {
       await User.updateOne(
          { _id: u._id, "transactions.type": "gem_purchase" },
          { $set: { "transactions.$[elem].type": "gem_purchase_archived" } },
          { arrayFilters: [ { "elem.type": "gem_purchase" } ] }
       );
    }
    console.log("\n✅ Force updated all remaining gem transactions for today.");
    console.log("Your players kept all their gems, but your Faa'idada Gems-ka is now $0.00!");

    process.exit(0);
}).catch(err => {
    console.error("MongoDB Connection Error:", err);
    process.exit(1);
});
