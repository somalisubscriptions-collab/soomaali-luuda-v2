import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../services/adminAPI';

export const AdminDataLogs: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'audit' | 'history'>('audit');
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

  useEffect(() => {
    if (activeTab === 'audit') fetchAuditLogs(1);
    else fetchGameHistory(1);
  }, [activeTab]);

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
      <div className="flex border-b border-gray-200 bg-gray-50">
        <button
          onClick={() => setActiveTab('audit')}
          className={`flex-1 py-4 font-bold text-sm sm:text-base transition-colors ${
            activeTab === 'audit' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Audit Logs
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`flex-1 py-4 font-bold text-sm sm:text-base transition-colors ${
            activeTab === 'history' ? 'text-blue-600 border-b-2 border-blue-600 bg-white' : 'text-gray-500 hover:text-gray-800'
          }`}
        >
          Game History
        </button>
      </div>

      <div className="p-4 sm:p-6">
        {error && <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg">{error}</div>}

        {activeTab === 'audit' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-gray-800">Financial Audit Logs ({auditTotal})</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Filter by User ID"
                  className="px-3 py-1 border rounded text-sm"
                  value={auditUserIdFilter}
                  onChange={e => setAuditUserIdFilter(e.target.value)}
                />
                <button
                  onClick={() => fetchAuditLogs(1)}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  Search
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">User</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Change</th>
                    <th className="px-4 py-3">Before → After</th>
                    <th className="px-4 py-3">Context</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {auditLogs.map((log, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{new Date(log.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2 font-mono text-xs">{log.username || 'Unknown'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                          log.action.includes('WIN') || log.action.includes('DEPOSIT') || log.change > 0
                            ? 'bg-green-100 text-green-800'
                            : log.action.includes('LOSS') || log.action.includes('WITHDRAWAL')
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}>
                          {log.action}
                        </span>
                      </td>
                      <td className={`px-4 py-2 font-bold ${log.change > 0 ? 'text-green-600' : log.change < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                        {log.change > 0 ? '+' : ''}{log.change?.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-600">
                        ${log.balanceBefore?.toFixed(2)} → ${log.balanceAfter?.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-xs text-gray-500 max-w-xs truncate" title={log.note || ''}>
                        {log.note || log.relatedId}
                      </td>
                    </tr>
                  ))}
                  {auditLogs.length === 0 && !loading && (
                    <tr><td colSpan={6} className="text-center py-4 text-gray-500">No logs found</td></tr>
                  )}
                  {loading && (
                    <tr><td colSpan={6} className="text-center py-4 text-blue-500">Loading...</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center mt-4">
              <button
                disabled={auditPage <= 1}
                onClick={() => fetchAuditLogs(auditPage - 1)}
                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">Page {auditPage} of {auditTotalPages}</span>
              <button
                disabled={auditPage >= auditTotalPages}
                onClick={() => fetchAuditLogs(auditPage + 1)}
                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-lg text-gray-800">Game History ({historyTotal})</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Filter by User ID"
                  className="px-3 py-1 border rounded text-sm"
                  value={historyUserIdFilter}
                  onChange={e => setHistoryUserIdFilter(e.target.value)}
                />
                <button
                  onClick={() => fetchGameHistory(1)}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  Search
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left whitespace-nowrap">
                <thead className="text-xs text-gray-500 uppercase bg-gray-50">
                  <tr>
                    <th className="px-4 py-3">Ended At</th>
                    <th className="px-4 py-3">Game ID</th>
                    <th className="px-4 py-3">Winner</th>
                    <th className="px-4 py-3">Loser</th>
                    <th className="px-4 py-3">Stake / Pot</th>
                    <th className="px-4 py-3">Platform Fee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {gameHistory.map((game, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{new Date(game.endedAt).toLocaleString()}</td>
                      <td className="px-4 py-2 font-mono text-xs">{game.gameId}</td>
                      <td className="px-4 py-2 text-green-600 font-bold">
                        {game.winner ? game.winner.username : (game.outcome === 'REFUNDED' ? 'Refunded' : 'N/A')}
                      </td>
                      <td className="px-4 py-2 text-red-600">
                        {game.loser ? game.loser.username : 'N/A'}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        ${game.stake?.toFixed(2)} / ${game.totalPot?.toFixed(2)}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs text-purple-600 font-bold">
                        ${game.commission?.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                  {gameHistory.length === 0 && !loading && (
                    <tr><td colSpan={6} className="text-center py-4 text-gray-500">No game history found</td></tr>
                  )}
                  {loading && (
                    <tr><td colSpan={6} className="text-center py-4 text-blue-500">Loading...</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between items-center mt-4">
              <button
                disabled={historyPage <= 1}
                onClick={() => fetchGameHistory(historyPage - 1)}
                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
              >
                Previous
              </button>
              <span className="text-sm text-gray-600">Page {historyPage} of {historyTotalPages}</span>
              <button
                disabled={historyPage >= historyTotalPages}
                onClick={() => fetchGameHistory(historyPage + 1)}
                className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50"
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
