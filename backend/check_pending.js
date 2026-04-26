const mongoose = require('mongoose');
const FinancialRequest = require('./models/FinancialRequest');

mongoose.connect('mongodb+srv://admin:admin@cluster0.p7100.mongodb.net/ludo?retryWrites=true&w=majority', { useNewUrlParser: true, useUnifiedTopology: true })
.then(async () => {
    const requests = await FinancialRequest.find({ type: 'WITHDRAWAL', status: 'PENDING' });
    console.log(`Found ${requests.length} pending withdrawals.`);
    console.log(requests);
    process.exit(0);
});
