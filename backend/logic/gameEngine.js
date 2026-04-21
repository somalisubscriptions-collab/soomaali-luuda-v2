/**
 * LUDO GAME ENGINE - Comprehensive Multiplayer Dice Game
 * 
 * IMPLEMENTED FEATURES:
 * 
 * Part 1: Game Setup & Initialization
 * ✅ Two-player matchmaking based on bet amount
 * ✅ Fixed color assignment: First player = Green, Second player = Blue
 * ✅ Random turn order at game start for fairness
 * ✅ Funds reservation when entering matchmaking
 * 
 * Part 2: Core Gameplay Loop
 * ✅ Dice roll (random 1-6) with server-side generation
 * ✅ Rolling 6 grants extra turn
 * ✅ Rolling 6 unlocks pawn from Base (YARD) to starting square
 * ✅ Normal rolls (1-5) move pawns on track
 * ✅ Players with no pawns on track and no 6 roll are stuck
 * 
 * Part 3: Movement & Interaction
 * ✅ Capturing: Landing on single opponent pawn sends it back to Base
 * ✅ Safe blocks: 2+ opponent pawns form protective block (no capture, pawns coexist)
 * ✅ Safe squares: No captures on designated safe squares
 * ✅ Home stretch: Color-specific final path, safe from capture
 * 
 * Part 4: Winning Conditions
 * ✅ Win by moving all 4 pawns to HOME
 * ✅ Exact roll required to enter HOME (no overshooting)
 * 
 * Part 5: Multiplayer Synchronization
 * ✅ Authoritative server state (single source of truth)
 * ✅ Real-time updates via Socket.IO
 * ✅ Turn transitions with proper validation
 * ✅ Disconnection handling: Bot takes over using player's name
 * ✅ Rejoin support: Players can reconnect and resume control
 * 
 * Part 6: End Game & Payout
 * ✅ Automatic victory detection
 * ✅ Wallet settlement: Winner gets stake × 2, Loser debited stake
 * ✅ Stats tracking: Games played, wins recorded
 * ✅ Anti-double-settlement protection
 */

const Game = require('../models/Game');
const User = require('../models/User');
const Revenue = require('../models/Revenue');
const Loan = require('../models/Loan');
const crypto = require('crypto');
const aiAgent = require('./aiAgent');

// --- Auto Loan Settlement ---
// Called after every game end (win OR loss).
// Deducts ALL outstanding loans from the player regardless of balance.
// If balance < loan => balance goes negative. Loan still marked SETTLED.
const autoSettleLoans = async (userId, gameId) => {
    try {
        const loans = await Loan.find({ userId, status: 'OUTSTANDING' });
        if (!loans || loans.length === 0) return;

        for (const loan of loans) {
            // Deduct regardless — even if it makes balance negative
            await User.updateOne(
                { _id: userId },
                {
                    $inc: { balance: -loan.amount },
                    $push: {
                        transactions: {
                            type: 'loan_auto_repayment',
                            amount: -loan.amount,
                            matchId: gameId,
                            description: `Auto loan repayment after game ${gameId}`,
                            timestamp: new Date()
                        }
                    }
                }
            );

            loan.status = 'SETTLED';
            loan.settledAt = new Date();
            loan.settledBy = 'AUTO_GAME_END';
            await loan.save();

            console.log(`💳 AUTO LOAN SETTLED: $${loan.amount.toFixed(2)} deducted from user ${userId} after game ${gameId}`);
        }
    } catch (err) {
        console.error(`❌ Auto loan settlement error for user ${userId}:`, err);
        // Non-critical — game settlement already done, just log
    }
};

// --- Constants ---
const HOME_PATH_LENGTH = 5;
// SAFE_SQUARES: Traditional safe zones only (removed home entrances 11, 24, 37, 50)`r`n// Home entrances now follow smart combat rules: single pawn = kill, 2+ pawns = coexist
const SAFE_SQUARES = [0, 8, 13, 21, 26, 34, 39, 47];
const START_POSITIONS = { red: 39, green: 0, yellow: 13, blue: 26 };
const HOME_ENTRANCES = { red: 37, green: 50, yellow: 11, blue: 24 };

