
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const FinancialRequest = require('../models/FinancialRequest');

const SIFALO_API_URL = 'https://api.sifalopay.com/gateway/';
const SIFALO_VERIFY_URL = 'https://api.sifalopay.com/gateway/verify.php';

// Build Basic Auth header from env credentials
const getAuthHeader = () => {
  const username = process.env.SIFALO_USERNAME;
  const password = process.env.SIFALO_PASSWORD;
  if (!username || !password) {
    throw new Error('Sifalo Pay credentials not configured in .env');
  }
  const token = Buffer.from(`${username}:${password}`).toString('base64');
  return `Basic ${token}`;
};

// ──────────────────────────────────────────────
// POST /api/wallet/sifalo-checkout
// Initiates a Sifalo Pay Checkout session.
// Returns a { checkoutUrl } the frontend redirects to.
// ──────────────────────────────────────────────
router.post('/sifalo-checkout', async (req, res) => {
  try {
    const { amount, userId } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, error: 'userId is required' });
    }

    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0 || numAmount > 300) {
      return res.status(400).json({ success: false, error: 'Invalid amount (min $0.01, max $300)' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    // Unique order ID: userId + timestamp
    const orderId = `${userId}_${Date.now()}`;

    // Build return URL — app catches ?sifalo_deposit=1&order_id=... on return
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const returnUrl = `${frontendUrl}/?sifalo_deposit=1&order_id=${orderId}`;

    // Call Sifalo Pay checkout init
    const sifaloRes = await fetch(SIFALO_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: JSON.stringify({
        amount: numAmount.toFixed(2),
        gateway: 'checkout',
        currency: 'USD',
        return_url: returnUrl,
        notify_url: returnUrl.split('?')[0].replace(/\/$/, '') + '/api/wallet/sifalo-verify', // Tentative webhook guess
        order_id: orderId,
      }),

    });

    const sifaloData = await sifaloRes.json();

    if (!sifaloData.key || !sifaloData.token) {
      console.error('[SifaloPay] Checkout init failed:', sifaloData);
      return res.status(502).json({
        success: false,
        error: 'Payment gateway error. Try again later.',
      });
    }

    const checkoutUrl = `https://pay.sifalo.com/checkout/?key=${sifaloData.key}&token=${sifaloData.token}`;
    console.log(`[SifaloPay] Checkout session created for ${user.username}: $${numAmount} | orderId=${orderId}`);

    res.json({ success: true, checkoutUrl, orderId });
  } catch (error) {
    console.error('[SifaloPay] /sifalo-checkout error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to initiate payment session' });
  }
});

