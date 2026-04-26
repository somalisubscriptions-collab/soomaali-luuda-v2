const express = require('express');
const router = express.Router();
const FinancialRequest = require('../models/FinancialRequest');
const User = require('../models/User');

// GET /api/automation/pull-withdrawal
// The Android phone constantly polls this endpoint to see if there is money to send.
// It returns the oldest PENDING withdrawal.
// Security: Requires ?secret=123456 in the URL
router.get('/pull-withdrawal', async (req, res) => {
  if (req.query.secret !== '123456') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  try {
    // Find the oldest pending withdrawal
    const pendingWithdrawal = await FinancialRequest.findOne({ 
      type: 'WITHDRAWAL', 
      status: 'PENDING' 
    }).sort({ timestamp: 1 }); // 1 means ascending (oldest first)

    if (!pendingWithdrawal) {
      // No pending withdrawals
      return res.send('NONE');
    }

    // Get the user's phone number so the Android app knows where to send the money
    const user = await User.findById(pendingWithdrawal.userId);
    if (!user) {
        return res.send('NONE');
    }

    // EXPLOIT PREVENTION: Verify they still have enough balance
    // If they played a game and lost their balance while waiting for the bot, REJECT it immediately!
    if (user.balance < pendingWithdrawal.amount) {
      console.log(`[USSD Auto] Exploit prevented: User ${pendingWithdrawal.userName} dropped below requested amount. Rejecting.`);
      pendingWithdrawal.status = 'REJECTED';
      pendingWithdrawal.adminComment = 'Rejected: Insufficient balance at execution time';
      await pendingWithdrawal.save();
      return res.send('NONE'); // Abort dialing!
    }

    // Clean up the phone number for EVC Plus USSD (usually just 61XXXXXXX)
    let evcPhone = user.phone;
    if (evcPhone.startsWith('+252')) {
        evcPhone = evcPhone.substring(4);
    } else if (evcPhone.startsWith('252')) {
        evcPhone = evcPhone.substring(3);
    } else if (evcPhone.startsWith('0')) {
        evcPhone = evcPhone.substring(1);
    }

    // Return the EXACT string the phone needs to dial as plain text!
    // Format: *712*phone*amount#
    const dialString = `*712*${evcPhone}*${pendingWithdrawal.amount}#`;
    // EXPLOIT PREVENTION 2: Lock the funds NOW!
    // Deduct the balance before we even send the USSD string to the phone.
    // This stops them from spending it in a game during the 5-10 seconds the phone is typing the PIN!
    user.balance = Math.round((user.balance - pendingWithdrawal.amount) * 100) / 100;
    if (user.totalWithdrawals !== undefined) {
      user.totalWithdrawals = Math.round((user.totalWithdrawals + pendingWithdrawal.amount) * 100) / 100;
    }
    await user.save();

    // Safety check: Mark it as PROCESSING so we don't accidentally send it twice!
    pendingWithdrawal.status = 'PROCESSING';
    await pendingWithdrawal.save();

    console.log(`[USSD Auto] Locked $${pendingWithdrawal.amount} from ${user.username} and sent dial string to phone.`);
    res.send(dialString);
  } catch (error) {
    console.error('[USSD Auto] Error pulling withdrawal:', error);
    res.send('NONE');
  }
});

// GET /api/automation/complete-withdrawal
// After the Android phone successfully sends the USSD code and types the PIN, 
// it calls this endpoint to mark the oldest PENDING withdrawal as APPROVED so it doesn't send it again.
router.get('/complete-withdrawal', async (req, res) => {
  if (req.query.secret !== '123456') {
      return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  try {
    // Find the oldest processing withdrawal (the one the phone just paid)
    const request = await FinancialRequest.findOne({ 
      type: 'WITHDRAWAL', 
      status: 'PROCESSING' 
    }).sort({ timestamp: 1 });

    if (!request) {
      return res.status(404).json({ success: false, error: 'No processing requests found' });
    }

    // Note: We already deducted the balance in /pull-withdrawal to prevent double-spending!
    // We just need to mark it as approved here.

    // Mark it as approved
    request.status = 'APPROVED';
    request.approverName = 'AutoBot';
    request.adminComment = 'Automated by Android App';
    request.processedBy = 'ussd_auto';
    await request.save();

    console.log(`✅ [USSD Auto] Withdrawal of $${request.amount} to user ${request.userName} marked as APPROVED. Balance deducted.`);

    res.json({ success: true, message: 'Withdrawal marked as approved' });
  } catch (error) {
    console.error('[USSD Auto] Error completing withdrawal:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

module.exports = router;