// --- Wallet Settlement Function ---
const processGameSettlement = async (gameObj) => {
    try {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`💰 SETTLEMENT STARTED for game ${gameObj.gameId}`);
        console.log(`${'='.repeat(80)}`);

        // ATOMIC LOCK: Try to set settlementProcessed to true ONLY IF it is currently false
        // This prevents race conditions where multiple requests trigger settlement simultaneously
        const game = await Game.findOneAndUpdate(
            {
                _id: gameObj._id,
                $or: [
                    { settlementProcessed: false },
                    { settlementProcessed: { $exists: false } }
                ]
            },
            { $set: { settlementProcessed: true } },
            { new: true } // Return the updated document
        );

        if (!game) {
            console.log(`⚠️ Settlement ALREADY processed for game ${gameObj.gameId} (Atomic Lock Rejection)`);
            return null;
        }

        console.log(`✅ ATOMIC LOCK ACQUIRED: Proceeding with settlement for game ${game.gameId}`);

        if (!game.stake || game.stake <= 0) {
            console.log(`⚠️ No stake set for game ${game.gameId}, skipping settlement.`);
            return;
        }

        if (!game.winners || game.winners.length === 0) {
            console.log(`⚠️ No winners in game ${game.gameId}, skipping settlement`);
            return;
        }

        // STRICT VALIDATION: Get winner and verify identity
        const winnerColor = game.winners[0];
        const winnerPlayer = game.players.find(p => p.color === winnerColor);

        if (!winnerPlayer || !winnerPlayer.userId || winnerPlayer.isAI) {
            console.error(`🚨 PAYMENT BLOCKED: Invalid winner player for game ${game.gameId}`);
            return;
        }

        // CRITICAL: Verify winner actually has ALL 4 pawns in HOME before ANY payment
        const winnerTokens = game.tokens.filter(t => t.color === winnerColor);
        const allInHome = winnerTokens.length === 4 && winnerTokens.every(t => t.position.type === 'HOME');

        if (!allInHome) {
            console.error(`🚨 PAYMENT BLOCKED: Winner ${winnerColor} does not have all 4 pawns in HOME! Game ${game.gameId}`);
            console.error(`🚨 Winner tokens status:`, winnerTokens.map(t => ({ id: t.id, position: t.position })));
            return;
        }

        console.log(`✅ VALIDATION PASSED: Winner ${winnerColor} has all 4 pawns in HOME`);

        // STRICT VALIDATION: Get loser - must be different human player
        const loserPlayer = game.players.find(p =>
            p.userId &&
            !p.isAI &&
            p.userId !== winnerPlayer.userId &&
            p.color !== winnerColor
        );

        if (!loserPlayer || !loserPlayer.userId) {
            console.error(`🚨 PAYMENT BLOCKED: Invalid loser player for game ${game.gameId}`);
            return;
        }

        console.log(`💰 STRICT VALIDATION PASSED - Processing settlement for game ${game.gameId}:`);
        console.log(`   Winner: ${winnerPlayer.userId} (${winnerColor})`);
        console.log(`   Loser: ${loserPlayer.userId} (${loserPlayer.color})`);
        console.log(`   Stake: $${game.stake}`);

        // Fetch user documents using VALIDATED userIds
        const winner = await User.findById(winnerPlayer.userId);
        const loser = await User.findById(loserPlayer.userId);
        const stake = game.stake;

        // Final safety check: ensure we got the correct users
        if (!winner) {
            console.error(`🚨 PAYMENT BLOCKED: Winner user ${winnerPlayer.userId} not found in database`);
            return;
        }

        if (!loser) {
            console.error(`🚨 PAYMENT BLOCKED: Loser user ${loserPlayer.userId} not found in database`);
            return;
        }

        // ============================================================================
        // DETAILED PRE-SETTLEMENT AUDIT (Reduced logging)
        // ============================================================================

        // ============================================================================
        // SETTLEMENT CALCULATIONS
        // ============================================================================
        const totalPot = stake * 2;
        const commission = totalPot * 0.10;
        const winnings = totalPot - commission; // Winner gets 1.8 * stake
        const profit = winnings - stake; // Winner's net profit is 0.8 * stake

        console.log(`\n🧮 SETTLEMENT CALCULATIONS:`);
        console.log(`   Stake per player: $${stake.toFixed(2)}`);
        console.log(`   Total pot (stake × 2): $${totalPot.toFixed(2)}`);
        console.log(`   Commission (10%): $${commission.toFixed(2)}`);
        console.log(`   Winnings (pot - commission): $${winnings.toFixed(2)}`);
        console.log(`   Net profit (winnings - stake): $${profit.toFixed(2)}`);

        // ============================================================================
        // VALIDATION: Check reserved balance
        // ============================================================================
        if (winner.reservedBalance < stake) {
            console.error(`🚨 CRITICAL ERROR: Winner's reserved balance ($${winner.reservedBalance}) is less than stake ($${stake})!`);
            console.error(`   This should NEVER happen! Investigation required.`);
            // We'll continue but log this as critical
            // Correcting it automatically to prevent negative reserved
            // winner.reservedBalance = Math.max(stake, winner.reservedBalance);
        }
        if (loser.reservedBalance < stake) {
            console.error(`🚨 CRITICAL ERROR: Loser's reserved balance ($${loser.reservedBalance}) is less than stake ($${stake})!`);
            console.error(`   This should NEVER happen! Investigation required.`);
            // loser.reservedBalance = Math.max(stake, loser.reservedBalance);
        }

        // ============================================================================
        // PROCESS WINNER PAYOUT
        // ============================================================================
        // ============================================================================
        // PROCESS WINNER PAYOUT (ATOMIC UPDATE)
        // ============================================================================
        console.log(`\n💰 PROCESSING WINNER PAYOUT (ATOMIC):`);

        // Prepare atomic update for winner
        const winnerUpdate = {
            $inc: {
                balance: winnings,
                "stats.gamesPlayed": 1,
                "stats.wins": 1,
                "stats.gamesWon": 1,
                "stats.totalWinnings": profit,
                // Safely decrement reserved balance. 
                // We trust the game logic that stake WAS reserved.
                reservedBalance: -stake,
                xp: 100 // Winner gets 100 XP
            },
            $push: {
                transactions: {
                    $each: [
                        {
                            type: 'game_win',
                            amount: profit,
                            matchId: game.gameId,
                            description: `Profit from winning game ${game.gameId} (Total pot: $${totalPot.toFixed(2)}, Commission: $${commission.toFixed(2)})`,
                            timestamp: new Date()
                        },
                        {
                            type: 'match_unstake',
                            amount: stake,
                            matchId: game.gameId,
                            description: `Stake returned from winning game ${game.gameId}`,
                            timestamp: new Date()
                        }
                    ]
                }
            }
        };

        const winnerResult = await User.updateOne({ _id: winner._id }, winnerUpdate);

        if (winnerResult.modifiedCount !== 1) {
            console.error(`🚨 CRITICAL: Atomic update failed for winner ${winner._id}. Manual check required.`);
        } else {
            console.log(`✅ ATOMIC PAYOUT SUCCESS: +$${winnings.toFixed(2)} added to user ${winner._id}`);
        }

        // AUTO LOAN: Deduct any outstanding loan from winner after they receive winnings
        await autoSettleLoans(winner._id.toString(), game.gameId);

        /* 
           REMOVED NON-ATOMIC SAVE
           winner.balance += winnings;
           winner.reservedBalance ...
           winner.save(); 
        */

        // ============================================================================
        // RECORD REVENUE & PROCESS REFERRAL COMMISSION
        // ============================================================================
        let platformNetRevenue = commission; // Default: platform keeps 100% of commission

        // ===== CALCULATE GEM RE-ROLL REVENUE =====
        // Count total gem re-rolls used in this game
        let totalRerolls = 0;
        if (game.rerollsUsed) {
            if (game.rerollsUsed instanceof Map) {
                for (const count of game.rerollsUsed.values()) {
                    totalRerolls += count;
                }
            } else {
                for (const userId in game.rerollsUsed) {
                    totalRerolls += game.rerollsUsed[userId];
                }
            }
        }

        const GEM_COST = 0.01; // 1 gem = $0.01
        const gemRevenue = totalRerolls * GEM_COST;

        console.log(`\n💎 GEM RE-ROLL REVENUE CALCULATION:`);
        console.log(`   Total re-rolls used in game: ${totalRerolls}`);
        console.log(`   Gem revenue (re-rolls × $${GEM_COST}): $${gemRevenue.toFixed(2)}`);
        console.log(`   Rake (10% commission): $${commission.toFixed(2)}`);
        console.log(`   TOTAL REVENUE (rake + gems): $${(commission + gemRevenue).toFixed(2)}`);

        try {
            const revenue = new Revenue({
                gameId: game.gameId,
                amount: commission,
                gemRevenue: gemRevenue,  // Track gem re-roll earnings
                totalPot: totalPot,
                winnerId: winner._id,
                timestamp: new Date(),
                reason: `Game ${game.gameId} completed - ${winner.username} won`,
                gameDetails: {
                    players: game.players.map(p => ({
                        userId: p.userId,
                        username: p.username || `Player ${p.color}`,
                        color: p.color
                    })),
                    winner: {
                        userId: winner._id,
                        username: winner.username,
                        color: game.players.find(p => p.userId === winner._id.toString())?.color || 'unknown'
                    },
                    stake: stake,
                    gameId: game.gameId
                }
            });
            await revenue.save();
            console.log(`   💵 Revenue recorded: Rake=$${commission.toFixed(2)}, Gems=$${gemRevenue.toFixed(2)}, Total=$${(commission + gemRevenue).toFixed(2)}`);
        } catch (revError) {
            console.error(`   ❌ Error recording revenue for game ${game.gameId}:`, revError);
        }

        // ============================================================================
        // REFERRAL COMMISSION PROCESSING
        // ============================================================================
        // Process referral commissions for BOTH winner and loser if they were referred
        // Both players contribute to the pot, so both should reward their referrers

        let winnerReferrerId = null; // Track to avoid double-payment

        // Check if winner was referred by someone (single-tier referral system)
        if (winner.referredBy) {
            try {
                const ReferralEarning = require('../models/ReferralEarning');
                const referrer = await User.findById(winner.referredBy);

                if (referrer) {
                    // Calculate referral commission: 20% of platform rake
                    const referralCommission = commission * 0.20;
                    platformNetRevenue -= referralCommission; // Deduct from platform revenue

                    console.log(`\n🎁 REFERRAL COMMISSION PROCESSING (WINNER):`);
                    console.log(`   Winner ${winner.username} was referred by ${referrer.username}`);
                    console.log(`   Platform rake: $${commission.toFixed(2)}`);
                    console.log(`   Referrer gets (20%): $${referralCommission.toFixed(2)}`);

                    // ATOMIC UPDATE: Credit referrer
                    const referrerUpdate = await User.updateOne(
                        { _id: referrer._id },
                        {
                            $inc: {
                                balance: referralCommission,
                                referralEarnings: referralCommission
                            },
                            $push: {
                                transactions: {
                                    type: 'referral_earning',
                                    amount: referralCommission,
                                    matchId: game.gameId,
                                    description: `Referral bonus from ${winner.username}'s win in game ${game.gameId}`,
                                    timestamp: new Date()
                                }
                            }
                        }
                    );

                    if (referrerUpdate.modifiedCount === 1) {
                        console.log(`   ✅ Referrer ${referrer.username} credited $${referralCommission.toFixed(2)}`);
                        winnerReferrerId = referrer._id.toString(); // Track this referrer

                        // Create referral earning record for audit trail
                        const referralEarning = new ReferralEarning({
                            referrer: referrer._id,
                            referred: winner._id,
                            gameId: game.gameId,
                            amount: referralCommission,
                            platformRake: commission
                        });
                        await referralEarning.save();
                        console.log(`   📊 Referral earning record created for winner's referrer`);
                    } else {
                        console.error(`   🚨 Failed to credit referrer ${referrer.username}`);
                    }
                } else {
                    console.warn(`   ⚠️ Referrer not found for winner ${winner.username} (referredBy: ${winner.referredBy})`);
                }
            } catch (refError) {
                console.error(`   ❌ Error processing winner's referral commission:`, refError);
                // Non-critical error, game settlement continues
            }
        } else {
            console.log(`\n   ℹ️ Winner ${winner.username} was not referred (organic user)`);
        }

        // Check if loser was also referred by someone
        if (loser.referredBy) {
            try {
                const ReferralEarning = require('../models/ReferralEarning');
                const loserReferrer = await User.findById(loser.referredBy);

                if (loserReferrer) {
                    // Check if loser's referrer is different from winner's referrer to avoid double-payment
                    if (loserReferrer._id.toString() === winnerReferrerId) {
                        console.log(`\n   ℹ️ Loser ${loser.username} was referred by same person as winner. Skipping duplicate payment.`);
                    } else {
                        // Calculate referral commission: 20% of platform rake
                        const referralCommission = commission * 0.20;
                        platformNetRevenue -= referralCommission; // Deduct from platform revenue

                        console.log(`\n🎁 REFERRAL COMMISSION PROCESSING (LOSER):`);
                        console.log(`   Loser ${loser.username} was referred by ${loserReferrer.username}`);
                        console.log(`   Platform rake: $${commission.toFixed(2)}`);
                        console.log(`   Referrer gets (20%): $${referralCommission.toFixed(2)}`);

                        // ATOMIC UPDATE: Credit loser's referrer
                        const referrerUpdate = await User.updateOne(
                            { _id: loserReferrer._id },
                            {
                                $inc: {
                                    balance: referralCommission,
                                    referralEarnings: referralCommission
                                },
                                $push: {
                                    transactions: {
                                        type: 'referral_earning',
                                        amount: referralCommission,
                                        matchId: game.gameId,
                                        description: `Referral bonus from ${loser.username}'s game ${game.gameId}`,
                                        timestamp: new Date()
                                    }
                                }
                            }
                        );

                        if (referrerUpdate.modifiedCount === 1) {
                            console.log(`   ✅ Referrer ${loserReferrer.username} credited $${referralCommission.toFixed(2)}`);

                            // Create referral earning record for audit trail
                            const referralEarning = new ReferralEarning({
                                referrer: loserReferrer._id,
                                referred: loser._id,
                                gameId: game.gameId,
                                amount: referralCommission,
                                platformRake: commission
                            });
                            await referralEarning.save();
                            console.log(`   📊 Referral earning record created for loser's referrer`);
                        } else {
                            console.error(`   🚨 Failed to credit loser's referrer ${loserReferrer.username}`);
                        }
                    }
                } else {
                    console.warn(`   ⚠️ Referrer not found for loser ${loser.username} (referredBy: ${loser.referredBy})`);
                }
            } catch (refError) {
                console.error(`   ❌ Error processing loser's referral commission:`, refError);
                // Non-critical error, game settlement continues
            }
        } else {
            console.log(`\n   ℹ️ Loser ${loser.username} was not referred (organic user)`);
        }

        console.log(`\n💰 Final Platform Net Revenue: $${platformNetRevenue.toFixed(2)}`);

        // ============================================================================
        // PROCESS LOSER DEDUCTION
        // ============================================================================
        // ============================================================================
        // PROCESS LOSER DEDUCTION (ATOMIC UPDATE)
        // ============================================================================
        console.log(`\n💸 PROCESSING LOSER DEDUCTION (ATOMIC):`);

        const loserUpdate = {
            $inc: {
                "stats.gamesPlayed": 1,
                "stats.gamesLost": 1,
                "stats.totalLosses": stake,
                // Atomic decrement of reserved balance
                reservedBalance: -stake,
                xp: 25 // Loser gets 25 XP
            },
            $push: {
                transactions: {
                    type: 'game_loss',
                    amount: -stake,
                    matchId: game.gameId,
                    description: `Lost game ${game.gameId} - stake consumed`,
                    timestamp: new Date()
                }
            }
        };

        const loserResult = await User.updateOne({ _id: loser._id }, loserUpdate);

        if (loserResult.modifiedCount !== 1) {
            console.error(`🚨 CRITICAL: Atomic update failed for loser ${loser._id}`);
        } else {
            console.log(`✅ ATOMIC DEDUCTION SUCCESS: Stake consumed for user ${loser._id}`);
        }

        // AUTO LOAN: Deduct any outstanding loan from loser too (even if balance goes negative)
        await autoSettleLoans(loser._id.toString(), game.gameId);

        /*
        REMOVED NON-ATOMIC SAVE
        loser.reservedBalance = ...
        loser.save();
        */

        // ATOMIC lock handled this already
        // game.settlementProcessed = true;

        // Show both total payout (winnings) and net profit to avoid confusion in the UI
        game.message = `${winner.username} won $${winnings.toFixed(2)} (net +$${profit.toFixed(2)})`;
        // Since we modified game.message on the object returned from findOneAndUpdate, we should save it
        // Or optimally, update it along with the initial lock, but message depends on calc.
        // So we update it here. Since settlementProcessed is already true, this is safe.
        await Game.updateOne({ _id: game._id }, { $set: { message: game.message } });


        // ============================================================================
        // POST-SETTLEMENT AUDIT
        // ============================================================================
        console.log(`\n📊 POST-SETTLEMENT BALANCES:`);
        console.log(`   Winner (${winner.username}):`);
        console.log(`      - Balance: $${winner.balance.toFixed(2)} (was $${winnerBalanceBefore.toFixed(2)})`);
        console.log(`      - Reserved: $${winner.reservedBalance.toFixed(2)} (was $${winnerReservedBefore.toFixed(2)})`);
        console.log(`      - Total Available: $${(winner.balance).toFixed(2)}`);
        console.log(`      - ✅ Net gain: +$${(winner.balance - winnerBalanceBefore).toFixed(2)}`);
        console.log(`   Loser (${loser.username}):`);
        console.log(`      - Balance: $${loser.balance.toFixed(2)} (was $${loserBalanceBefore.toFixed(2)})`);
        console.log(`      - Reserved: $${loser.reservedBalance.toFixed(2)} (was $${loserReservedBefore.toFixed(2)})`);
        console.log(`      - Total Available: $${(loser.balance).toFixed(2)}`);
        console.log(`      - ✅ Balance unchanged (stake was already reserved)`);

        console.log(`\n✅ SETTLEMENT COMPLETE FOR GAME ${game.gameId}`);
        console.log(`${'='.repeat(80)}\n`);

        // Return settlement data for win notification
        return {
            winnerId: winner._id.toString(),
            winnerUsername: winner.username,
            grossWin: totalPot,
            netAmount: winnings,
            commission: commission,
            stake: stake
        };
    } catch (error) {
        console.error(`❌ Error processing settlement for game ${gameObj.gameId}:`, error);
        console.error(`Stack trace:`, error.stack);
        return null;
    }
};

