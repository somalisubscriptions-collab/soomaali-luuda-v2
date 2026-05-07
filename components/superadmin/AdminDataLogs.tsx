import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../services/adminAPI';

export const AdminDataLogs: React.FC<{ defaultTab?: 'audit' | 'history' | 'analytics' }> = ({ defaultTab = 'audit' }) => {
  const [activeTab, setActiveTab] = useState<'audit' | 'history' | 'analytics'>(defaultTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotalPages, setAuditTotalPages] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditUserIdFilter, setAuditUserIdFilter] = useState('');

  const [gameHistory, setGameHistory] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyTotalPages, setHistoryTotalPages] = useState(1);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyUserIdFilter, setHistoryUserIdFilter] = useState('');

  const [globalStats, setGlobalStats] = useState<any>(null);

  useEffect(() => {
    if (activeTab === 'audit') fetchAuditLogs(1);
    else {
      fetchGameHistory(1);
      if (activeTab === 'analytics') fetchMatchStats();
    }
  }, [activeTab]);

  const fetchMatchStats = async () => {
    try {
      const data = await adminAPI.getMatchStats();
      setGlobalStats(data);
    } catch (err) {
      console.error('Failed to fetch match stats:', err);
    }
  };

  const calculateAverageDuration = () => {
    if (globalStats && globalStats.totalGames > 0) {
      return globalStats.formattedAvg;
    }
    
    // Fallback to local calculation if global fails
    if (!gameHistory || gameHistory.length === 0) return '0s';
    const validGames = gameHistory.filter(g => g.durationSecs && g.durationSecs > 0);
    if (validGames.length === 0) return '0s';
    
    const totalSecs = validGames.reduce((acc, g) => acc + g.durationSecs, 0);
    const avgSecs = Math.round(totalSecs / validGames.length);
    
    const mins = Math.floor(avgSecs / 60);
    const secs = avgSecs % 60;
    return `${mins}m ${secs}s`;
  };

  const fetchAuditLogs = async (page: number) => {
    setLoading(true);
    try {
      const data = await adminAPI.getAuditLogs(page, 100, auditUserIdFilter || undefined);
      setAuditLogs(data.logs || []);
      setAuditPage(data.page || 1);
      setAuditTotalPages(data.pages || 1);
      setAuditTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchGameHistory = async (page: number) => {
    setLoading(true);
    try {
      const data = await adminAPI.getGameHistory(page, 50, historyUserIdFilter || undefined);
      setGameHistory(data.history || []);
      setHistoryPage(data.page || 1);
      setHistoryTotalPages(data.pages || 1);
      setHistoryTotal(data.total || 0);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
      {/* Internal Tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50 overflow-x-auto no-scrollbar">
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex-1 min-w-[120px] py-4 font-bold text-sm sm:text-base transition-colors ${
            activeTab === 'audit' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Audit Logs
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 min-w-[120px] py-4 font-bold text-sm sm:text-base transition-colors ${
            activeTab === 'history' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Game History
        </button>
        <button
          onClick={() => setActiveTab('analytics')}
          className={`flex-1 min-w-[140px] py-4 font-bold text-sm sm:text-base transition-colors ${
            activeTab === 'analytics' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Match Analytics
        </button>
      </div>

      <div className="p-4 sm:p-6">
        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">{error}</div>}

        {activeTab === 'audit' && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <h3 className="font-bold text-lg text-gray-800">Financial Audit Logs ({auditTotal})</h3>
              <div className="flex gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="Filter by User ID"
                  className="flex-1 sm:w-64 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={auditUserIdFilter}
                  onChange={e => setAuditUserIdFilter(e.target.value)}
                />
                <button
                  onClick={() => fetchAuditLogs(1)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Search
                </button>
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto border rounded-xl">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-4 font-bold">Time</th>
                    <th className="px-4 py-4 font-bold">User</th>
                    <th className="px-4 py-4 font-bold">Action</th>
                    <th className="px-4 py-4 font-bold text-center">Change</th>
                    <th className="px-4 py-4 font-bold">Before → After</th>
                    <th className="px-4 py-4 font-bold">Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {auditLogs.map((log, i) => (
                    <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {log.username || (log.userId ? `${log.userId.substring(0, 8)}...` : 'Unknown')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold tracking-wider uppercase ${
                          log.action.includes('WIN') || log.action.includes('DEPOSIT') || log.change > 0
                            ? 'bg-green-100 text-green-700'
                            : log.action.includes('LOSS') || log.action.includes('WITHDRAWAL')
                            ? 'bg-red-100 text-red-700'
                            : 'bg-blue-50 text-blue-700'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className={`px-4 py-3 font-bold text-center ${log.change > 0 ? 'text-green-600' : log.change < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {log.change > 0 ? '+' : ''}{log.change?.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-gray-500 whitespace-nowrap">
                        ${log.balanceBefore?.toFixed(2)} → <span className="font-bold text-gray-700">${log.balanceAfter?.toFixed(2)}</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 max-w-xs truncate" title={log.note || ''}>
                        {log.note || log.relatedId}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile/Tablet Card View */}
            <div className="lg:hidden space-y-4">
              {auditLogs.map((log, i) => (
                <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100 shadow-sm">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="font-bold text-gray-900 mb-1">
                        {log.username || (log.userId ? `${log.userId.substring(0, 12)}...` : 'Unknown')}
                      </div>
                      <div className="text-[10px] text-gray-500 uppercase tracking-tight">
                        {new Date(log.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-black text-lg ${log.change > 0 ? 'text-green-600' : log.change < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {log.change > 0 ? '+' : ''}{log.change?.toFixed(2)}
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                        log.action.includes('WIN') || log.action.includes('DEPOSIT') || log.change > 0
                          ? 'bg-green-100 text-green-700'
                          : log.action.includes('LOSS') || log.action.includes('WITHDRAWAL')
                          ? 'bg-red-100 text-red-700'
                          : 'bg-blue-50 text-blue-700'
                      }`}>
                        {log.action}
                      </span>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-200">
                    <div>
                      <div className="text-[9px] text-gray-400 uppercase font-bold">Balance Shift</div>
                      <div className="text-xs font-mono text-gray-600">
                        ${log.balanceBefore?.toFixed(2)} → <span className="font-bold text-gray-900">${log.balanceAfter?.toFixed(2)}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[9px] text-gray-400 uppercase font-bold">Context</div>
                      <div className="text-xs text-gray-600 truncate max-w-[120px] ml-auto">
                        {log.note || log.relatedId || 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {auditLogs.length === 0 && !loading && (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-gray-500">
                No audit logs found
              </div>
            )}
            
            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
                <div className="text-sm text-blue-600 font-medium">Loading records...</div>
              </div>
            )}

            <div className="flex justify-between items-center mt-6">
              <button
                disabled={auditPage <= 1}
                onClick={() => fetchAuditLogs(auditPage - 1)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <div className="px-4 py-2 bg-gray-100 rounded-lg text-xs font-bold text-gray-600">
                {auditPage} / {auditTotalPages}
              </div>
              <button
                disabled={auditPage >= auditTotalPages}
                onClick={() => fetchAuditLogs(auditPage + 1)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {(activeTab === 'history' || activeTab === 'analytics') && (
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
              <h3 className="font-bold text-lg text-gray-800">
                {activeTab === 'history' ? `Game History (${historyTotal})` : 'Match Duration Analytics'}
              </h3>
              <div className="flex gap-2 w-full sm:w-auto">
                <input
                  type="text"
                  placeholder="Filter by User ID"
                  className="flex-1 sm:w-64 px-3 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                  value={historyUserIdFilter}
                  onChange={e => setHistoryUserIdFilter(e.target.value)}
                />
                <button
                  onClick={() => fetchGameHistory(1)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors shadow-sm"
                >
                  Search
                </button>
              </div>
            </div>

            {activeTab === 'analytics' && (
              <div className="mb-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <div className="bg-blue-50 border-2 border-blue-100 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-1">Average Match Duration</p>
                      <h4 className="text-3xl font-black text-blue-900">{calculateAverageDuration()}</h4>
                    </div>
                    <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                      <span className="text-2xl">⏱️</span>
                    </div>
                  </div>
                  <p className="text-xs text-blue-600 mt-3 font-medium">
                    Based on {globalStats ? globalStats.totalGames : gameHistory.length} matches
                  </p>
                </div>
                <div className="bg-green-50 border-2 border-green-100 rounded-2xl p-6 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Total Rake Earned</p>
                      <h4 className="text-3xl font-black text-green-900">
                        ${(globalStats?.totalRake || 0).toFixed(2)}
                      </h4>
                    </div>
                    <div className="w-12 h-12 bg-green-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                      <span className="text-2xl">💰</span>
                    </div>
                  </div>
                  <p className="text-xs text-green-600 mt-3 font-medium">10% commission from all matches</p>
                </div>
              </div>
            )}

            {/* Desktop Table */}
            <div className="hidden lg:block overflow-x-auto border rounded-xl">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50 border-b">
                  <tr>
                    <th className="px-4 py-4 font-bold">Started At</th>
                    <th className="px-4 py-4 font-bold">Ended At</th>
                    <th className="px-4 py-4 font-bold">Duration</th>
                    <th className="px-4 py-4 font-bold">Game ID</th>
                    <th className="px-4 py-4 font-bold">Winner</th>
                    <th className="px-4 py-4 font-bold">Loser</th>
                    <th className="px-4 py-4 font-bold">Stake / Pot</th>
                    <th className="px-4 py-4 font-bold">Platform Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {gameHistory.map((game, i) => {
                    const durationMins = Math.floor((game.durationSecs || 0) / 60);
                    const durationSecs = (game.durationSecs || 0) % 60;
                    const durationStr = game.durationSecs ? `${durationMins}m ${durationSecs}s` : 'N/A';

                    return (
                      <tr key={i} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {game.startedAt ? new Date(game.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-gray-600 font-medium">
                          {new Date(game.endedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                        </td>
                        <td className="px-4 py-3 text-blue-600 font-bold text-xs uppercase">
                          {durationStr}
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-gray-500 uppercase">{game.gameId}</td>
                        <td className="px-4 py-3">
                          <div className="font-bold text-green-600">
                            {game.winner ? game.winner.username : (game.outcome === 'REFUNDED' ? 'Refunded' : 'N/A')}
                          </div>
                          {game.winner && <div className="text-[9px] text-gray-400 font-mono uppercase">{game.winner.userId.substring(0,8)}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-red-600 font-medium">{game.loser ? game.loser.username : 'N/A'}</div>
                          {game.loser && <div className="text-[9px] text-gray-400 font-mono uppercase">{game.loser.userId.substring(0,8)}</div>}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">
                          <span className="text-gray-400">$</span>{game.stake?.toFixed(2)} <span className="text-gray-300">/</span> <span className="text-gray-700 font-bold">${game.totalPot?.toFixed(2)}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-sm text-purple-600 font-black">
                          ${game.commission?.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile/Tablet Card View */}
            <div className="lg:hidden space-y-4">
              {gameHistory.map((game, i) => {
                const durationMins = Math.floor((game.durationSecs || 0) / 60);
                const durationSecs = (game.durationSecs || 0) % 60;
                const durationStr = game.durationSecs ? `${durationMins}m ${durationSecs}s` : 'N/A';

                return (
                  <div key={i} className="bg-gray-50 rounded-xl p-4 border border-gray-100 shadow-sm">
                    <div className="flex justify-between items-start mb-3 pb-2 border-b border-gray-200">
                      <div>
                        <div className="text-[10px] text-gray-400 uppercase font-black tracking-widest">Match ID</div>
                        <div className="font-mono text-sm font-bold text-gray-800 uppercase">{game.gameId}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-gray-400 uppercase font-black tracking-widest">Duration</div>
                        <div className="text-xs font-black text-blue-600">{durationStr}</div>
                      </div>
                    </div>

                    <div className="flex justify-between text-[10px] text-gray-400 mb-4 px-1 italic">
                      <div>Started: {game.startedAt ? new Date(game.startedAt).toLocaleTimeString() : 'N/A'}</div>
                      <div>Ended: {new Date(game.endedAt).toLocaleTimeString()}</div>
                    </div>

                    <div className="flex justify-between items-center mb-4">
                      <div className="flex flex-col items-center text-center px-2">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 mb-1">
                          <span className="text-[10px] font-bold">W</span>
                        </div>
                        <div className="text-xs font-bold text-green-700 truncate max-w-[80px]">
                          {game.winner?.username || (game.outcome === 'REFUNDED' ? 'Refunded' : 'N/A')}
                        </div>
                      </div>

                      <div className="flex flex-col items-center">
                        <div className="text-[9px] text-gray-400 uppercase font-black">VS</div>
                        <div className="h-[1px] w-12 bg-gray-200 my-1"></div>
                      </div>

                      <div className="flex flex-col items-center text-center px-2">
                        <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 mb-1">
                          <span className="text-[10px] font-bold">L</span>
                        </div>
                        <div className="text-xs font-bold text-red-700 truncate max-w-[80px]">
                          {game.loser?.username || 'N/A'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2 pt-3 border-t border-gray-200">
                      <div>
                        <div className="text-[9px] text-gray-400 uppercase font-bold">Pot (Stake)</div>
                        <div className="text-xs font-mono text-gray-700">
                          ${game.totalPot?.toFixed(2)} <span className="text-[10px] text-gray-400">(${game.stake?.toFixed(2)})</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] text-purple-400 uppercase font-bold italic">Platform Rake</div>
                        <div className="text-sm font-black text-purple-600 font-mono">
                          ${game.commission?.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {gameHistory.length === 0 && !loading && (
              <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300 text-gray-500">
                No game history found
              </div>
            )}

            {loading && (
              <div className="flex flex-col items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-2"></div>
                <div className="text-sm text-blue-600 font-medium">Loading records...</div>
              </div>
            )}

            <div className="flex justify-between items-center mt-6">
              <button
                disabled={historyPage <= 1}
                onClick={() => fetchGameHistory(historyPage - 1)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <div className="px-4 py-2 bg-gray-100 rounded-lg text-xs font-bold text-gray-600">
                {historyPage} / {historyTotalPages}
              </div>
              <button
                disabled={historyPage >= historyTotalPages}
                onClick={() => fetchGameHistory(historyPage + 1)}
                className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
