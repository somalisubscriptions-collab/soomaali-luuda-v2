const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo');
        const GameHistory = mongoose.model('GameHistory', new mongoose.Schema({}, { strict: false }));
        const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({}, { strict: false }));
        const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));

        const gameCount = await GameHistory.countDocuments();
        const auditCount = await AuditLog.countDocuments();
        const userCount = await User.countDocuments();

        console.log('--- DATABASE STATUS ---');
        console.log(`GameHistory Records: ${gameCount}`);
        console.log(`AuditLog Records: ${auditCount}`);
        console.log(`Total Users: ${userCount}`);

        if (gameCount > 0) {
            const sample = await GameHistory.findOne().sort({ endedAt: -1 });
            console.log('\nLatest Game History Sample:');
            console.log(JSON.stringify(sample, null, 2));
        }

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