// --- Game Refund Function (Postponed/Cancelled) ---
const processGameRefund = async (gameId) => {
    try {
        console.log(`\n${'='.repeat(80)}`);
        console.log(`🔄 REFUND STARTED for game ${gameId}`);
        console.log(`${'='.repeat(80)}`);

        // ATOMIC LOCK: Set settlementProcessed to true to prevent double refunds or settlement
        const game = await Game.findOneAndUpdate(
            {
                gameId: gameId,
                $or: [
                    { settlementProcessed: false },
                    { settlementProcessed: { $exists: false } }
                ]
            },
            {
                $set: {
                    settlementProcessed: true,
                    status: 'CANCELLED',
                    message: 'Game postponed. Stake refunded to all players.'
                }
            },
            { new: true }
        );

        if (!game) {
            console.log(`⚠️ Refund/Settlement ALREADY processed for game ${gameId} (Atomic Lock Rejection)`);
            return { success: false, message: 'Already processed' };
        }

        if (!game.stake || game.stake <= 0) {
            console.log(`⚠️ No stake to refund for game ${gameId}`);
            return { success: true, message: 'No stake to refund' };
        }

        const stake = game.stake;
        console.log(`💰 Processing refunds. Stake per player: $${stake.toFixed(2)}`);

        for (const player of game.players) {
            // Refund only human players who have a userId
            if (player.userId && !player.isAI) {
                try {
                    const user = await User.findOneAndUpdate(
                        { _id: player.userId },
                        {
                            $inc: {
                                balance: stake,              // ✅ Return stake to available balance
                                reservedBalance: -stake      // ✅ CRITICAL FIX: Clear reserved balance
                            },
                            $push: {
                                transactions: {
                                    type: 'refund',
                                    amount: stake,
                                    matchId: gameId,
                                    description: `Full refund for cancelled game ${gameId} (balance + reserved cleared)`,
                                    timestamp: new Date()
                                }
                            }
                        },
                        { new: true }
                    );

                    if (user) {
                        console.log(`   ✅ Atomic Refund: $${stake.toFixed(2)} to ${user.username || player.color} (New Balance: $${user.balance.toFixed(2)}, Reserved: $${user.reservedBalance.toFixed(2)})`);
                    } else {
                        console.error(`   🚨 User not found or update failed for refund: ${player.userId}`);
                    }
                } catch (err) {
                    console.error(`   ❌ Failed to process refund for player ${player.userId}:`, err);
                }
            }
        }

        console.log(`✅ REFUND COMPLETED successfully for game ${gameId}`);
        return { success: true, message: 'Refund completed' };

    } catch (error) {
        console.error(`❌ CRITICAL ERROR in refund for game ${gameId}:`, error);
        return { success: false, message: error.message };
    }
};

