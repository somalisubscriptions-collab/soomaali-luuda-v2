const mongoose = require('mongoose');
const User = require('./models/User');

// Connect to MongoDB
mongoose.connect('mongodb://127.0.0.1:27017/ludo', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('Connected to MongoDB.');

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  console.log('Finding users with gem purchases today...');

  const users = await User.find({
    'transactions.type': 'gem_purchase',
    $or: [
      { 'transactions.timestamp': { $gte: startOfDay } },
      { 'transactions.createdAt': { $gte: startOfDay } }
    ]
  });

  let modifiedCount = 0;

  for (const user of users) {
    let changed = false;
    
    // Modify transactions
    user.transactions.forEach(tx => {
      if (tx.type === 'gem_purchase') {
        const txDate = tx.timestamp || tx.createdAt;
        if (txDate && txDate >= startOfDay) {
          tx.type = 'gem_purchase_archived'; // Rename so it doesn't count in today's revenue
          changed = true;
          modifiedCount++;
        }
      }
    });

    if (changed) {
      // Use markModified because we changed an array element
      user.markModified('transactions');
      await user.save();
      console.log(`Archived gem transactions for user: ${user.username}`);
    }
  }

  console.log(`\n✅ Done! Archived ${modifiedCount} gem transactions from today.`);
  console.log(`Faa'idada Gems-ka is now reset to $0.00!`);
  
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