// ──────────────────────────────────────────────
// POST /api/wallet/sifalo-verify
// Called after the player returns from the Sifalo Pay checkout page.
// Verifies the transaction and — if successful — credits the player's balance automatically.
// ──────────────────────────────────────────────
router.post('/sifalo-verify', async (req, res) => {
  try {
    const { sid, order_id, userId } = req.body;
    
    // Robust User ID resolution: from body, from authenticated user, or parsed from order_id (userId_timestamp)
    let effectiveUserId = userId || req.user?.userId;
    if (!effectiveUserId && order_id && String(order_id).includes('_')) {
      effectiveUserId = String(order_id).split('_')[0];
    }


    if (!sid && !order_id) {
      return res.status(400).json({ success: false, error: 'Transaction ID (sid or order_id) required' });
    }

    // Call Sifalo Pay verify endpoint
    const verifyBody = sid ? { sid } : { order_id };
    const verifyRes = await fetch(SIFALO_VERIFY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': getAuthHeader(),
      },
      body: JSON.stringify(verifyBody),
    });

    const verifyData = await verifyRes.json();
    console.log(`[SifaloPay] Verify response for Order:${order_id || 'N/A'} | User:${effectiveUserId || 'N/A'}:`, verifyData);


    // Be tolerant with provider success formats.
    const normalizedStatus = String(verifyData.status || '').toLowerCase();
    const normalizedResponse = String(verifyData.response || '').toLowerCase();
    const normalizedCode = String(verifyData.code || '');
    const isSuccess =
      normalizedCode === '601' ||
      normalizedStatus === 'success' ||
      normalizedStatus === 'approved' ||
      normalizedStatus === 'completed' ||
      normalizedResponse.includes('success') ||
      normalizedResponse.includes('approved') ||
      normalizedResponse.includes('completed') ||
      normalizedResponse.includes('paid');

    if (!isSuccess) {
      return res.json({
        success: false,
        code: verifyData.code,
        status: verifyData.status,
        error: verifyData.response || 'Payment not completed or failed',
      });
    }

    const safeOrderId = order_id || verifyData.order_id || verifyData.orderId || null;
    const safeSid = sid || verifyData.sid || null;

    // Fast idempotency guard: if this payment is already approved, return current balance.
    const alreadyApproved = await FinancialRequest.findOne({
      type: 'DEPOSIT',
      status: 'APPROVED',
      $or: [
        ...(safeOrderId ? [{ adminComment: { $regex: `sifalo_order:${safeOrderId}` } }] : []),
        ...(safeSid ? [{ adminComment: { $regex: `SID:\\s*${safeSid}` } }] : []),
      ],
    });
    if (alreadyApproved) {
      const user = await User.findById(alreadyApproved.userId);
      return res.json({ success: true, alreadyProcessed: true, newBalance: user?.balance || 0 });
    }

    // Find matching pending request with multiple fallbacks.
    let pendingRequest = null;
    if (safeOrderId) {
      pendingRequest = await FinancialRequest.findOne({
        adminComment: { $regex: `sifalo_order:${safeOrderId}` },
        status: 'PENDING',
        type: 'DEPOSIT',
      });
    }

    if (!pendingRequest && effectiveUserId) {
      // Fallback: most recent pending deposit for this user.
      // Broadened to find ANY pending deposit if the user chose to pay via Sifalo.
      pendingRequest = await FinancialRequest.findOne({
        userId: String(effectiveUserId),
        status: 'PENDING',
        type: 'DEPOSIT'
      }).sort({ timestamp: -1 });
    }


    // Credit the player's balance with the verified amount
    const paidAmount = parseFloat(verifyData.amount) || 0;

    if (paidAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid verified amount from payment gateway' });
    }

    const creditUserId = pendingRequest?.userId || String(effectiveUserId || '');
    if (!creditUserId) {
      return res.status(400).json({ success: false, error: 'User ID missing for auto-credit' });
    }

    const updatedUser = await User.findByIdAndUpdate(
      creditUserId,
      { $inc: { balance: paidAmount } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    // Mark existing request as APPROVED, or create one if checkout no longer pre-creates pending.
    if (pendingRequest) {
      pendingRequest.status = 'APPROVED';
      pendingRequest.approverName = 'Sifalo Pay (Auto)';
      pendingRequest.processedBy = 'sifalo_auto';
      pendingRequest.amount = paidAmount;
      pendingRequest.adminComment = `Auto-approved | SID: ${safeSid || 'N/A'} | Method: ${verifyData.payment_type || 'checkout'}${safeOrderId ? ` | sifalo_order:${safeOrderId}` : ''}`;
      await pendingRequest.save();
    } else {
      const lastRequest = await FinancialRequest.findOne().sort({ shortId: -1 }).select('shortId');
      const nextShortId = (lastRequest?.shortId || 1000) + 1;
      await FinancialRequest.create({
        userId: updatedUser._id.toString(),
        userName: updatedUser.username,
        shortId: nextShortId,
        type: 'DEPOSIT',
        paymentMethod: 'Sifalo Pay',
        amount: paidAmount,
        status: 'APPROVED',
        details: `Sifalo Pay Checkout | ${updatedUser.username} | Phone: ${updatedUser.phone || ''}`,
        approverName: 'Sifalo Pay (Auto)',
        processedBy: 'sifalo_auto',
        adminComment: `Auto-approved | SID: ${safeSid || 'N/A'} | Method: ${verifyData.payment_type || 'checkout'}${safeOrderId ? ` | sifalo_order:${safeOrderId}` : ''}`,
      });
    }

    console.log(`✅ [SifaloPay] Auto-credited $${paidAmount} to ${updatedUser.username}. New balance: $${updatedUser.balance}`);

    res.json({
      success: true,
      newBalance: updatedUser.balance,
      amount: paidAmount,
      sid: safeSid,
      paymentType: verifyData.payment_type || 'Sifalo Pay',
    });
  } catch (error) {
    console.error('[SifaloPay] /sifalo-verify error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to verify payment. Contact support.' });
  }
});

module.exports = router;