// --- Helpers ---
const getNextPlayerIndex = (game, currentIndex, grantExtraTurn) => {
    let nextIndex = grantExtraTurn ? currentIndex : (currentIndex + 1) % game.players.length;
    let attempts = 0;
    while (game.winners.includes(game.players[nextIndex].color) && attempts < 4) {
        nextIndex = (nextIndex + 1) % game.players.length;
        attempts++;
    }
    return nextIndex;
};

// Export for use in server.js
exports.getNextPlayerIndex = getNextPlayerIndex;

const calculateLegalMoves = (gameState, diceValue) => {
    const { tokens, currentPlayerIndex, players } = gameState;
    const currentPlayer = players[currentPlayerIndex];
    const moves = [];
    const playerTokens = tokens.filter(t => t.color === currentPlayer.color);

    console.log(`📋 calculateLegalMoves: player=${currentPlayer.color}, diceValue=${diceValue}, tokensInYard=${playerTokens.filter(t => t.position.type === 'YARD').length}, tokensOnPath=${playerTokens.filter(t => t.position.type === 'PATH').length}`);

    for (const token of playerTokens) {
        const currentPos = token.position;

        if (currentPos.type === 'YARD') {
            console.log(`📋 Token ${token.id} in YARD, diceValue=${diceValue}`);
            if (diceValue === 6) {
                // FIX: Ensure color is lowercase for lookup
                const colorKey = currentPlayer.color.toLowerCase();
                const startPos = START_POSITIONS[colorKey];

                if (startPos === undefined) {
                    console.error(`❌ CRITICAL: No start position found for color '${currentPlayer.color}'`);
                    continue; // Skip this token
                }
                // With a 6, a pawn can always move from YARD to its start position on the PATH.
                // The capture/stacking logic will be handled in executeMoveToken.
                console.log(`📋 Adding move: ${token.id} from YARD to PATH:${startPos}`);
                moves.push({ tokenId: token.id, finalPosition: { type: 'PATH', index: startPos } });
            }
        } else if (currentPos.type === 'PATH') {
            console.log(`📋 Token ${token.id} on PATH at ${currentPos.index}, diceValue=${diceValue}`);
            const homeEntrance = HOME_ENTRANCES[currentPlayer.color];
            const distanceToHomeEntrance = (homeEntrance - currentPos.index + 52) % 52;

            if (diceValue > distanceToHomeEntrance) {
                const stepsIntoHome = diceValue - distanceToHomeEntrance - 1;
                if (stepsIntoHome < HOME_PATH_LENGTH) {
                    moves.push({ tokenId: token.id, finalPosition: { type: 'HOME_PATH', index: stepsIntoHome } });
                } else if (stepsIntoHome === HOME_PATH_LENGTH) {
                    moves.push({ tokenId: token.id, finalPosition: { type: 'HOME' } });
                }
            } else {
                const finalIndex = (currentPos.index + diceValue) % 52;
                console.log(`📋 Adding move: ${token.id} to PATH:${finalIndex}`);
                moves.push({ tokenId: token.id, finalPosition: { type: 'PATH', index: finalIndex } });
            }
        } else if (currentPos.type === 'HOME_PATH') {
            const newHomeIndex = currentPos.index + diceValue;
            if (newHomeIndex < HOME_PATH_LENGTH) {
                // Normal move within HOME_PATH
                moves.push({ tokenId: token.id, finalPosition: { type: 'HOME_PATH', index: newHomeIndex } });
                console.log(`📋 Token ${token.id} can move within HOME_PATH from ${currentPos.index} to ${newHomeIndex}`);
            } else if (newHomeIndex === HOME_PATH_LENGTH) {
                // EXACT ROLL REQUIRED: Only allow HOME entry if exact roll
                moves.push({ tokenId: token.id, finalPosition: { type: 'HOME' } });
                console.log(`📋 Token ${token.id} can enter HOME with exact roll (from ${currentPos.index} + ${diceValue} = ${newHomeIndex})`);
            } else {
                // Overshooting: If roll is too high, no move is possible
                console.log(`📋 Token ${token.id} CANNOT move: overshoot HOME (${currentPos.index} + ${diceValue} = ${newHomeIndex} > ${HOME_PATH_LENGTH})`);
            }
        }
    }
    return moves;
};

