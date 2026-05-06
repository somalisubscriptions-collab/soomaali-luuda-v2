
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
    // This targets the frontend directly, which is protected by the Nginx CORS headers we added earlier.
    const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
    const returnUrl = `${frontendUrl}/?sifalo_deposit=1&order_id=${orderId}`;

    // Build notify URL using BACKEND_URL (must be publicly reachable by Sifalo's servers)
    const backendUrl = (process.env.BACKEND_URL || `http://localhost:${process.env.PORT || 5000}`).replace(/\/$/, '');
    const notifyUrl = `${backendUrl}/api/wallet/sifalo-verify`;

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
        notify_url: notifyUrl,
        order_id: orderId,
      }),
    });

    // Save a PENDING request to track the exact requested amount before gateway fees
    try {
      const lastRequest = await FinancialRequest.findOne().sort({ shortId: -1 }).select('shortId');
      const nextShortId = (lastRequest?.shortId || 1000) + 1;
      await FinancialRequest.create({
        userId: user._id.toString(),
        userName: user.username,
        shortId: nextShortId,
        type: 'DEPOSIT',
        paymentMethod: 'Sifalo Pay',
        amount: numAmount,
        status: 'PENDING',
        details: `Sifalo Pay Checkout | ${user.username}`,
        adminComment: `sifalo_order:${orderId}`
      });
    } catch (dbErr) {
      console.error('[SifaloPay] Failed to create pending request:', dbErr);
    }

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
// POST /api/wallet/sifalo-verify
// Webhook endpoint called by Sifalo to verify payment status
// ──────────────────────────────────────────────
router.post('/sifalo-verify', async (req, res) => {
  try {
    const { sid, order_id, userId, orderId: bodyOrderId } = req.body;
    
    // Robust User ID resolution: from body, from authenticated user, or parsed from order_id (userId_timestamp)
    let effectiveUserId = userId || req.user?.userId;
    const actualOrderId = order_id || bodyOrderId;

    if (!effectiveUserId && actualOrderId && String(actualOrderId).includes('_')) {
      effectiveUserId = String(actualOrderId).split('_')[0];
    }

    if (!sid && !actualOrderId) {
      console.warn('[SifaloPay] Verification attempt with no identifiers in body:', req.body);
      return res.status(400).json({ success: false, error: 'Transaction ID (sid or order_id) required' });
    }

    // Call Sifalo Pay verify endpoint
    const verifyBody = sid ? { sid } : { order_id: actualOrderId };
    
    let verifyData = {};
    try {
      const verifyRes = await fetch(SIFALO_VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
        },
        body: JSON.stringify(verifyBody),
      });

      if (!verifyRes.ok) {
        const errText = await verifyRes.text();
        console.error(`[SifaloPay] Gateway returned error ${verifyRes.status}:`, errText);
        throw new Error(`Gateway Error: ${verifyRes.status}`);
      }

      verifyData = await verifyRes.json();
    } catch (fetchErr) {
      console.error('[SifaloPay] API Fetch Error:', fetchErr.message);
      return res.status(502).json({ success: false, error: 'Payment gateway is currently unreachable' });
    }

    console.log(`[SifaloPay] Verify response for Order:${actualOrderId || 'N/A'} | User:${effectiveUserId || 'N/A'}:`, verifyData);

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
      console.warn(`[SifaloPay] Verification failed/pending for Order:${actualOrderId}. Code: ${normalizedCode}`);
      return res.json({
        success: false,
        code: verifyData.code,
        status: verifyData.status,
        error: verifyData.response || 'Payment not completed or failed',
      });
    }

    const safeOrderId = actualOrderId || verifyData.order_id || verifyData.orderId || null;
    const safeSid = sid || verifyData.sid || null;
    const paymentPhone = verifyData.sender_number || verifyData.phone || verifyData.sender || null;

    // --- SMART USER DISCOVERY ---
    if (!effectiveUserId) {
      console.log(`[SifaloPay] Anonymous verification. Searching for user...`);
      
      const queryArr = [];
      if (safeOrderId) queryArr.push({ adminComment: { $regex: safeOrderId } });
      if (safeSid) queryArr.push({ adminComment: { $regex: safeSid } });

      if (queryArr.length > 0) {
        const matchingReq = await FinancialRequest.findOne({
          type: 'DEPOSIT',
          $or: queryArr
        });

        if (matchingReq) {
          effectiveUserId = matchingReq.userId;
          console.log(`[SifaloPay] Found user ${effectiveUserId} via matching FinancialRequest`);
        } 
      }
      
      if (!effectiveUserId && paymentPhone) {
        const cleanPhone = String(paymentPhone).replace(/\D/g, '').slice(-9);
        if (cleanPhone.length >= 7) {
          const possibleUser = await User.findOne({ phone: { $regex: cleanPhone } });
          if (possibleUser) {
            effectiveUserId = possibleUser._id;
            console.log(`[SifaloPay] Found user ${effectiveUserId} via phone match: ${paymentPhone}`);
          }
        }
      }
    }

    if (!effectiveUserId) {
      console.error(`[SifaloPay] CRITICAL: Successful payment but no User found! Order:${safeOrderId}, SID:${safeSid}`);
      return res.status(404).json({ success: false, error: 'Could not identify user for this payment.' });
    }

    // Fast idempotency guard
    const queryAlready = [];
    if (safeOrderId) queryAlready.push({ adminComment: { $regex: `sifalo_order:${safeOrderId}` } });
    if (safeSid) queryAlready.push({ adminComment: { $regex: `SID:\\s*${safeSid}` } });

    if (queryAlready.length > 0) {
      const alreadyApproved = await FinancialRequest.findOne({
        type: 'DEPOSIT',
        status: 'APPROVED',
        $or: queryAlready
      });
      if (alreadyApproved) {
        const user = await User.findById(alreadyApproved.userId);
        return res.json({ success: true, alreadyProcessed: true, newBalance: user?.balance || 0 });
      }
    }

    // Find matching pending request
    let pendingRequest = null;
    if (safeOrderId) {
      pendingRequest = await FinancialRequest.findOne({
        adminComment: { $regex: `sifalo_order:${safeOrderId}` },
        status: 'PENDING',
        type: 'DEPOSIT',
      });
    }

    if (!pendingRequest && effectiveUserId) {
      pendingRequest = await FinancialRequest.findOne({
        userId: String(effectiveUserId),
        status: 'PENDING',
        type: 'DEPOSIT'
      }).sort({ timestamp: -1 });
    }

    // Determine amount to credit
    let paidAmount = parseFloat(verifyData.amount) || 0;

    if (pendingRequest && pendingRequest.amount > paidAmount) {
      const isWithinTolerance = pendingRequest.amount <= (paidAmount * 1.25) || (pendingRequest.amount - paidAmount) <= 0.50;
      if (isWithinTolerance) {
        paidAmount = pendingRequest.amount;
      }
    } else if (pendingRequest && pendingRequest.amount > 0 && pendingRequest.amount <= paidAmount) {
      paidAmount = pendingRequest.amount;
    }

    if (paidAmount <= 0) {
      return res.status(400).json({ success: false, error: 'Invalid verified amount from gateway' });
    }

    const creditUserId = pendingRequest?.userId || String(effectiveUserId);
    
    // --- UPDATING USER BALANCE & ADDING TRANSACTION ENTRY ---
    const updatedUser = await User.findById(creditUserId);
    if (!updatedUser) {
      return res.status(404).json({ success: false, error: 'User account not found' });
    }

    updatedUser.balance = (updatedUser.balance || 0) + paidAmount;
    
    // ADD TRANSACTION RECORD (Crucial for user visibility)
    if (!updatedUser.transactions) updatedUser.transactions = [];
    updatedUser.transactions.push({
      type: 'deposit',
      amount: paidAmount,
      description: `Sifalo Pay Deposit | SID: ${safeSid || 'N/A'}`,
      createdAt: new Date()
    });

    await updatedUser.save();

    // Mark existing request as APPROVED or create one
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
        userId: updatedUser._id,
        userName: updatedUser.username,
        shortId: nextShortId,
        type: 'DEPOSIT',
        paymentMethod: 'Sifalo Pay',
        amount: paidAmount,
        status: 'APPROVED',
        details: `Sifalo Pay Checkout | ${updatedUser.username}`,
        approverName: 'Sifalo Pay (Auto)',
        processedBy: 'sifalo_auto',
        adminComment: `Auto-approved | SID: ${safeSid || 'N/A'} | Method: ${verifyData.payment_type || 'checkout'}${safeOrderId ? ` | sifalo_order:${safeOrderId}` : ''}`,
      });
    }

    console.log(`✅ [SifaloPay] Auto-credited $${paidAmount} to ${updatedUser.username}.`);

    res.json({
      success: true,
      newBalance: updatedUser.balance,
      amount: paidAmount,
      sid: safeSid,
      paymentType: verifyData.payment_type || 'Sifalo Pay',
    });
  } catch (error) {
    console.error('[SifaloPay] /sifalo-verify error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify payment. Contact support.' });
  }
});

module.exports = router;
