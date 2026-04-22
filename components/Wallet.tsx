
import React, { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import type { User, FinancialRequest } from '../types';
import { API_URL } from '../lib/apiConfig';

interface WalletProps {
    user: User;
    onClose: () => void;
    onUpdateUser: () => void;
}

const SuccessMessage: React.FC = () => (
    <div className="bg-green-500/10 border-2 border-green-500/30 rounded-lg p-4 flex items-center space-x-3 animate-in fade-in slide-in-from-bottom-4 duration-500 mb-4">
        <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
        </div>
        <div>
            <h4 className="font-bold text-green-400">Request Submitted!</h4>
            <p className="text-sm text-slate-300">Your request will be processed shortly.</p>
        </div>
    </div>
);

// Generic banner used for success/info/error messages (green styling per request)
const BannerMessage: React.FC<{ message: string }> = ({ message }) => (
    <div className="bg-green-500/10 border-2 border-green-500/30 rounded-lg p-4 flex items-start space-x-3 animate-in fade-in slide-in-from-bottom-4 duration-500 mb-4">
        <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1" />
            </svg>
        </div>
        <div className="text-left">
            <p className="font-semibold text-green-400 text-sm">{message}</p>
        </div>
    </div>
);

const Wallet: React.FC<WalletProps> = ({ user, onClose, onUpdateUser }) => {
    const [amount, setAmount] = useState('');
    const [myRequests, setMyRequests] = useState<FinancialRequest[]>([]);
    const [tab, setTab] = useState<'action' | 'history'>('action');
    const [loading, setLoading] = useState(false);
    const [sifaloLoading, setSifaloLoading] = useState(false);
    const [currentUser, setCurrentUser] = useState<User | null>(null);
    const [userLoading, setUserLoading] = useState(true);
    const [showSuccessMessage, setShowSuccessMessage] = useState(false);
    const [bannerMessage, setBannerMessage] = useState<string | null>(null);
    const SOMALI_PENDING_MSG = `Waanka xunnahay Nun horey ayaad dalab u gudbisay, dalabkii hore oo aan la xaqiijinna mid kale ma gudbin kartid,  fadlan la xariir whatsapp 0610251014 si laguugu xaqiijiyo mahadsanid`;

    // Payment method state
    const PAYMENT_METHODS = ['EVC-PLUS', 'E-DAHAB', 'GOLIS', 'TELESOM'];
    const [paymentMethod, setPaymentMethod] = useState(PAYMENT_METHODS[0]);

    // Deposit-specific fields
    const [fullName, setFullName] = useState(user?.username || '');
    const [phoneNumber, setPhoneNumber] = useState(user?.phone || '');

    // Fetch current user data from API (source of truth)
    const fetchCurrentUser = async () => {
        try {
            const token = localStorage.getItem('ludo_token');
            if (!token) {
                console.warn('No auth token found');
                return;
            }

            const response = await fetch(`${API_URL}/auth/me`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (response.ok) {
                const userData = await response.json();
                setCurrentUser(userData);
                setFullName(userData.username || '');
                setPhoneNumber(userData.phone || '');
            } else {
                console.error('Failed to fetch user data');
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
        } finally {
            setUserLoading(false);
        }
    };

    useEffect(() => {
        // Fetch current user data and requests
        fetchCurrentUser();
        fetchRequests();
    }, []);

    // Fetch requests from API
    const fetchRequests = async () => {
        try {
            const token = localStorage.getItem('ludo_token');
            if (!token) {
                console.warn('No auth token found');
                return;
            }

            const response = await fetch(`${API_URL}/wallet/my-requests`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            });

            if (response.ok) {
                const data = await response.json();
                if (data.success && data.requests) {
                    setMyRequests(data.requests);
                }
            } else {
                console.error('Failed to fetch requests');
            }
        } catch (error) {
            console.error('Error fetching requests:', error);
        }
    };

    const handleRequest = async (type: 'DEPOSIT' | 'WITHDRAWAL') => {
        const val = parseFloat(amount);
        if (!val || val <= 0) return;

        if (type === 'DEPOSIT') {
            if (!fullName.trim()) {
                alert('Please enter your Full Name');
                return;
            }
            if (!phoneNumber.trim()) {
                alert('Please enter your Phone Number');
                return;
            }
        }

        setLoading(true);
        try {
            const token = localStorage.getItem('ludo_token');
            if (!token) {
                alert('Please login to make a request');
                return;
            }

            const response = await fetch(`${API_URL}/wallet/request`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    userId: currentUser?.id || user.id,
                    userName: currentUser?.username || user.username, // Pass username for auto-sync
                    type,
                    amount: val,
                    paymentMethod,
                    details: type === 'DEPOSIT'
                        ? `Name: ${fullName}, Phone: ${phoneNumber}, Method: ${paymentMethod} (Web Request)`
                        : `Method: ${paymentMethod} (Manual Withdrawal Request via Web Wallet)`
                })
            });

            const data = await response.json();
            if (data.success) {
                setShowSuccessMessage(true);
                setTimeout(() => setShowSuccessMessage(false), 4000);
                setAmount('');
                // Refresh requests list
                const refreshResponse = await fetch(`${API_URL}/wallet/my-requests`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });
                if (refreshResponse.ok) {
                    const refreshData = await refreshResponse.json();
                    if (refreshData.success && refreshData.requests) {
                        setMyRequests(refreshData.requests);
                    }
                }
                // Refresh user data and requests
                await fetchCurrentUser();
                await fetchRequests();
            } else {
                // show the requested Somali message in the animated green banner instead of alert
                setBannerMessage(SOMALI_PENDING_MSG);
                // auto-hide after 30s
                setTimeout(() => setBannerMessage(null), 30000);
            }
        } catch (e) {
            setBannerMessage('Network error. Is the backend server running?');
            setTimeout(() => setBannerMessage(null), 30000);
        } finally {
            setLoading(false);
        }
    };

    // ── SIFALO PAY INSTANT DEPOSIT ──────────────────────────────────────────
    const handleSifaloDeposit = async () => {
        const val = parseFloat(amount);
        if (!val || val <= 0) {
            setBannerMessage('Fadlan geli xaddiga lacagta aad dhigi doonto');
            setTimeout(() => setBannerMessage(null), 5000);
            return;
        }
        if (val > 300) {
            setBannerMessage('Maximum lacag-dhigasho: $300');
            setTimeout(() => setBannerMessage(null), 5000);
            return;
        }

        setSifaloLoading(true);
        try {
            const token = localStorage.getItem('ludo_token');
            if (!token) return;

            const res = await fetch(`${API_URL}/wallet/sifalo-checkout`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    amount: val,
                    userId: currentUser?.id || user.id,
                }),
            });

            const data = await res.json();
            if (data.success && data.checkoutUrl) {
                // Redirect to Sifalo Pay hosted checkout
                window.location.href = data.checkoutUrl;
            } else {
                setBannerMessage(data.error || 'Failed to start payment. Try again.');
                setTimeout(() => setBannerMessage(null), 8000);
            }
        } catch (e) {
            setBannerMessage('Network error. Is the backend running?');
            setTimeout(() => setBannerMessage(null), 8000);
        } finally {
            setSifaloLoading(false);
        }
    };
    // ────────────────────────────────────────────────────────────────────────

    return (
        <div className="fixed inset-0 bg-black/80 flex items-start sm:items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto">
            <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700 overflow-hidden flex flex-col my-auto">
                <div className="bg-slate-900 py-3 px-4 sm:px-6 flex justify-between items-center border-b border-slate-700 shrink-0">
                    <h3 className="text-base sm:text-xl font-bold text-white">My Wallet</h3>
                    <button
                        onClick={onClose}
                        className="flex items-center justify-center w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 text-white transition-all shadow-lg"
                        title="Close"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 text-center bg-gradient-to-br from-slate-800 to-slate-900">
                    <p className="text-slate-400 text-sm font-bold uppercase tracking-wider mb-1">Current Balance</p>
                    {userLoading ? (
                        <div className="flex items-center justify-center mt-2">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400"></div>
                        </div>
                    ) : (
                        <p className="text-4xl font-black text-white">${(currentUser?.balance || 0).toFixed(2)}</p>
                    )}
                </div>

                <div className="flex border-b border-slate-700 shrink-0">
                    <button
                        onClick={() => setTab('action')}
                        className={`flex-1 py-3 font-bold text-sm transition-colors ${tab === 'action' ? 'bg-slate-700 text-cyan-400' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                    >
                        Actions
                    </button>
                    <button
                        onClick={() => setTab('history')}
                        className={`flex-1 py-3 font-bold text-sm transition-colors ${tab === 'history' ? 'bg-slate-700 text-cyan-400' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
                    >
                        History
                    </button>
                </div>

                <div className="p-4 sm:p-6 overflow-y-auto max-h-[70vh] sm:max-h-auto scrollbar-thin scrollbar-thumb-slate-700">
                    {bannerMessage && <BannerMessage message={bannerMessage} />}
                    {showSuccessMessage && <SuccessMessage />}
                    {tab === 'action' ? (
                        <div className="space-y-6">
                            <div className="bg-slate-900/50 p-4 rounded-lg border border-slate-700/50 mb-4">
                                <p className="text-xs text-amber-400 mb-2 font-semibold">⚠️ Security Check</p>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-slate-400 text-[10px] font-bold uppercase mb-1">Full Name</label>
                                        <input
                                            type="text"
                                            value={fullName}
                                            onChange={(e) => setFullName(e.target.value)}
                                            placeholder="Verify Full Name"
                                            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:ring-1 focus:ring-cyan-500 outline-none"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-slate-400 text-[10px] font-bold uppercase mb-1">Phone Number</label>
                                        <input
                                            type="tel"
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            placeholder="Verify Phone Number"
                                            className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-white text-sm focus:ring-1 focus:ring-cyan-500 outline-none"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div>
                                <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Payment Method</label>
                                <select
                                    value={paymentMethod}
                                    onChange={(e) => setPaymentMethod(e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-4 text-white text-l font-bold focus:ring-2 focus:ring-cyan-500 outline-none"
                                >
                                    {['EVC-PLUS', 'E-DAHAB', 'GOLIS', 'TELESOM'].map(method => (
                                        <option key={method} value={method}>{method}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-slate-400 text-xs font-bold uppercase mb-2">Amount ($)</label>
                                <input
                                    type="number"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    placeholder="Enter amount..."
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-4 text-white text-xl font-bold focus:ring-2 focus:ring-cyan-500 outline-none"
                                />
                                <p className="text-[10px] text-slate-500 mt-1 text-right">Min: $0.01 | Max Lacag-Dhigasho: $300</p>
                            </div>

                            {/* ── SIFALO PAY INSTANT DEPOSIT ── */}
                            <button
                                onClick={handleSifaloDeposit}
                                disabled={sifaloLoading || !amount || parseFloat(amount) <= 0}
                                className="w-full relative overflow-hidden bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 text-white font-bold py-4 rounded-xl transition-all transform active:scale-95 disabled:opacity-50 shadow-lg shadow-emerald-900/30 flex items-center justify-center gap-2 text-base"
                            >
                                {sifaloLoading ? (
                                    <>
                                        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                        <span>Xidhinaya Sifalo Pay...</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="text-xl">⚡</span>
                                        <span>Dhig Lacag — Sifalo Pay</span>
                                        <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full ml-1">AUTO</span>
                                    </>
                                )}
                            </button>
                            <p className="text-[10px] text-emerald-400/70 text-center -mt-3">
                                EVC · eDahab · ZAAD · SAHAL — Lacagta isla markiiba ku soo gashaa
                            </p>

                            {/* Divider */}
                            <div className="flex items-center gap-3 my-1">
                                <div className="flex-1 h-px bg-slate-700" />
                                <span className="text-[10px] text-slate-500 uppercase">ama codsii manually</span>
                                <div className="flex-1 h-px bg-slate-700" />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <button
                                    onClick={() => handleRequest('DEPOSIT')}
                                    disabled={loading}
                                    className="bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-lg transition-transform transform active:scale-95 disabled:opacity-50 shadow-lg"
                                >
                                    {loading ? '...' : '📋 Codso Deposit'}
                                </button>
                                <button
                                    onClick={() => handleRequest('WITHDRAWAL')}
                                    disabled={loading}
                                    className="bg-red-600 hover:bg-red-500 text-white font-bold py-3 rounded-lg transition-transform transform active:scale-95 disabled:opacity-50 shadow-lg shadow-red-900/20"
                                >
                                    {loading ? '...' : 'Lacag-Labixid'}
                                </button>
                            </div>
                            <div className="text-xs text-slate-500 text-center leading-relaxed border-t border-slate-700 pt-4">
                                <p>Submit a request to Lacag-Dhigasho ama Lacag-Labixid.</p>
                                <p>Admin will review and approve shortly.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4 overflow-y-auto max-h-[350px] custom-scrollbar pr-2">
                            {loading ? (
                                <div className="text-center py-12">
                                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-400 mb-3"></div>
                                    <p className="text-slate-400 text-sm">Loading requests...</p>
                                </div>
                            ) : myRequests.length === 0 ? (
                                <div className="text-center py-12">
                                    <div className="text-4xl mb-3">📭</div>
                                    <p className="text-slate-400 text-sm mb-1">No requests found</p>
                                    <p className="text-slate-500 text-xs">Submit a Lacag-Dhigasho ama Lacag-Labixid request to see it here</p>
                                </div>
                            ) : (
                                myRequests.map(req => {
                                    const isDeposit = req.type === 'DEPOSIT';
                                    const statusColors = {
                                        'APPROVED': { bg: 'bg-green-500/10', text: 'text-green-400', border: 'border-green-500/30', icon: '✓' },
                                        'REJECTED': { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/30', icon: '✗' },
                                        'PENDING': { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/30', icon: '⏳' }
                                    };
                                    const statusStyle = statusColors[req.status as keyof typeof statusColors] || statusColors.PENDING;

                                    return (
                                        <div
                                            key={req.id || req._id}
                                            className={`relative overflow-hidden rounded-xl border-2 ${statusStyle.border} ${statusStyle.bg} p-4 transition-all duration-200 hover:shadow-lg hover:scale-[1.02]`}
                                        >
                                            {/* Background gradient effect */}
                                            <div className={`absolute top-0 right-0 w-20 h-20 rounded-full blur-2xl opacity-20 ${isDeposit ? 'bg-green-500' : 'bg-red-500'
                                                }`}></div>

                                            <div className="relative z-10">
                                                <div className="flex items-start justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                        <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${isDeposit
                                                            ? 'bg-green-500/20 text-green-400'
                                                            : 'bg-red-500/20 text-red-400'
                                                            }`}>
                                                            <span className="text-2xl">
                                                                {isDeposit ? '💰' : '💸'}
                                                            </span>
                                                        </div>
                                                        <div>
                                                            <p className={`text-sm font-bold uppercase tracking-wider ${isDeposit ? 'text-green-400' : 'text-red-400'
                                                                }`}>
                                                                {isDeposit ? 'Lacag-Dhigasho' : 'Lacag-Labixid'}
                                                            </p>
                                                            <p className="text-xs text-slate-400 mt-0.5">
                                                                {new Date(req.timestamp).toLocaleDateString('en-US', {
                                                                    month: 'short',
                                                                    day: 'numeric',
                                                                    year: 'numeric'
                                                                })}
                                                            </p>
                                                        </div>
                                                    </div>

                                                    <div className="text-right">
                                                        <p className="text-2xl font-black text-white mb-1">
                                                            ${req.amount.toFixed(2)}
                                                        </p>
                                                        <span className={`inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-bold uppercase ${statusStyle.text} ${statusStyle.bg} border ${statusStyle.border}`}>
                                                            <span>{statusStyle.icon}</span>
                                                            {req.status}
                                                        </span>
                                                    </div>
                                                </div>

                                                {req.adminComment && (
                                                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                                                        <p className="text-xs text-slate-400 flex items-start gap-2">
                                                            <span className="text-cyan-400 mt-0.5">💬</span>
                                                            <span className="italic">{req.adminComment}</span>
                                                        </p>
                                                    </div>
                                                )}

                                                {req.details && !req.adminComment && (
                                                    <div className="mt-3 pt-3 border-t border-slate-700/50">
                                                        <p className="text-xs text-slate-500 truncate" title={req.details}>
                                                            {req.details}
                                                        </p>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Wallet;