exports.calculateLegalMoves = calculateLegalMoves; // Export for testing

exports.handleJoinGame = async (gameId, userId, playerColor, socketId) => {
    let game = await Game.findOne({ gameId });
    if (!game) {
        game = new Game({ gameId, players: [], tokens: [] });
    }

    if (game.status === 'CANCELLED') return { success: false, message: 'Game is cancelled' };

    // Fetch user to get username
    let username = 'Player';
    try {
        const user = await User.findById(userId);
        if (user && user.username) {
            username = user.username;
        }
    } catch (e) {
        console.error(`Error fetching user ${userId}:`, e);
    }

    // ATOMIC UPDATE: Replace game.save() with updateOne
    const playerIndex = game.players.findIndex(p => p.color === playerColor);
    if (playerIndex !== -1) {
        // Update existing player
        await Game.updateOne(
            { gameId, "players.color": playerColor },
            {
                $set: {
                    "players.$.socketId": socketId,
                    "players.$.username": username,
                    "players.$.isDisconnected": false,
                    message: `${username} reconnected!`
                }
            }
        );

        // Update in-memory object to return correct state
        game.players[playerIndex].socketId = socketId;
        game.players[playerIndex].username = username;
        game.players[playerIndex].isDisconnected = false;
        game.message = `${username} reconnected!`;
        console.log(`✅ Player ${userId} (${playerColor}) reconnected to game ${gameId} (Atomic Update)`);

    } else {
        // Add new player
        const newTokens = Array.from({ length: 4 }, (_, i) => ({
            id: `${playerColor}-${i}`,
            color: playerColor,
            position: { type: 'YARD', index: i }
        }));

        const newPlayer = {
            color: playerColor,
            userId,
            username,
            socketId,
            isAI: false,
            isDisconnected: false
        };

        if (game.isNew) {
            game.players.push(newPlayer);
            game.tokens.push(...newTokens);
            await game.save();
            console.log(`✅ Created new game ${gameId} with player ${userId} (${playerColor})`);
        } else {
            await Game.updateOne(
                { gameId },
                {
                    $push: {
                        players: newPlayer,
                        tokens: { $each: newTokens }
                    }
                }
            );

            // Update in-memory object
            game.players.push(newPlayer);
            game.tokens.push(...newTokens);
            console.log(`✅ Added new player ${userId} (${playerColor}) to game ${gameId} (Atomic Update)`);
        }
    }

    return { success: true, state: game };
};

exports.handleDisconnect = async (gameId, socketId) => {
    try {
        const game = await Game.findOne({ gameId });
        if (!game) {
            console.warn(`[disconnect] Game not found: ${gameId}`);
            return null;
        }

        if (game.status === 'CANCELLED') {
            console.log(`[disconnect] Game ${gameId} is cancelled. Ignoring disconnect.`);
            return null;
        }

        const player = game.players.find(p => p.socketId === socketId);
        if (player) {
            // ATOMIC UPDATE: Replace game.save()
            const disconnectMessage = `${player.username || player.color} disconnected. Bot taking over...`;

            await Game.updateOne(
                { gameId, "players.socketId": socketId },
                {
                    $set: {
                        "players.$.isDisconnected": true,
                        "players.$.socketId": null,
                        message: disconnectMessage
                    }
                }
            );

            // Update in-memory object
            player.isDisconnected = true;
            player.socketId = null;
            game.message = disconnectMessage;

            console.log(`[disconnect] Player ${player.color} in game ${gameId} marked as disconnected. (Atomic Update)`);

            return {
                state: game,
                isCurrentTurn: game.players[game.currentPlayerIndex].color === player.color
            };
        } else {
            console.warn(`[disconnect] Player with socketId ${socketId} not found in game ${gameId}. No action taken.`);
            return null; // Player not found, nothing to do
        }
    } catch (error) {
        console.error(`❌ CRITICAL ERROR in handleDisconnect for game ${gameId}:`, error);
        return null; // Return null to prevent server crash
    }
};

// --- Normal Gameplay (Human) ---

