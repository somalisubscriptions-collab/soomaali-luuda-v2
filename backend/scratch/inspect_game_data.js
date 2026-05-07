const mongoose = require('mongoose');
require('dotenv').config();

async function inspect() {
    try {
        await mongoose.connect(process.env.CONNECTION_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/ludo');
        const Game = mongoose.model('Game', new mongoose.Schema({}, { strict: false }));

        const game = await Game.findOne({ status: 'COMPLETED' });
        console.log('SAMPLE COMPLETED GAME:');
        console.log(JSON.stringify(game, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

inspect();
