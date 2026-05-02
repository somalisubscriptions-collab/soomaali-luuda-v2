const express = require('express');
const router = express.Router();
const User = require('../models/User');
const FinancialRequest = require('../models/FinancialRequest');
const Revenue = require('../models/Revenue');
const { sendAdminAlert } = require('../adminAlert');

// Phone numbers that are granted admin quick-action access regardless of DB role
const ADMIN_PHONE_WHITELIST = [
    '+252615552432', '252615552432', '0615552432', '615552432',
    '+252614171577', '252614171577', '0614171577', '614171577',
    '+252617706896', '252617706896', '0617706896', '617706896'
];

const isWhitelistedAdmin = (reqUser) => {
    if (!reqUser) return false;
    const phone = reqUser.phone || '';
    return ADMIN_PHONE_WHITELIST.includes(phone);
};

// GET /api/admin/quick/user/:userId
// Fetch user details for quick action
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        // 1. Try EXACT Match first (ID or Phone)
        const exactMatch = await User.findOne({
            $or: [
                { _id: userId },
                { phone: userId }
            ]
        }).select('username phone balance gems avatar role');

        if (exactMatch) {
            return res.json({
                success: true,
                user: {
                    userId: exactMatch._id,
                    username: exactMatch.username,
                    phone: exactMatch.phone,
                    balance: exactMatch.balance,
                    gems: exactMatch.gems || 0,
                    avatar: exactMatch.avatar,
                    role: exactMatch.role
                }
            });
        }

        // 2. Try PARTIAL Match
        // Logic: Clean non-digits to handle +252, 061, etc.
        const cleanedInput = userId.replace(/\D/g, '');

        // Define what to search for
        let searchRegex;
        if (cleanedInput.length >= 5) {
            // If input has significant digits, specifically look for the last 5 digits
            // This satisfies "if 5 digits of the number match... show it"
            const last5 = cleanedInput.slice(-5);
            searchRegex = new RegExp(last5, 'i');
        } else if (userId.length >= 3) {
            // Fallback for short manual searches (names or short fragments)
            searchRegex = new RegExp(userId, 'i');
        }

        if (searchRegex) {

            // Search for partial matches using the determined regex
            const candidates = await User.find({
                phone: { $regex: searchRegex }
            })
                .select('username phone balance gems avatar role')
                .limit(10); // increased limit slightly to safeguard against 'last 5 digits' collisions

            if (candidates.length > 0) {
                // If exactly one match, just return it as 'user'
                if (candidates.length === 1) {
                    const match = candidates[0];
                    return res.json({
                        success: true,
                        user: {
                            userId: match._id,
                            username: match.username,
                            phone: match.phone,
                            balance: match.balance,
                            gems: match.gems || 0,
                            avatar: match.avatar,
                            role: match.role
                        }
                    });
                }

                // If multiple matches, return as 'matches' list
                return res.json({
                    success: true,
                    matches: candidates.map(u => ({
                        userId: u._id,
                        username: u.username,
                        phone: u.phone,
                        balance: u.balance,
                        gems: u.gems || 0,
                        avatar: u.avatar,
                        role: u.role
                    }))
                });
            }
        }

        // No result found
        return res.status(404).json({ success: false, error: 'User not found' });

    } catch (error) {
        console.error('Quick Action - User Lookup Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch user details' });
    }
});