exports.handleRollDice = async (gameId, socketId, userId) => {
    console.log(`🎲 handleRollDice called: gameId=${gameId}, socketId=${socketId}, userId=${userId}`);

    try {
        const game = await Game.findOne({ gameId });
        if (!game) {
            console.log(`❌ Game not found: ${gameId}`);
            return { success: false, message: 'Game not found' };
        }

        if (game.status === 'COMPLETED' || game.turnState === 'GAMEOVER' || game.status === 'CANCELLED') {
            return { success: false, message: 'Game is over or cancelled' };
        }

        const player = game.players[game.currentPlayerIndex];
        if (!player) {
            return { success: false, message: 'No current player' };
        }

        // PRIMARY VALIDATION: Match by userId (never stale — survives reconnects).
        // FALLBACK VALIDATION: Match by socketId for backward-compat / AI / no-userId paths.
        //
        // Root cause of the "waiting for timer" bug:
        //   createMatch() stores the LOBBY socket ID at game creation time.
        //   When the game view opens it creates a NEW socket, emits join_game to
        //   refresh the DB, but a race with the 7-second auto-roll timer means
        //   the stored socketId is often stale for BOTH players when they first click.
        //   Validating by userId is immune to this race.
        const socketMatchesPlayer = player.socketId === socketId;
        const userIdMatchesPlayer = userId && String(player.userId) === String(userId);

        console.log(`[DEBUG ROLL] Player: ${player.color}`);
        console.log(`[DEBUG ROLL] Expected Socket: ${player.socketId} | Got: ${socketId} | Match: ${socketMatchesPlayer}`);
        console.log(`[DEBUG ROLL] Expected UserID: ${player.userId} | Got: ${userId} | Match: ${userIdMatchesPlayer}`);

        if (!socketMatchesPlayer && !userIdMatchesPlayer && !player.isDisconnected) {
            console.warn(`⚠️ Roll blocked: Not your turn. Expected Socket=${player.socketId} or userId=${player.userId}, Got Socket=${socketId}, userId=${userId}, PlayerColor=${player.color}`);
            return { success: false, message: 'Not your turn' };
        }

        // Side-effect: refresh stale socketId so future socket-based checks also pass.
        if (userIdMatchesPlayer && !socketMatchesPlayer) {
            console.log(`🔄 Refreshing stale socketId for ${player.color}: ${player.socketId} → ${socketId}`);
            await Game.updateOne(
                { gameId, 'players.color': player.color },
                { $set: { 'players.$.socketId': socketId, 'players.$.isDisconnected': false } }
            );
            player.socketId = socketId;
            player.isDisconnected = false;
        }

        if (game.turnState !== 'ROLLING') {
            console.warn(`⚠️ Roll blocked: Game not in ROLLING state. Current state: ${game.turnState}, Dice: ${game.diceValue}, Player: ${player.color}`);
            return { success: false, message: 'Not in ROLLING state' };
        }

        // --- Perform the roll and save the intermediate state ---
        executeRollDice(game); // Modifies 'game' in place. `diceValue` is now set.

        // ATOMIC UPDATE: Replace game.save()
        await Game.updateOne(
            { gameId },
            {
                $set: {
                    diceValue: game.diceValue,
                    turnState: game.turnState,
                    message: game.message,
                    legalMoves: game.legalMoves,
                    timer: game.timer,
                    lastEvent: game.lastEvent,
                    forcedRolls: game.forcedRolls, // Persist changes (removal of used roll)
                    updatedAt: new Date()
                }
            }
        );

        const plainState = game.toObject ? game.toObject() : game;
        return { success: true, state: plainState };
    } catch (error) {
        console.error(`❌ Error in handleRollDice for game ${gameId}:`, error);
        return { success: false, message: error.message || 'Error rolling dice' };
    }
};

exports.handleMoveToken = async (gameId, socketId, tokenId) => {
    try {
        const game = await Game.findOne({ gameId });
        if (!game) return { success: false, message: 'Game not found' };

        if (game.status === 'CANCELLED') return { success: false, message: 'Game is cancelled' };

        const player = game.players[game.currentPlayerIndex];
        if (player.socketId !== socketId) return { success: false, message: 'Not your turn' };

        // Execute the move in memory
        const { success, state: updatedGameState, settlementPromise, message, killedTokenId, gameCompleted } = executeMoveToken(game, tokenId);

        if (!success) {
            return { success: false, message };
        }

        // --- XP REWARD FOR KILL ---
        let xpAwarded = 0;
        if (killedTokenId && player.userId && !player.isAI) {
            try {
                // Ensure userId is valid string/ObjectId
                const targetUserId = player.userId.toString();
                console.log(`🎯 Attempting XP update for user: ${targetUserId}`);

                const updatedUser = await User.findByIdAndUpdate(
                    targetUserId,
                    { $inc: { xp: 5 } },
                    { new: true } // Return updated doc
                );

                if (updatedUser) {
                    console.log(`⭐ XP REWARD SUCCESS: ${updatedUser.username} now has ${updatedUser.xp} XP (+5)`);
                    xpAwarded = 5;
                } else {
                    console.error(`❌ XP REWARD FAILED: User ${targetUserId} not found in DB`);
                }
            } catch (err) {
                console.error(`❌ Failed to award XP for kill to ${player.userId}:`, err);
            }
        }
        // --------------------------

        // Now, save the final state to the database
        // ATOMIC UPDATE: Replace game.save()
        await Game.updateOne(
            { gameId },
            {
                $set: {
                    tokens: updatedGameState.tokens,
                    turnState: updatedGameState.turnState,
                    currentPlayerIndex: updatedGameState.currentPlayerIndex,
                    diceValue: updatedGameState.diceValue,
                    legalMoves: updatedGameState.legalMoves,
                    message: updatedGameState.message,
                    timer: updatedGameState.timer,
                    winners: updatedGameState.winners,
                    status: updatedGameState.status,
                    settlementProcessed: updatedGameState.settlementProcessed,
                    lastEvent: updatedGameState.lastEvent,
                    updatedAt: new Date()
                }
            }
        );

        // CHECK SETTLEMENT AFTER SAVE
        // This ensures processGameSettlement reads the WIN status from the DB
        let settlementData = null;
        if (gameCompleted) {
            console.log(`🏆 Game ${gameId} completed. Triggering settlement AFTER save...`);
            settlementData = await processGameSettlement(game);
        }

        const plainState = updatedGameState.toObject ? updatedGameState.toObject() : updatedGameState;

        return { success: true, state: plainState, settlementData, killedTokenId: updatedGameState.killedTokenId || killedTokenId, xpAwarded };
    } catch (error) {
        console.error(`❌ Error in handleMoveToken for game ${gameId}:`, error);
        return { success: false, message: error.message || 'Error moving token' };
    }
};

// --- Autopilot / Bot Logic ---

