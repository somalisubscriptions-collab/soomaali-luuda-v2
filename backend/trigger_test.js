const mongoose = require('mongoose');
const FinancialRequest = require('./models/FinancialRequest');

mongoose.connect('mongodb+srv://ludo:ilyaas@laandhuu-online.6lc4tez.mongodb.net/ludo?appName=laandhuu-online')
.then(async () => {
    const req = new FinancialRequest({
        userId: 'test12345',
        userName: 'AutoTest',
        type: 'WITHDRAWAL',
        amount: 0.02,
        status: 'PENDING'
    });
    await req.save();
    console.log('✅ Created 1 test PENDING withdrawal for $0.02!');
    console.log('📱 Keep your phone screen ON. MacroDroid will pick this up in less than 10 seconds.');
    process.exit(0);
})
.catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
