const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo');
        const AuditLog = mongoose.model('AuditLog', new mongoose.Schema({}, { strict: false }));

        console.log('--- SEARCHING FOR GAME AUDIT LOGS ---');
        const win = await AuditLog.findOne({ action: 'GAME_WIN' }).sort({ createdAt: -1 });
        const loss = await AuditLog.findOne({ action: 'GAME_LOSS' }).sort({ createdAt: -1 });

        console.log('\nSample GAME_WIN:');
        console.log(JSON.stringify(win, null, 2));

        console.log('\nSample GAME_LOSS:');
        console.log(JSON.stringify(loss, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

check();