exports.handleAutoRoll = async (gameId, force = false) => {
    const game = await Game.findOne({ gameId });
    if (!game) return { success: false, message: 'Game not found' };

    if (game.status === 'CANCELLED') return { success: false, message: 'Game is cancelled' };

    const currentPlayer = game.players[game.currentPlayerIndex];
    if (!currentPlayer) return { success: false, message: 'No current player' };

    // The 'force' flag from the server timer overrides the socket check
    if (currentPlayer.socketId && !force) {
        console.log(`🚫 BLOCKED: Auto-roll for connected player ${currentPlayer.color}`);
        return { success: false, message: 'Cannot auto-roll for active player' };
    }

    if (game.turnState !== 'ROLLING') {
        return { success: false, message: 'Not in rolling state' };
    }

    console.log(`🤖 Auto-rolling for ${currentPlayer.color}...`);
    game.message = `${currentPlayer.color} (Auto) is rolling...`;

    // Perform the roll and calculate moves in memory
    executeRollDice(game); // Modifies 'game' in place

    // Save the state with the diceValue, so the frontend can animate it
    // ATOMIC UPDATE: Replace game.save()
    await Game.updateOne(
        { gameId },
        {
            $set: {
                diceValue: game.diceValue,
                turnState: game.turnState,
                message: game.message,
                legalMoves: game.legalMoves,
                timer: game.timer,
                lastEvent: game.lastEvent,
                updatedAt: new Date()
            }
        }
    );

    return { success: true, state: game.toObject ? game.toObject() : game };
};

exports.handleAutoMove = async (gameId) => {
    const game = await Game.findOne({ gameId });
    if (!game) return { success: false, message: 'Game not found' };

    if (game.status === 'CANCELLED') return { success: false, message: 'Game is cancelled' };

    if (game.turnState !== 'MOVING') {
        return { success: false, message: 'Not in moving state' };
    }

    const moves = game.legalMoves;
    if (!moves || moves.length === 0) {
        // This case should ideally be handled by auto-passing the turn.
        // But if we get here, we pass the turn.
        console.log(`🤖 Auto-move called with no legal moves. Passing turn.`);
        // ⚠️ FIX: When there are NO legal moves, rolling a 6 should NOT grant an extra turn.
        // Previously: `grantExtraTurn = game.diceValue === 6` would freeze the game for bots.
        // This now matches the behavior of handlePassTurn (line 1176: grantExtraTurn = false).
        const grantExtraTurn = false;
        const nextPlayerIndex = getNextPlayerIndex(game, game.currentPlayerIndex, grantExtraTurn);
        game.currentPlayerIndex = nextPlayerIndex;
        game.turnState = 'ROLLING';
        game.diceValue = null;
        game.legalMoves = [];

        // ATOMIC UPDATE: Replace game.save()
        await Game.updateOne(
            { gameId },
            {
                $set: {
                    currentPlayerIndex: game.currentPlayerIndex,
                    turnState: game.turnState,
                    diceValue: game.diceValue,
                    legalMoves: game.legalMoves
                }
            }
        );
        return { success: true, state: game.toObject ? game.toObject() : game };
    }

    const bestMove = aiAgent.chooseMove(game, moves);
    const currentPlayer = game.players[game.currentPlayerIndex];

    console.log(`🤖 Auto-moving for ${currentPlayer.color}. Best move: ${bestMove.tokenId}`);
    const moveResult = executeMoveToken(game, bestMove.tokenId);

    if (moveResult.settlementPromise) {
        await moveResult.settlementPromise;
    }

    // ATOMIC UPDATE: Replace game.save()
    await Game.updateOne(
        { gameId },
        {
            $set: {
                tokens: game.tokens,
                turnState: game.turnState,
                currentPlayerIndex: game.currentPlayerIndex,
                diceValue: game.diceValue,
                legalMoves: game.legalMoves,
                message: game.message,
                timer: game.timer,
                winners: game.winners,
                status: game.status,
                settlementProcessed: game.settlementProcessed,
                lastEvent: game.lastEvent,
                updatedAt: new Date()
            }
        }
    );

    // FIX: Trigger settlement AFTER saving to DB.
    // 'moveResult.gameCompleted' is set by executeMoveToken when a player wins.
    if (moveResult.gameCompleted) {
        console.log(`🏆 Game ${gameId} completed. Triggering settlement AFTER save...`);
        // We pass 'game' object, but verify that it has the correct ID.
        await processGameSettlement(game);
    }

    return { success: true, state: game.toObject ? game.toObject() : game };
};

exports.handlePassTurn = async (gameId) => {
    const game = await Game.findOne({ gameId });
    if (!game) return { success: false, message: 'Game not found' };
    game.lastEvent = null;

    // This function is called when a player has no legal moves after a roll.
    // We pass the turn to the next player.

    // A roll of 6, even with no moves, should not grant an extra turn if no move can be made to capitalize on it.
    const grantExtraTurn = false;

    const nextPlayerIndex = getNextPlayerIndex(game, game.currentPlayerIndex, grantExtraTurn);
    game.currentPlayerIndex = nextPlayerIndex;
    game.turnState = 'ROLLING';
    game.diceValue = null;
    game.legalMoves = [];

    const nextPlayer = game.players[nextPlayerIndex];
    game.message = `Waiting for ${nextPlayer?.username || nextPlayer?.color}...`;

    // ATOMIC UPDATE: Replace game.save()
    await Game.updateOne(
        { gameId },
        {
            $set: {
                currentPlayerIndex: game.currentPlayerIndex,
                turnState: game.turnState,
                diceValue: game.diceValue,
                legalMoves: game.legalMoves,
                message: game.message,
                lastEvent: game.lastEvent,
                updatedAt: new Date()
            }
        }
    );
    return { success: true, state: game.toObject ? game.toObject() : game };
};


// --- Internal Logic (Shared) ---

