// ===== ADMIN GEMS MANAGEMENT ROUTES =====
const express = require('express');
const router = express.Router();

// Import models (adjust path as needed)
const User = require('../models/User');

// Middleware (already defined in server.js, use those)
// const authenticateToken = require('./middleware/auth');
// const authorizeAdmin = require('./middleware/admin');

// POST: Admin deposits gems to user
// Add to server.js as: app.post('/api/admin/deposit-gems', authenticateToken, authorizeAdmin, async (req, res) => { ... })
router.post('/deposit-gems', async (req, res) => {
    try {
        const { userId, gemAmount, comment } = req.body;
        const adminUser = req.user; // From authenticateToken middleware

        // Validate inputs
        if (!userId || !gemAmount || gemAmount <= 0) {
            return res.status(400).json({ error: 'User ID and valid gem amount required' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Add gems to user
        const gemsToAdd = parseInt(gemAmount);
        user.gems += gemsToAdd;

        // Record transaction
        user.transactions.push({
            type: 'gem_purchase',
            amount: gemsToAdd,
            description: comment || `Admin ${adminUser.username} deposited ${gemsToAdd} gems`,
            createdAt: new Date()
        });

        const { sendAdminAlert } = require('../adminAlert');
        await user.save();

        console.log(`✅ Admin ${adminUser.username} deposited ${gemsToAdd} gems to ${user.username}`);

        // Alert Admin
        sendAdminAlert(`💎 *Manual Gem Deposit*\n👤 Macmiil: ${user.username}\n💰 Cadadka: *${gemsToAdd} gems*\n👨‍💻 Approver: ${adminUser.username}`);

        res.json({
            success: true,
            message: `Successfully deposited ${gemsToAdd} gems to ${user.username}`,
            newGemBalance: user.gems
        });

    } catch (error) {
        console.error('Gem deposit error:', error);
        res.status(500).json({ error: 'Failed to deposit gems' });
    }
});

// GET: Get user's gem balance and re-roll history
router.get('/gems/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get gem-related transactions
        const gemTransactions = user.transactions.filter(t =>
            t.type === 'gem_purchase' || t.type === 'gem_usage'
        ).slice(-20); // Last 20 transactions

        res.json({
            username: user.username,
            gems: user.gems,
            transactions: gemTransactions
        });

    } catch (error) {
        console.error('Get gem balance error:', error);
        res.status(500).json({ error: 'Failed to fetch gem data' });
    }
});

module.exports = router;
