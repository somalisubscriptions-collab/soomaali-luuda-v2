const mongoose = require('mongoose');
const FinancialRequest = require('./models/FinancialRequest');

mongoose.connect('mongodb+srv://ludo:ilyaas@laandhuu-online.6lc4tez.mongodb.net/ludo?appName=laandhuu-online', { useNewUrlParser: true, useUnifiedTopology: true })
.then(async () => {
    const pending = await FinancialRequest.find({ type: 'WITHDRAWAL', status: 'PENDING' });
    const processing = await FinancialRequest.find({ type: 'WITHDRAWAL', status: 'PROCESSING' });
    console.log(`Found ${pending.length} PENDING withdrawals.`);
    console.log(`Found ${processing.length} PROCESSING withdrawals.`);
    process.exit(0);
});
