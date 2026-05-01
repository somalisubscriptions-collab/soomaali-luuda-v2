const mongoose = require('mongoose');
const FinancialRequest = require('./models/FinancialRequest');

mongoose.connect('mongodb+srv://ludo:ilyaas@laandhuu-online.6lc4tez.mongodb.net/ludo?appName=laandhuu-online', { useNewUrlParser: true, useUnifiedTopology: true })
.then(async () => {
    const allPending = await FinancialRequest.find({ status: /pending/i });
    console.log(`Found ${allPending.length} TOTAL pending requests.`);
    allPending.forEach(req => {
        console.log(`- Type: "${req.type}", Amount: ${req.amount}, Status: "${req.status}"`);
    });
    process.exit(0);
});
