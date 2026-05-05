
import React, { useState, useEffect } from 'react';
import { X, Wallet as WalletIcon, History, Zap, Shield, HelpCircle, ArrowRight, MessageCircle } from 'lucide-react';
import type { User, FinancialRequest } from '../types';
import { API_URL } from '../lib/apiConfig';

interface WalletProps {
    user: User;
    onClose: () => void;
    onUpdateUser: () => void;
}

const SuccessMessage: React.FC = () => (
    <div className="bg-fuchsia-600/20 border-2 border-fuchsia-500 rounded-2xl p-4 flex items-center space-x-3 animate-in zoom-in duration-300 mb-4 shadow-[0_0_20px_rgba(219,39,119,0.2)]">
        <div className="w-10 h-10 rounded-xl bg-fuchsia-500 flex items-center justify-center flex-shrink-0 shadow-lg shadow-fuchsia-500/40">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
        </div>
        <div>
            <h4 className="font-black text-white text-lg uppercase tracking-tight">Waa lagu guuleystay!</h4>
            <p className="text-xs text-fuchsia-200 font-bold opacity-80">Codsigaaga waa la helay.</p>
        </div>
    </div>
);

const BannerMessage: React.FC<{ message: string }> = ({ message }) => (
    <div className="bg-amber-500/20 border-2 border-amber-500 rounded-2xl p-4 flex items-start space-x-3 animate-in slide-in-from-top-4 duration-300 mb-4 shadow-[0_0_20px_rgba(245,158,11,0.1)]">
        <div className="w-10 h-10 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Shield className="w-6 h-6 text-white" />
        </div>
        <div className="text-left">
            <p className="font-black text-amber-100 text-xs leading-tight uppercase tracking-tight">{message}</p>
        </div>
    </div>
);

