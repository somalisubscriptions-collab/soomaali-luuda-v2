import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, User, DollarSign, Play, X } from 'lucide-react';

interface MatchRequest {
    requestId: string;
    userName: string;
    stake: number;
    timeRemaining: number;
    canAccept: boolean;
}

interface MatchRequestListProps {
    requests: MatchRequest[];
    onAccept: (requestId: string) => void;
    currentUserId: string;
    onShowTutorial?: () => void;
}

const MatchRequestList: React.FC<MatchRequestListProps> = ({ requests, onAccept, currentUserId, onShowTutorial }) => {
    const [now, setNow] = useState(Date.now());

    useEffect(() => {
        const interval = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-white/80 text-sm font-medium flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Live Match Requests ({requests.length})
                </h3>
                {onShowTutorial && (
                    <button
                        onClick={onShowTutorial}
                        className="bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 text-[10px] font-black py-1.5 px-3 rounded-full border border-cyan-500/30 flex items-center gap-2 transition-all shadow-[0_0_15px_rgba(6,182,212,0.1)] group active:scale-95"
                    >
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-500"></span>
                        </span>
                        <span className="tracking-widest uppercase">Caawinaad (Tutorial)</span>
                    </button>
                )}
            </div>

            {requests.length === 0 ? (
                <div className="text-center py-12 text-white/50 bg-white/5 rounded-2xl border border-white/5 backdrop-blur-sm">
                    <User className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No active match requests</p>
                    <p className="text-xs mt-1 opacity-70">Create one to start playing!</p>
                </div>
            ) : (
                <AnimatePresence mode="popLayout">
                    {requests.map((req) => (
                        <motion.div
                            key={req.requestId}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-gradient-to-r from-white/10 to-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between group hover:border-white/20 transition-colors"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-400 to-emerald-600 flex items-center justify-center text-white font-bold text-lg shadow-lg">
                                    <DollarSign className="w-6 h-6" />
                                </div>

                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold text-white text-lg">${req.stake.toFixed(2)}</span>
                                        <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-300 border border-green-500/30">
                                            Stake
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 mt-1 text-xs text-white/50">
                                        <span className="flex items-center gap-1">
                                            <Clock className="w-3 h-3" />
                                            {req.timeRemaining}s
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <button
                                onClick={() => onAccept(req.requestId)}
                                disabled={!req.canAccept}
                                className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition-all ${req.canAccept
                                        ? 'bg-green-500 hover:bg-green-400 text-black shadow-lg hover:shadow-green-500/25 active:scale-95'
                                        : 'bg-white/10 text-white/30 cursor-not-allowed'
                                    }`}
                            >
                                {req.canAccept ? (
                                    <>
                                        <Play className="w-4 h-4 fill-current" />
                                        PLAY
                                    </>
                                ) : (
                                    <>
                                        <DollarSign className="w-4 h-4" />
                                        Low Balance
                                    </>
                                )}
                            </button>
                        </motion.div>
                    ))}
                </AnimatePresence>
            )}
        </div>
    );
};

export default MatchRequestList;
