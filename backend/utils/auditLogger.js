/**
 * Shared helpers for recording GameHistory and AuditLog entries.
 * Import this wherever balances change or games end.
 */

const AuditLog  = require('../models/AuditLog');
const GameHistory = require('../models/GameHistory');

/**
 * Record a balance change in the AuditLog.
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.username
 * @param {string} opts.action       - One of the AuditLog action enums
 * @param {number} opts.balanceBefore
 * @param {number} opts.balanceAfter
 * @param {string} [opts.relatedId]  - gameId / orderId / etc.
 * @param {string} [opts.triggeredBy]
 * @param {string} [opts.note]
 */
const logAudit = async (opts) => {
  try {
    await AuditLog.create({
      userId:        String(opts.userId),
      username:      opts.username || 'Unknown',
      action:        opts.action,
      balanceBefore: opts.balanceBefore,
      balanceAfter:  opts.balanceAfter,
      change:        parseFloat((opts.balanceAfter - opts.balanceBefore).toFixed(4)),
      relatedId:     opts.relatedId  || null,
      triggeredBy:   opts.triggeredBy || 'System',
      note:          opts.note || null,
    });
  } catch (err) {
    // Never crash the main flow because of an audit log failure
    console.error('[AuditLog] Failed to write audit log:', err.message);
  }
};

/**
 * Record a completed game in GameHistory.
 * Call this inside processGameSettlement after balance updates.
 * @param {object} opts
 * @param {object} opts.game         - Mongoose Game document
 * @param {object} opts.winner       - User document
 * @param {object} opts.loser        - User document (null if cancelled/refund)
 * @param {number} opts.stake
 * @param {number} opts.winnerPaid
 * @param {number} opts.commission
 * @param {number} [opts.gemRevenue]
 * @param {string} [opts.outcome]    - 'WIN' | 'CANCELLED' | 'REFUNDED'
 */
const logGameHistory = async (opts) => {
  try {
    const game = opts.game;
    const startedAt = game.createdAt || null;
    const endedAt   = new Date();
    const durationSecs = startedAt
      ? Math.round((endedAt - new Date(startedAt)) / 1000)
      : null;

    await GameHistory.create({
      gameId:   game.gameId,
      gameType: 'LUDO',
      winner: opts.winner ? {
        userId:   String(opts.winner._id),
        username: opts.winner.username,
        color:    game.winners?.[0] || null,
      } : null,
      loser: opts.loser ? {
        userId:   String(opts.loser._id),
        username: opts.loser.username,
        color:    game.players?.find(p => p.userId === String(opts.loser._id))?.color || null,
      } : null,
      players: game.players.map((p, i) => ({
        userId:    p.userId,
        username:  p.username,
        color:     p.color,
        isAI:      p.isAI || false,
        finalRank: game.winners?.includes(p.color) ? 1 : 2,
      })),
      stake:        opts.stake        || 0,
      totalPot:     (opts.stake || 0) * 2,
      winnerPaid:   opts.winnerPaid   || 0,
      commission:   opts.commission   || 0,
      gemRevenue:   opts.gemRevenue   || 0,
      startedAt,
      endedAt,
      durationSecs,
      outcome:      opts.outcome      || 'WIN',
    });
  } catch (err) {
    // Never crash the main flow because of a history log failure
    console.error('[GameHistory] Failed to write game history:', err.message);
  }
};

module.exports = { logAudit, logGameHistory };