const Wallet: React.FC<WalletProps> = ({ user, onClose, onUpdateUser }) => {
    const [amount, setAmount] = useState('');
    const [myRequests, setMyRequests] = useState<FinancialRequest[]>([]);
    const [tab, setTab] = useState<'action' | 'history'>('action');
    const [sifaloLoading, setSifaloLoading] = useState(false);
    const [currentUser, setCurrentUser] = useState<any>(null);
    const [userLoading, setUserLoading] = useState(true);
    const [showSuccessMessage, setShowSuccessMessage] = useState(false);
    const [bannerMessage, setBannerMessage] = useState<string | null>(null);
    const [showTutorial, setShowTutorial] = useState(false);
    const [activeVideo, setActiveVideo] = useState<{ id: number, title: string, enTitle: string, src: string, icon: string } | null>(null);

    const tutorialList = [
        { id: 1, title: 'SIDE LACAG LOO DHIGTAA?', enTitle: 'HOW TO DEPOSIT', src: '/icons/how-to-deposit.mp4', icon: '💰' },
        { id: 2, title: 'SIDE LACAG LOO BAXSAA?', enTitle: 'HOW TO WITHDRAW', src: '/icons/how-to-withdraw.mp4', icon: '💸' },
    ];

    const fetchAll = async () => {
        try {
            const token = localStorage.getItem('ludo_token');
            if (!token) return;
            const [userRes, reqRes] = await Promise.all([
                fetch(`${API_URL}/auth/me`, { headers: { 'Authorization': `Bearer ${token}` } }),
                fetch(`${API_URL}/wallet/my-requests`, { headers: { 'Authorization': `Bearer ${token}` } })
            ]);
            
            if (userRes.ok) {
                const userData = await userRes.json();
                setCurrentUser(userData);
            }
            
            if (reqRes.ok) {
                const data = await reqRes.json();
                if (data.success) setMyRequests(data.requests || []);
            }
        } catch (error) {
            console.error('Wallet Fetch Error:', error);
        } finally {
            setUserLoading(false);
        }
    };

    useEffect(() => {
        fetchAll();
    }, []);

    const handleSifaloDeposit = async () => {
        const val = parseFloat(amount);
        if (!val || val <= 0) {
            setBannerMessage('FADLAN GALI LACAGTA');
            setTimeout(() => setBannerMessage(null), 3000);
            return;
        }
        setSifaloLoading(true);
        try {
            const token = localStorage.getItem('ludo_token');
            const res = await fetch(`${API_URL}/wallet/sifalo-checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ amount: val, userId: currentUser?.id || user.id }),
            });
            const data = await res.json();
            if (data.success && data.checkoutUrl) window.location.href = data.checkoutUrl;
            else setBannerMessage(data.error || 'ERROR! TRY AGAIN');
        } catch (e) {
            setBannerMessage('NETWORK ERROR!');
        } finally {
            setSifaloLoading(false);
        }
    };

    // Combine and sort history: Requests (Approved/Rejected) and Match Results
    const combinedHistory = [
        ...myRequests.filter(r => r.status === 'APPROVED' || r.status === 'REJECTED').map(r => ({ 
            id: r._id || r.id,
            type: r.type, 
            amount: r.amount, 
            status: r.status, 
            date: r.timestamp,
            isMatch: false 
        })),
        ...(currentUser?.transactions || []).filter((t: any) => t.type === 'game_win' || t.type === 'game_loss').map((t: any) => ({
            id: t._id || t.id,
            type: t.type,
            amount: t.amount,
            status: 'COMPLETED',
            date: t.createdAt,
            isMatch: true
        }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return (
        <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-2 sm:p-4 overflow-y-auto font-sans">
            <div className="bg-slate-950 w-full max-w-md rounded-2xl border-2 border-purple-600 shadow-2xl overflow-hidden flex flex-col relative animate-in zoom-in duration-300">
                
                <div className="bg-purple-600 py-4 px-5 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="bg-white p-1.5 rounded-xl">
                            <WalletIcon className="w-5 h-5 text-purple-600" />
                        </div>
                        <h3 className="text-lg font-black text-white uppercase tracking-tighter">My Wallet</h3>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-white text-purple-600 flex items-center justify-center font-black text-xl hover:bg-slate-100 transition-colors">
                        &times;
                    </button>
                </div>

                <div className="p-6 text-center bg-gradient-to-b from-purple-900/30 to-transparent">
                    <p className="text-purple-400 text-[10px] font-black uppercase tracking-[0.2em] mb-3">Your Current Balance</p>
                    {userLoading ? (
                        <div className="w-10 h-10 border-4 border-white/20 border-t-white rounded-full animate-spin mx-auto"></div>
                    ) : (
                        <div className="inline-block relative">
                            <p className="text-5xl font-black text-white tracking-tighter flex items-start justify-center drop-shadow-lg">
                                <span className="text-2xl mt-1.5 mr-1">$</span>
                                {(currentUser?.balance || 0).toFixed(2)}
                            </p>
                        </div>
                    )}
                    <div className="mt-4 flex items-center justify-center gap-2">
                        <div className="px-3 py-1 bg-green-500/20 text-green-400 border border-green-500/30 rounded-full text-[8px] font-black uppercase tracking-widest">Active</div>
                        <div className="px-3 py-1 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded-full text-[8px] font-black uppercase tracking-widest">Verified</div>
                    </div>
                </div>

                <div className="flex px-3 py-2 gap-2 bg-slate-900 border-y border-white/5">
                    <button onClick={() => setTab('action')} className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${tab === 'action' ? 'bg-white text-black shadow-lg' : 'text-slate-500 hover:text-white'}`}>Deposit / Withdraw</button>
                    <button onClick={() => setTab('history')} className={`flex-1 py-2.5 rounded-xl font-black text-[10px] uppercase tracking-wider transition-all ${tab === 'history' ? 'bg-white text-black shadow-lg' : 'text-slate-500 hover:text-white'}`}>History</button>
                </div>

                <div className="p-5 overflow-y-auto max-h-[50vh] custom-scrollbar bg-slate-950">
                    {bannerMessage && <BannerMessage message={bannerMessage} />}
                    {showSuccessMessage && <SuccessMessage />}
                    
                    {tab === 'action' ? (
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="text-white text-[10px] font-black uppercase tracking-widest ml-1">Enter Amount ($)</label>
                                <div className="relative">
                                    <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" className="w-full bg-slate-900 border-2 border-purple-600/30 rounded-2xl py-4 px-6 text-white text-3xl font-black focus:border-purple-500 outline-none transition-all placeholder:text-white/5" />
                                    <div className="absolute right-6 top-1/2 -translate-y-1/2 text-purple-500 text-lg font-black opacity-50">USD</div>
                                </div>
                            </div>

                            <button onClick={handleSifaloDeposit} disabled={sifaloLoading || !amount || parseFloat(amount) <= 0} className="w-full bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white font-black py-4 rounded-2xl transition-all transform active:scale-98 disabled:opacity-30 flex flex-col items-center justify-center gap-0.5 shadow-xl">
                                {sifaloLoading ? <div className="w-6 h-6 border-3 border-white border-t-transparent rounded-full animate-spin" /> : <><span className="text-lg uppercase tracking-tight">Deposit Money</span><span className="text-[8px] bg-black/30 px-3 py-0.5 rounded-full font-black tracking-widest uppercase">Deg-Deg siimo</span></>}
                            </button>

                            <div className="grid grid-cols-2 gap-3">
                                <button onClick={() => setShowTutorial(true)} className="bg-slate-900 border border-white/10 text-white font-black py-3 rounded-xl hover:bg-white/5 transition-all text-[10px] uppercase tracking-widest">🎥 Tutorial</button>
                                <a href="https://t.me/Somlaandhuu" target="_blank" rel="noopener noreferrer" className="bg-[#0088cc] text-white font-black py-3 rounded-xl hover:opacity-90 transition-all text-[10px] text-center uppercase tracking-widest">✈️ Telegram</a>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {combinedHistory.length === 0 ? (
                                <div className="text-center py-12 opacity-20"><History className="w-12 h-12 mx-auto mb-4" /><p className="text-sm font-black uppercase">No History</p></div>
                            ) : (
                                combinedHistory.map((item: any) => {
                                    const isWin = item.type === 'game_win';
                                    const isLoss = item.type === 'game_loss';
                                    const isDeposit = item.type === 'DEPOSIT';
                                    
                                    let label = item.type;
                                    if (isWin || isLoss) label = 'Match Played';
                                    
                                    let statusColor = 'bg-amber-500';
                                    if (item.status === 'APPROVED' || isWin) statusColor = 'bg-green-500';
                                    if (item.status === 'REJECTED' || isLoss) statusColor = 'bg-red-500';

                                    return (
                                        <div key={item.id} className="bg-slate-900 border border-white/5 rounded-2xl p-4 flex items-center justify-between hover:border-purple-600/30 transition-colors">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xl ${isDeposit || isWin ? 'bg-green-500/20' : 'bg-red-500/20'}`}>
                                                    {isWin ? '🏆' : isLoss ? '🎮' : isDeposit ? '💰' : '💸'}
                                                </div>
                                                <div>
                                                    <p className="text-white font-black uppercase text-[10px] tracking-widest">{label}</p>
                                                    <p className="text-[8px] text-slate-500 font-bold uppercase">{new Date(item.date).toLocaleDateString()}</p>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                {item.isMatch ? (
                                                    <div className={`inline-flex items-center justify-center px-4 py-2 rounded-xl text-sm font-black shadow-lg ${isWin ? 'bg-green-600 text-white shadow-green-900/20' : 'bg-red-600 text-white shadow-red-900/20'}`}>
                                                        {isWin ? '+' : '-'}${Math.abs(item.amount).toFixed(2)}
                                                    </div>
                                                ) : (
                                                    <>
                                                        <p className="text-lg font-black text-white">${item.amount.toFixed(2)}</p>
                                                        <span className={`px-2 py-0.5 rounded-full text-[7px] font-black uppercase text-white ${statusColor}`}>
                                                            {item.status}
                                                        </span>
                                                    </>
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

            {showTutorial && (
                <div className="fixed inset-0 bg-black/98 z-[9999] flex flex-col items-center justify-center p-4 animate-in fade-in duration-300">
                    <div className="w-full max-w-md bg-slate-950 rounded-2xl border-2 border-purple-600 overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
                        <div className="p-6 bg-purple-600 flex justify-between items-center shrink-0">
                            <h3 className="text-lg font-black text-white uppercase tracking-widest">Tutorials</h3>
                            <button onClick={() => { setShowTutorial(false); setActiveVideo(null); }} className="w-10 h-10 rounded-full bg-white text-purple-600 flex items-center justify-center font-black text-xl hover:scale-105 transition-transform">&times;</button>
                        </div>
                        <div className="p-6 overflow-y-auto custom-scrollbar">
                            {activeVideo ? (
                                <div className="space-y-6">
                                    <div className="aspect-video w-full bg-black rounded-2xl overflow-hidden border-2 border-purple-600"><video className="w-full h-full object-cover" src={activeVideo.src} controls autoPlay playsInline /></div>
                                    <div className="text-center"><h4 className="text-2xl font-black text-white tracking-tight uppercase leading-tight">{activeVideo.title}</h4><button onClick={() => setActiveVideo(null)} className="mt-4 bg-white text-purple-600 px-6 py-2 rounded-full font-black uppercase text-xs">Back</button></div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {tutorialList.map((tut) => (
                                        <button key={tut.id} onClick={() => setActiveVideo(tut)} className="w-full flex items-center gap-4 p-4 bg-slate-900 border border-white/5 rounded-2xl hover:border-purple-600 transition-all group">
                                            <div className="w-14 h-14 bg-purple-600 rounded-xl flex items-center justify-center text-3xl shadow-xl group-hover:scale-105 transition-transform">{tut.icon}</div>
                                            <div className="flex-1 text-left"><h5 className="text-white font-black text-base uppercase tracking-tight">{tut.title}</h5><p className="text-purple-400 text-[10px] font-black uppercase opacity-60">{tut.enTitle}</p></div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; }
                .custom-scrollbar::-webkit-scrollbar-track { background: rgba(255,255,255,0.01); }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: #9333ea; border-radius: 10px; }
            `}</style>
        </div>
    );
};

export default Wallet;
