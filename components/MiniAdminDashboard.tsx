import React, { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../lib/apiConfig';

interface ActiveGame {
    gameId: string;
    status: string;
    stake: number;
    players: Array<{ username: string; color: string }>;
    createdAt: string;
}

interface PendingRequest {
    _id: string;
    shortId?: number;
    userName: string;
    type: 'DEPOSIT' | 'WITHDRAWAL';
    amount: number;
    paymentMethod?: string;
    timestamp: string;
    details?: string;
}

interface MiniAdminDashboardProps {
    onClose: () => void;
}

const MiniAdminDashboard: React.FC<MiniAdminDashboardProps> = ({ onClose }) => {
    const [activeGames, setActiveGames] = useState<ActiveGame[]>([]);
    const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
    const [loadingGames, setLoadingGames] = useState(true);
    const [loadingRequests, setLoadingRequests] = useState(true);
    const [activeTab, setActiveTab] = useState<'games' | 'requests' | 'quick'>('games');
    const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

    // Quick Action States
    const [searchQuery, setSearchQuery] = useState('');
    const [foundUser, setFoundUser] = useState<any>(null);
    const [foundMatches, setFoundMatches] = useState<any[]>([]);
    const [actionAmount, setActionAmount] = useState('');
    const [actionLoading, setActionLoading] = useState(false);
    const [searchLoading, setSearchLoading] = useState(false);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    const getToken = () => localStorage.getItem('ludo_token') || '';

    const fetchActiveGames = useCallback(async () => {
        setLoadingGames(true);
        try {
            const res = await fetch(`${API_URL}/admin/active-games`, {
                headers: { Authorization: `Bearer ${getToken()}` }
            });
            const data = await res.json();
            if (data.success) {
                setActiveGames(data.games || []);
            }
        } catch (err) {
            console.error('Failed to fetch active games:', err);
        } finally {
            setLoadingGames(false);
        }
    }, []);

    const fetchPendingRequests = useCallback(async () => {
        setLoadingRequests(true);
        try {
            const res = await fetch(`${API_URL}/admin/financial-requests?status=PENDING&limit=50`, {
                headers: { Authorization: `Bearer ${getToken()}` }
            });
            const data = await res.json();
            if (data.success) {
                setPendingRequests(data.requests || []);
            }
        } catch (err) {
            console.error('Failed to fetch pending requests:', err);
        } finally {
            setLoadingRequests(false);
        }
    }, []);

    const refresh = useCallback(() => {
        fetchActiveGames();
        fetchPendingRequests();
        setLastRefreshed(new Date());
    }, [fetchActiveGames, fetchPendingRequests]);

    useEffect(() => {
        refresh();
        const interval = setInterval(refresh, 30_000);
        return () => clearInterval(interval);
    }, [refresh]);

    const handleSearchUser = async () => {
        if (!searchQuery) return;
        setSearchLoading(true);
        setMessage(null);
        setFoundUser(null);
        setFoundMatches([]);
        try {
            const res = await fetch(`${API_URL}/admin/quick/user/${encodeURIComponent(searchQuery)}`, {
                headers: { Authorization: `Bearer ${getToken()}` }
            });
            const data = await res.json();
            if (data.success) {
                if (data.user) setFoundUser(data.user);
                else if (data.matches) setFoundMatches(data.matches);
            } else {
                setMessage({ text: data.error || 'User not found', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Search failed', type: 'error' });
        } finally {
            setSearchLoading(false);
        }
    };

    const handleTransaction = async (type: 'DEPOSIT' | 'WITHDRAWAL') => {
        if (!foundUser || !actionAmount) return;
        const amount = parseFloat(actionAmount);
        if (isNaN(amount) || amount <= 0) {
            setMessage({ text: 'Invalid amount', type: 'error' });
            return;
        }

        setActionLoading(true);
        setMessage(null);
        try {
            const res = await fetch(`${API_URL}/admin/quick/transaction`, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getToken()}` 
                },
                body: JSON.stringify({
                    userId: foundUser.userId,
                    type,
                    amount,
                    adminId: localStorage.getItem('userId') // Optional
                })
            });
            const data = await res.json();
            if (data.success) {
                setMessage({ text: `${type} successful! New balance: $${data.newBalance.toFixed(2)}`, type: 'success' });
                setFoundUser({ ...foundUser, balance: data.newBalance });
                setActionAmount('');
            } else {
                setMessage({ text: data.error || 'Transaction failed', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Network error', type: 'error' });
        } finally {
            setActionLoading(false);
        }
    };

    const formatTime = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleTimeString('so-SO', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('so-SO', { month: 'short', day: 'numeric' }) + ' ' + formatTime(dateStr);
    };

    const playerColorClass: Record<string, string> = {
        red: 'bg-red-500',
        blue: 'bg-blue-500',
        green: 'bg-green-500',
        yellow: 'bg-yellow-500',
    };

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900 flex flex-col font-sans">
            <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-amber-600 to-orange-600 shadow-lg flex-shrink-0">
                <div className="flex items-center gap-3">
                    <span className="text-2xl">🛡️</span>
                    <div>
                        <h1 className="text-white font-black text-lg leading-none uppercase tracking-tight">Admin Dashboard</h1>
                        <p className="text-amber-100 text-[9px] uppercase tracking-widest font-black opacity-80">Management Terminal</p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={refresh} className="w-9 h-9 flex items-center justify-center bg-white/20 hover:bg-white/30 rounded-xl transition-all">🔄</button>
                    <button onClick={onClose} className="px-4 py-2 bg-white text-orange-600 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-orange-50 transition-all shadow-lg">✕ Close</button>
                </div>
            </div>

            <div className="flex border-b border-slate-700 flex-shrink-0 bg-slate-800 p-1 gap-1">
                <button onClick={() => setActiveTab('games')} className={`flex-1 py-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${activeTab === 'games' ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-700'}`}>
                    <span className="text-lg">🎲</span>
                    <span className="text-[10px] font-black uppercase tracking-wider">Active Games</span>
                </button>
                <button onClick={() => setActiveTab('requests')} className={`flex-1 py-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${activeTab === 'requests' ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-700'}`}>
                    <span className="text-lg">📋</span>
                    <span className="text-[10px] font-black uppercase tracking-wider">Requests</span>
                </button>
                <button onClick={() => setActiveTab('quick')} className={`flex-1 py-3 rounded-xl flex flex-col items-center justify-center gap-1 transition-all ${activeTab === 'quick' ? 'bg-amber-500 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-700'}`}>
                    <span className="text-lg">⚡</span>
                    <span className="text-[10px] font-black uppercase tracking-wider">Quick Actions</span>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-slate-950">
                {activeTab === 'games' && (
                    <div className="space-y-3">
                        {loadingGames ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-4"><div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" /><p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Loading Games...</p></div>
                        ) : activeGames.length === 0 ? (
                            <div className="text-center py-20"><span className="text-5xl block mb-4">😴</span><p className="text-slate-400 font-black uppercase">No active games</p></div>
                        ) : (
                            activeGames.map((game) => (
                                <div key={game.gameId} className="bg-slate-900 border border-white/5 rounded-2xl p-4 flex flex-col gap-3 shadow-xl">
                                    <div className="flex items-center justify-between">
                                        <div><p className="text-green-400 font-black text-[10px] uppercase tracking-widest flex items-center gap-1.5"><span className="w-2 h-2 bg-green-500 rounded-full animate-pulse" /> Live Now</p><p className="text-slate-500 text-[8px] font-mono mt-1">{game.gameId}</p></div>
                                        <div className="text-right"><p className="text-amber-400 font-black text-2xl tracking-tighter">${(game.stake || 0).toFixed(2)}</p><p className="text-slate-600 text-[8px] uppercase font-black">Match Stake</p></div>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {game.players?.map((p, i) => (
                                            <div key={i} className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-1.5 border border-white/5">
                                                <span className={`w-3 h-3 rounded-full ${playerColorClass[p.color] || 'bg-slate-400'}`} />
                                                <span className="text-white text-[11px] font-black uppercase tracking-tight">{p.username}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <p className="text-slate-600 text-[8px] font-bold uppercase border-t border-white/5 pt-2">Started: {formatDate(game.createdAt)}</p>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'requests' && (
                    <div className="space-y-3">
                        {loadingRequests ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-4"><div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin" /><p className="text-slate-400 text-sm font-bold uppercase tracking-widest">Loading Requests...</p></div>
                        ) : pendingRequests.length === 0 ? (
                            <div className="text-center py-20"><span className="text-5xl block mb-4">✅</span><p className="text-slate-400 font-black uppercase">All clear</p></div>
                        ) : (
                            pendingRequests.map((req) => (
                                <div key={req._id} className={`bg-slate-900 border-l-4 rounded-2xl p-4 flex flex-col gap-3 shadow-xl ${req.type === 'DEPOSIT' ? 'border-green-500' : 'border-red-500'}`}>
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${req.type === 'DEPOSIT' ? 'bg-green-500/20' : 'bg-red-500/20'}`}>{req.type === 'DEPOSIT' ? '⬇️' : '⬆️'}</div>
                                            <div><p className="text-white font-black text-sm uppercase tracking-tight">{req.userName}</p><p className={`text-[10px] font-black tracking-widest uppercase ${req.type === 'DEPOSIT' ? 'text-green-400' : 'text-red-400'}`}>{req.type}</p></div>
                                        </div>
                                        <div className="text-right"><p className={`font-black text-2xl tracking-tighter ${req.type === 'DEPOSIT' ? 'text-green-400' : 'text-red-400'}`}>${req.amount.toFixed(2)}</p>{req.shortId && <p className="text-slate-600 text-[10px] font-mono">#{req.shortId}</p>}</div>
                                    </div>
                                    <div className="flex items-center justify-between text-[10px] border-t border-white/5 pt-2">
                                        <p className="text-slate-500 font-bold uppercase">{formatDate(req.timestamp)}</p>
                                        <span className="bg-amber-500 text-white px-2 py-0.5 rounded-full font-black text-[8px] uppercase animate-pulse">Awaiting Approval</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'quick' && (
                    <div className="space-y-6">
                        <div className="space-y-3">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Search User (ID or Phone)</label>
                            <div className="flex gap-2">
                                <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSearchUser()} placeholder="E.g. 061XXXXXXX" className="flex-1 bg-slate-900 border-2 border-white/5 rounded-2xl px-5 py-4 text-white font-black text-lg focus:border-amber-500 outline-none transition-all" />
                                <button onClick={handleSearchUser} disabled={searchLoading} className="bg-amber-500 text-white px-6 rounded-2xl font-black uppercase text-xs hover:bg-amber-600 transition-all disabled:opacity-50">{searchLoading ? '...' : 'Search'}</button>
                            </div>
                        </div>

                        {message && (
                            <div className={`p-4 rounded-2xl font-black text-sm uppercase tracking-tight text-center ${message.type === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                                {message.text}
                            </div>
                        )}

                        {foundUser && (
                            <div className="bg-slate-900 border-2 border-amber-500/30 rounded-3xl p-6 space-y-6 animate-in zoom-in duration-300">
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-16 rounded-2xl bg-amber-500 flex items-center justify-center text-3xl shadow-xl">{foundUser.avatar || '👤'}</div>
                                    <div className="flex-1">
                                        <h4 className="text-white font-black text-xl uppercase tracking-tight leading-none">{foundUser.username}</h4>
                                        <p className="text-slate-500 text-xs font-black mt-2">{foundUser.phone}</p>
                                        <div className="flex items-center gap-2 mt-2">
                                            <span className="px-2 py-0.5 bg-white/5 rounded-full text-[8px] font-black text-slate-400 uppercase tracking-widest">{foundUser.userId}</span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-green-400 font-black text-3xl tracking-tighter">${foundUser.balance.toFixed(2)}</p>
                                        <p className="text-slate-600 text-[10px] font-black uppercase tracking-widest">Balance</p>
                                    </div>
                                </div>

                                <div className="space-y-4 pt-4 border-t border-white/5">
                                    <div className="space-y-2">
                                        <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest ml-1">Transaction Amount ($)</label>
                                        <input type="number" value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} placeholder="0.00" className="w-full bg-slate-950 border-2 border-white/10 rounded-2xl px-6 py-4 text-white font-black text-2xl focus:border-amber-500 outline-none transition-all" />
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <button onClick={() => handleTransaction('DEPOSIT')} disabled={actionLoading || !actionAmount} className="bg-green-600 hover:bg-green-500 text-white font-black py-4 rounded-2xl shadow-lg transition-all active:scale-95 disabled:opacity-30 uppercase tracking-widest text-xs">⬇️ Deposit</button>
                                        <button onClick={() => handleTransaction('WITHDRAWAL')} disabled={actionLoading || !actionAmount} className="bg-red-600 hover:bg-red-500 text-white font-black py-4 rounded-2xl shadow-lg transition-all active:scale-95 disabled:opacity-30 uppercase tracking-widest text-xs">⬆️ Withdraw</button>
                                    </div>
                                </div>
                            </div>
                        )}

                        {foundMatches.length > 0 && (
                            <div className="space-y-3">
                                <p className="text-slate-500 text-[10px] font-black uppercase tracking-widest ml-1">Multiple matches found:</p>
                                {foundMatches.map((m) => (
                                    <button key={m.userId} onClick={() => setFoundUser(m)} className="w-full flex items-center justify-between p-4 bg-slate-900 hover:bg-slate-800 rounded-2xl border border-white/5 transition-all group">
                                        <div className="flex items-center gap-3">
                                            <span className="text-2xl">{m.avatar || '👤'}</span>
                                            <div className="text-left"><p className="text-white font-black uppercase text-sm">{m.username}</p><p className="text-slate-500 text-[10px] font-black">{m.phone}</p></div>
                                        </div>
                                        <span className="text-amber-500 opacity-0 group-hover:opacity-100 transition-opacity">Select ➜</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default MiniAdminDashboard;