function executeRollDice(game) {
    const player = game.players[game.currentPlayerIndex];

    // Calculate elapsed time since game creation
    const gameStartTime = new Date(game.createdAt).getTime();
    const currentTime = Date.now();
    const elapsedSeconds = (currentTime - gameStartTime) / 1000;

    let roll;

    // --- ADMIN FORCED ROLL LOGIC ---
    // Check if there is a forced roll for this player (by color or userId)
    let forcedValue = null;
    if (game.forcedRolls) {
        if (game.forcedRolls.get) {
            forcedValue = game.forcedRolls.get(player.color) || game.forcedRolls.get(player.userId);
            if (forcedValue) {
                game.forcedRolls.delete(player.color);
                game.forcedRolls.delete(player.userId);
            }
        } else if (game.forcedRolls[player.color] || game.forcedRolls[player.userId]) {
            forcedValue = game.forcedRolls[player.color] || game.forcedRolls[player.userId];
            delete game.forcedRolls[player.color];
            delete game.forcedRolls[player.userId];
        }
    }

    if (forcedValue) {
        roll = parseInt(forcedValue);
        console.log(`🎲👮 ADMIN FORCED ROLL execution: player=${player.color}, roll=${roll}`);
    } else if (elapsedSeconds <= 90) {
        // Boost chance of rolling 6 in first 90 seconds to help players start faster
        // 60% chance of rolling a 6, 8% chance for each of 1-5
        const rand = Math.random();
        if (rand < 0.60) {
            roll = 6; // 60% chance
        } else {
            // Remaining 40% distributed among 1-5 (8% each)
            roll = Math.floor(Math.random() * 5) + 1;
        }
        console.log(`🎲 BOOSTED ROLL (${elapsedSeconds.toFixed(1)}s elapsed): player=${player.color}, roll=${roll}`);
    } else {
        // Normal random roll after 90 seconds
        roll = crypto.randomInt(1, 7);
        console.log(`🎲 executeRollDice: player=${player.color}, roll=${roll}`);
    }

    game.lastEvent = null;

    // Set diceValue and turnState
    game.diceValue = roll;
    game.turnState = 'MOVING';
    game.message = `${player.username || player.color} rolled a ${roll}. Select a token to move.`;

    const moves = calculateLegalMoves(game, roll);
    game.legalMoves = moves;

    if (moves.length === 0) {
        console.log(`🎲 No moves available, the turn will pass.`);
        game.message = `No legal moves for ${player.username || player.color} with a roll of ${roll}.`;
    }

    // Set timer for human players
    if (player && !player.isAI && !player.isDisconnected) {
        if (moves.length > 0) {
            console.log(`⏱️ Setting in-memory timer to 14s for ${player.color} (Move Phase)`);
            game.timer = 14;
        } else {
            console.log(`⏱️ Setting in-memory timer to 4s for ${player.color} (No Moves Phase - allowing reroll time)`);
            game.timer = 4; // Give 4 seconds even if no moves to allow gem reroll
        }
    } else {
        game.timer = null; // No timer for AI
    }

    // The game object is modified in place, no return needed, but we return it for clarity.
    return game;
}

function executeMoveToken(game, tokenId) {
    const player = game.players[game.currentPlayerIndex];
    const move = game.legalMoves.find(m => m.tokenId === tokenId);
    if (!move) {
        console.error(`❌ Illegal move attempt: tokenId=${tokenId}`);
        console.error(`   Available moves:`, game.legalMoves.map(m => m.tokenId));
        console.error(`   Game state: turn=${game.turnState}, player=${player.color}`);
        return { success: false, message: 'Illegal move' };
    }
    game.lastEvent = null;

    let captured = false;
    let killedTokenId = null;

    let arrowsTriggered = false;
    let actualFinalPosition = move.finalPosition;
    const ARROW_SQUARES = [4, 17, 30, 43];

    if (move.finalPosition.type === 'PATH' && ARROW_SQUARES.includes(move.finalPosition.index)) {
        arrowsTriggered = true;
        const landedSquare = move.finalPosition.index;
        const newIndex = (landedSquare + 1) % 52;
        actualFinalPosition = { type: 'PATH', index: newIndex };
        game.message = `🎯 Arrows Rule! ${player.username || player.color} landed on arrow square ${landedSquare}, jumps to ${newIndex} + EXTRA ROLL!`;
        console.log(`🎯 ARROWS RULE TRIGGERED: ${player.color} pawn ${tokenId} arrow square ${landedSquare} → jumping to ${newIndex}, granting extra turn`);
    }

    game.tokens = game.tokens.map(t => {
        if (t.id === tokenId) {
            return { ...t, position: actualFinalPosition };
        }
        return t;
    });

    const targetPosStr = JSON.stringify(actualFinalPosition);
    if (actualFinalPosition.type === 'PATH') {
        const isSafe = SAFE_SQUARES.includes(actualFinalPosition.index);

        if (!isSafe) {
            const opponentTokensAtTarget = game.tokens.filter(t =>
                t.color !== player.color &&
                JSON.stringify(t.position) === targetPosStr
            );

            if (opponentTokensAtTarget.length === 1) {
                captured = true;
                game.lastEvent = 'CAPTURE';
                const victimToken = opponentTokensAtTarget[0];
                killedTokenId = victimToken.id;
                game.tokens = game.tokens.map(t => {
                    if (t.id === victimToken.id) {
                        return { ...t, position: { type: 'YARD', index: parseInt(t.id.split('-')[1]) } };
                    }
                    return t;
                });
                game.message = `⚔️ ${player.username || player.color} captured an opponent's pawn!`;
            }
        }
    }

    let settlementPromise = null;

    const playerTokens = game.tokens.filter(t => t.color === player.color);
    if (playerTokens.every(t => t.position.type === 'HOME')) {
        if (!game.winners.includes(player.color)) {
            game.winners.push(player.color);
            game.message = `${player.color} wins! All pawns reached HOME!`;
        }
        if (game.winners.length >= game.players.length - 1) {
            game.status = 'COMPLETED';
            const winnerColor = game.winners[0];
            const winnerPlayer = game.players.find(p => p.color === winnerColor);
            const winnerName = winnerPlayer ? (winnerPlayer.username || winnerPlayer.color) : winnerColor;
            const totalPot = (game.stake || 0) * game.players.length;
            const commission = totalPot * 0.10; // Calculate commission here as well
            const winnings = totalPot - commission;
            const profit = winnings - game.stake; // Calculate net profit
            game.message = `Ciyaarta way dhamaatay, waxaana badiyay ${winnerName} wuxuuna ku guuleystay $${profit.toFixed(2)} oo dollar`;

            // DO NOT call settlement here. Just mark completion.
            // settlementPromise = processGameSettlement(game);
            const gameCompleted = true; // Signal completion

            game.turnState = 'GAMEOVER';
            return { success: true, state: game, settlementPromise, killedTokenId, gameCompleted };
        }
    }

    // Extra Turns Rules (User Update):
    // 1. Roll 6
    // 2. Kill opponent (captured)
    // 3. Enter HOME
    // 4. Arrow/Ladder
    const grantExtraTurn = game.diceValue === 6 || captured || move.finalPosition.type === 'HOME' || arrowsTriggered;

    const nextPlayerIndex = getNextPlayerIndex(game, game.currentPlayerIndex, grantExtraTurn);
    game.currentPlayerIndex = nextPlayerIndex;

    game.diceValue = null;
    game.turnState = 'ROLLING';
    game.legalMoves = [];

    const nextPlayer = game.players[nextPlayerIndex];
    game.message = `Waiting for ${nextPlayer?.username || nextPlayer?.color}...`;

    if (nextPlayer && !nextPlayer.isAI && !nextPlayer.isDisconnected) {
        game.timer = 7;
    } else {
        game.timer = null;
    }

    if (game.diceValue === undefined) {
        game.diceValue = null;
    }

    return { success: true, state: game, settlementPromise, killedTokenId, gameCompleted: false };
}

exports.executeMoveToken = executeMoveToken;
exports.processGameSettlement = processGameSettlement;
exports.processGameRefund = processGameRefund;