// POST /api/admin/quick/transaction
// Perform direct deposit or withdrawal and create a receipt record
router.post('/transaction', async (req, res) => {
    try {
        // Redundant Security Check (Defense in Depth)
        // Allow SUPER_ADMIN, ADMIN roles OR whitelisted phone numbers
        if (req.user && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN' && !isWhitelistedAdmin(req.user)) {
            console.warn(`[SECURITY] Unauthorized balance manipulation attempt by user ${req.user.username}`);
            return res.status(403).json({ success: false, error: 'Access denied. Unauthorized activity logged.' });
        }

        const { userId, type, amount, adminId } = req.body;

        if (!userId || !type || !amount) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }

        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) {
            return res.status(400).json({ success: false, error: 'Invalid amount' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        if (type === 'WITHDRAWAL' && user.balance < numAmount) {
            return res.status(400).json({ success: false, error: 'Insufficient balance' });
        }

        // Get admin info for approverName
        let approverName = 'Admin';
        if (adminId) {
            const adminUser = await User.findById(adminId).select('username');
            if (adminUser) {
                approverName = adminUser.username;
            }
        }

        // Perform atomic update
        const update = type === 'DEPOSIT'
            ? { $inc: { balance: numAmount } }
            : { $inc: { balance: -numAmount } };

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            update,
            { new: true }
        );

        // Generate sequential shortId for receipt
        const lastRequest = await FinancialRequest.findOne().sort({ shortId: -1 }).select('shortId');
        const nextShortId = (lastRequest?.shortId || 1000) + 1;

        // Create FinancialRequest record for receipt generation
        const financialRequest = new FinancialRequest({
            userId: user._id.toString(),
            userName: user.username,
            shortId: nextShortId,
            type: type,
            paymentMethod: 'Quick Admin Action',
            amount: numAmount,
            status: 'APPROVED',
            details: `Quick Admin ${type} by ${approverName}`,
            timestamp: new Date(),
            adminComment: `Processed via Quick Admin Actions`,
            processedBy: adminId || 'admin',
            approverName: approverName
        });

        await financialRequest.save();
        // Log the transaction
        console.log(`[QuickAction] Admin ${adminId} (${req.user.id}) performed ${type} of $${numAmount} for user ${userId}`);

        // Alert Admin
        const emoji = type === 'DEPOSIT' ? '💰' : '💸';
        sendAdminAlert(`${emoji} *Quick Action ${type}*\n👤 Macmiil: ${user.username}\n💵 Cadadka: *$${numAmount.toFixed(2)}*\n✅ Cusub Xisaabtiisa: *$${updatedUser.balance.toFixed(2)}*`);
        // Emit socket event to notify user of balance update (triggers auto-refresh)
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${userId}`).emit('balance_updated', {
                newBalance: updatedUser.balance,
                type,
                amount: numAmount,
                message: type === 'DEPOSIT' ? 'Your account has been credited' : 'Withdrawal processed'
            });
        }

        res.json({
            success: true,
            newBalance: updatedUser.balance,
            message: `${type} of $${numAmount} successful`,
            request: {
                id: financialRequest._id.toString(),
                shortId: financialRequest.shortId,
                type: financialRequest.type,
                amount: financialRequest.amount,
                status: financialRequest.status,
                timestamp: financialRequest.timestamp,
                userName: financialRequest.userName,
                approverName: financialRequest.approverName,
                userPhone: user.phone
            }
        });

    } catch (error) {
        console.error('Quick Action - Transaction Error:', error);
        res.status(500).json({ success: false, error: 'Transaction failed' });
    }
});

// GET /api/admin/quick/recent
// Fetch 10 most recent quick admin transactions
router.get('/recent', async (req, res) => {
    try {
        // Redundant Security Check — allow whitelisted phones too
        if (req.user && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN' && !isWhitelistedAdmin(req.user)) {
            return res.status(403).json({ success: false, error: 'Access denied.' });
        }

        const recentRequests = await FinancialRequest.find({
            paymentMethod: 'Quick Admin Action'
        })
            .sort({ timestamp: -1 })
            .limit(10);

        // Fetch user data for each request to ensure we have latest balance/role/avatar if needed
        // but for now we just need the request data which already has userName.
        // If we want to allow clicking to select user, we need their userId (which is in the request).

        res.json({
            success: true,
            transactions: recentRequests.map(r => ({
                id: r._id,
                userId: r.userId,
                userName: r.userName,
                type: r.type,
                amount: r.amount,
                timestamp: r.timestamp,
                shortId: r.shortId,
                status: r.status,
                approverName: r.approverName
            }))
        });
    } catch (error) {
        console.error('Quick Action - Recent Transactions Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch recent transactions' });
    }
});

/**
 * GET /api/admin/quick/admin-deposits-summary
 * Aggregates deposit totals per admin (approverName) within optional date range.
 * Query params: startDate (YYYY-MM-DD), endDate (YYYY-MM-DD)
 */
router.get('/admin-deposits-summary', async (req, res) => {
    try {
        // Redundant Security Check
        if (req.user && req.user.role !== 'SUPER_ADMIN' && req.user.role !== 'ADMIN' && !isWhitelistedAdmin(req.user)) {
            return res.status(403).json({ success: false, error: 'Access denied.' });
        }

        const { startDate, endDate } = req.query;

        // Build date filter
        const dateFilter = {};
        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0);
            dateFilter.$gte = start;
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            dateFilter.$lte = end;
        }

        const matchQuery = {
            type: 'DEPOSIT',
            status: 'APPROVED',
        };
        if (Object.keys(dateFilter).length > 0) {
            matchQuery.timestamp = dateFilter;
        }

        // Aggregate deposits per admin.
        // Priority: use approverName if present, else fall back to processedBy (admin user ID → look up username).
        const summaryAgg = await FinancialRequest.aggregate([
            { $match: matchQuery },
            // Add a computed "adminKey" field: use approverName when non-empty; use processedBy as fallback
            {
                $addFields: {
                    adminKey: {
                        $cond: {
                            if: { $and: [{ $ne: ['$approverName', null] }, { $ne: ['$approverName', ''] }] },
                            then: '$approverName',
                            else: {
                                $cond: {
                                    if: { $and: [{ $ne: ['$processedBy', null] }, { $ne: ['$processedBy', ''] }, { $ne: ['$processedBy', 'admin'] }, { $ne: ['$processedBy', 'admin_quick_action'] }] },
                                    then: '$processedBy',
                                    else: 'Unknown Admin'
                                }
                            }
                        }
                    }
                }
            },
            {
                $group: {
                    _id: '$adminKey',
                    totalDeposited: { $sum: '$amount' },
                    transactionCount: { $sum: 1 },
                    lastTransaction: { $max: '$timestamp' },
                    transactions: {
                        $push: {
                            id: '$_id',
                            shortId: '$shortId',
                            userName: '$userName',
                            userId: '$userId',
                            amount: '$amount',
                            timestamp: '$timestamp',
                        }
                    }
                }
            },
            { $sort: { totalDeposited: -1 } }
        ]);

        // For any groups whose _id looks like a MongoDB ObjectId (24 hex chars), resolve it to a username
        const mongoose = require('mongoose');
        const User = require('../models/User');
        const resolvedAdmins = await Promise.all(summaryAgg.map(async (a) => {
            let adminName = a._id;
            if (/^[a-f0-9]{24}$/i.test(String(a._id))) {
                try {
                    const u = await User.findById(a._id).select('username phone');
                    if (u) adminName = u.username || u.phone || a._id;
                } catch (_) {}
            }
            return {
                adminName,
                totalDeposited: a.totalDeposited,
                transactionCount: a.transactionCount,
                lastTransaction: a.lastTransaction,
                transactions: a.transactions.sort((x, y) => new Date(y.timestamp) - new Date(x.timestamp))
            };
        }));

        // Grand total across all admins
        const grandTotal = resolvedAdmins.reduce((acc, a) => acc + a.totalDeposited, 0);

        res.json({
            success: true,
            startDate: startDate || null,
            endDate: endDate || null,
            grandTotal,
            admins: resolvedAdmins
        });

    } catch (error) {
        console.error('Admin Deposits Summary Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch admin deposits summary' });
    }
});

module.exports = router;

