import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { SOCKET_URL, API_URL } from '../lib/apiConfig';
import { useAuth } from '../context/AuthContext';
import type { Player, PlayerColor } from '../types';
import MatchRequestList from './MatchRequestList';
import { Loader2, X } from 'lucide-react';
import axios from 'axios';
import SlidingNotification from './SlidingNotification';


interface MultiplayerLobbyProps {
    onStartGame: (players: Player[], config: { gameId: string, localPlayerColor: PlayerColor, sessionId: string, stake: number }) => void;
    onExit: () => void;
}

interface MatchRequest {
    requestId: string;
    userId: string;
    userName: string;
    stake: number;
    timeRemaining: number;
    canAccept: boolean;
}

const BET_OPTIONS = [0.15, 0.25, 0.50, 1.00, 2.00, 3.00, 5.00];

const getSessionId = () => {
    let id = sessionStorage.getItem('ludoSessionId');
    if (!id) {
        id = Math.random().toString(36).substring(2, 10);
        sessionStorage.setItem('ludoSessionId', id);
    }
    return id;
};

// --- Helper Components ---

const CountdownOverlay: React.FC<{ count: number }> = ({ count }) => (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[100] backdrop-blur-sm">
        <div className="text-center animate-in fade-in zoom-in duration-300">
            <div className="text-[12rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-cyan-300 to-cyan-600 animate-bounce drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]">
                {count > 0 ? count : 'GO!'}
            </div>
            <p className="text-white text-2xl mt-4 font-bold tracking-[0.5em] uppercase animate-pulse">Match Starting</p>
        </div>
    </div>
);

const BetCard: React.FC<{ amount: number; onClick: () => void; disabled: boolean }> = ({ amount, onClick, disabled }) => {
    const [touchStart, setTouchStart] = React.useState<{ x: number; y: number } | null>(null);

    const handleTouchStart = (e: React.TouchEvent) => {
        if (!disabled) {
            const touch = e.touches[0];
            setTouchStart({ x: touch.clientX, y: touch.clientY });
        }
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (!disabled && touchStart) {
            const touch = e.changedTouches[0];
            const deltaX = Math.abs(touch.clientX - touchStart.x);
            const deltaY = Math.abs(touch.clientY - touchStart.y);

            // Only trigger click if movement is less than 10 pixels (tap, not scroll)
            if (deltaX < 10 && deltaY < 10) {
                onClick();
            }
            setTouchStart(null);
        }
    };

    const handleMouseClick = (e: React.MouseEvent) => {
        if (!disabled) {
            onClick();
        }
    };

    return (
        <button
            onClick={handleMouseClick}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            disabled={disabled}
            className={`
                relative group flex flex-col items-center justify-center p-5 rounded-xl border-2 transition-all duration-300 shadow-lg select-none
                ${disabled
                    ? 'border-slate-700 bg-slate-800/50 opacity-50 cursor-not-allowed'
                    : 'border-cyan-500/30 bg-gradient-to-br from-slate-800 to-slate-900 hover:border-cyan-400 hover:from-cyan-900/30 hover:to-slate-800 hover:shadow-[0_0_25px_rgba(6,182,212,0.4)] cursor-pointer active:scale-95 transform'
                }
            `}
        >
            <div className="text-cyan-400 text-xs font-bold uppercase tracking-widest mb-1.5">Stake</div>
            <div className={`text-3xl font-black mb-1 ${disabled ? 'text-slate-500' : 'text-white group-hover:text-cyan-300 transition-colors'}`}>
                ${amount.toFixed(2)}
            </div>
            <div className="h-px w-12 bg-gradient-to-r from-transparent via-cyan-500/50 to-transparent my-2"></div>
            <div className={`px-3 py-1 rounded-full text-xs font-bold border transition-all ${disabled
                ? 'bg-slate-900 text-slate-500 border-slate-700'
                : 'bg-gradient-to-r from-green-900/30 to-emerald-900/30 text-green-400 border-green-500/30 group-hover:border-green-400 group-hover:from-green-800/40 group-hover:to-emerald-800/40'
                }`}>
                Win: +${amount === 0.15 ? '0.10' : (amount * 0.8).toFixed(2)}
            </div>
        </button>
    );
};

const ANIMATIONS = [
    '/icons/waving.webm',
    '/icons/dice.webm',
    '/icons/money1.webm',
    '/icons/jump.webm'
];

// --- Main Component ---

const MultiplayerLobby: React.FC<MultiplayerLobbyProps> = ({ onStartGame, onExit }) => {
    const [status, setStatus] = useState<'SELECT' | 'CREATING' | 'WAITING' | 'STARTING'>('SELECT');
    const [selectedStake, setSelectedStake] = useState<number | null>(null);
    const [activeRequests, setActiveRequests] = useState<MatchRequest[]>([]);
    const [myRequestId, setMyRequestId] = useState<string | null>(null);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [showInsufficientBalanceModal, setShowInsufficientBalanceModal] = useState(false);
    const matchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [currentAnimIndex, setCurrentAnimIndex] = useState(0);
    const [showTutorial, setShowTutorial] = useState(false);
    const [activeVideo, setActiveVideo] = useState<{ id: number, title: string, enTitle: string, src: string, icon: string } | null>(null);
    const { user } = useAuth();

    const tutorialList = [
        { id: 1, title: 'Sidee lacag loo dhigtaa?', enTitle: 'How to deposit money?', src: '/icons/how-to-deposit.mp4', icon: '💰' },
        { id: 2, title: 'Sida lacagta loola baxo', enTitle: 'How to withdraw money', src: '/icons/how-to-withdraw.mp4', icon: '💸' },
    ];

    const sessionId = getSessionId();
    const socketRef = useRef<Socket | null>(null);

    // Animation Loop logic
    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentAnimIndex((prev) => (prev + 1) % ANIMATIONS.length);
        }, 4000); // Change animation every 4 seconds
        return () => clearInterval(interval);
    }, []);

    // Initialize Socket.IO connection
    useEffect(() => {
        const existingSocket = (window as any).matchmakingSocket;
        if (existingSocket && existingSocket.connected) {
            console.log('🔄 Reusing global matchmaking socket connection');
            socketRef.current = existingSocket;
        } else {
            const socketUrl = SOCKET_URL;
            console.log('🔌 Creating new Socket.IO connection for matchmaking:', socketUrl);
            socketRef.current = io(socketUrl, {
                reconnection: true,
                reconnectionAttempts: 10,
                reconnectionDelay: 1000,
                transports: ['websocket', 'polling'],
                forceNew: false
            });
            (window as any).matchmakingSocket = socketRef.current;
        }

        const socket = socketRef.current;
        const userId = user?._id || user?.id || sessionId;

        // Helper to register user for notifications
        const registerUser = () => {
            if (userId) {
                console.log('👤 Registering user for matchmaking notifications:', userId);
                socket.emit('register_user', { userId });
            }
        };

        socket.on('connect', () => {
            console.log('✅ Connected to matchmaking server, socket ID:', socket.id);

            // Register for notifications
            registerUser();

            // Fetch active requests on connect
            socket.emit('get_active_requests', { userId });
        });

        // Handle reconnection
        socket.on('reconnect', (attemptNumber: number) => {
            console.log(`🔄 Reconnected to matchmaking server after ${attemptNumber} attempt(s)`);

            // Re-register after reconnection (CRITICAL for Render/production)
            registerUser();

            // Re-fetch active requests
            socket.emit('get_active_requests', { userId });
        });

        // Listen for registration confirmation
        socket.on('registration_confirmed', ({ userId: confirmedUserId, room, socketId }: any) => {
            console.log(`✅ Registration confirmed for user ${confirmedUserId} in room ${room}, socket ${socketId}`);
        });

        // Monitor connection state
        socket.on('disconnect', (reason: string) => {
            console.warn(`⚠️ Disconnected from matchmaking server. Reason: ${reason}`);
            if (reason === 'io server disconnect') {
                // Server disconnected us, reconnect manually
                socket.connect();
            }
        });

        socket.on('connect_error', (error: Error) => {
            console.error('❌ Connection error:', error.message);
        });

        // Periodic re-registration to ensure we stay in the room (every 30 seconds)
        const reregistrationInterval = setInterval(() => {
            if (socket.connected && userId) {
                console.log('🔄 Periodic re-registration');
                registerUser();
            }
        }, 30000);

        // --- Match Request Events ---

        socket.on('active_requests', ({ requests }: { requests: MatchRequest[] }) => {
            // Only update if playing Ludo (checked via localStorage to avoid closure staleness)
            if (localStorage.getItem('selectedGameType') !== 'TIC_TAC_TOE') {
                setActiveRequests(requests);
            }
        });

        socket.on('active_ttt_requests', (requests: any[]) => {
            // Only update if playing JAR (TTT)
            if (localStorage.getItem('selectedGameType') === 'TIC_TAC_TOE') {
                const currentUserId = user?._id || user?.id || sessionId;
                const formattedRequests = requests
                    .filter((req: any) => req.userId !== currentUserId)
                    .map((req: any) => ({
                        requestId: req.requestId,
                        userId: req.userId,
                        userName: req.username,
                        stake: req.stake,
                        timeRemaining: 120, // Keep them 'fresh' so they show up
                        canAccept: (user?.balance || 0) >= req.stake
                    }));
                setActiveRequests(formattedRequests);
            }
        });

        socket.on('new_match_request', ({ request }: { request: MatchRequest }) => {
            // Filter out own requests if they come through broadcast
            const currentUserId = user?._id || user?.id || sessionId;
            if (request.userId === currentUserId) return;

            // Check if user has balance to accept
            const userBalance = user?.balance || 0;
            const enhancedRequest = {
                ...request,
                canAccept: userBalance >= request.stake,
                timeRemaining: 120 // Fresh request (2 minutes)
            };

            setActiveRequests(prev => {
                // Avoid duplicates
                if (prev.find(r => r.requestId === request.requestId)) return prev;
                return [...prev, enhancedRequest];
            });
        });

        socket.on('match_request_removed', ({ requestId }: { requestId: string }) => {
            setActiveRequests(prev => prev.filter(r => r.requestId !== requestId));
        });

        socket.on('match_request_created', ({ requestId }: { requestId: string }) => {
            setMyRequestId(requestId);
            setStatus('WAITING');
            setStatusMessage('Waiting for opponent...');

            // Clear any existing timeout
            if (matchTimeoutRef.current) {
                clearTimeout(matchTimeoutRef.current);
            }
        });

        socket.on('match_request_cancel_success', () => {
            setMyRequestId(null);
            setStatus('SELECT');
            setSelectedStake(null);
            setStatusMessage('');
        });

        socket.on('match_request_accepted', ({ requestId, acceptorName }: { requestId: string, acceptorName: string }) => {
            if (requestId === myRequestId) {
                setStatusMessage('Match accepted! Starting...');
                // Game start logic handled by match_found/game_created event

                // Set a timeout in case match_found never arrives (10 seconds)
                if (matchTimeoutRef.current) {
                    clearTimeout(matchTimeoutRef.current);
                }
                matchTimeoutRef.current = setTimeout(() => {
                    console.error('⏰ Timeout: match_found event not received within 10 seconds');
                    setStatusMessage('Match creation timed out. Please try again.');
                    setTimeout(() => {
                        setStatus('SELECT');
                        setMyRequestId(null);
                        setStatusMessage('');
                    }, 2000);
                }, 10000); // Increased from 5 to 10 seconds
            }
        });

        // --- Game Start Events ---

        socket.on('match_found', ({ gameId, playerColor, opponent, stake }: any) => {
            console.log('✅ Match found!', { gameId, playerColor, opponent, stake });
            setStatus('STARTING');

            // Clear timeout since we received match_found successfully
            if (matchTimeoutRef.current) {
                clearTimeout(matchTimeoutRef.current);
                matchTimeoutRef.current = null;
            }

            // Clean up socket listeners but keep connection for a moment
            if (socketRef.current) {
                socketRef.current.off('match_found');
                socketRef.current.off('active_requests');
                socketRef.current.off('new_match_request');
            }

            // Start game
            const defaultPlayers: Player[] = [
                { color: 'green', isAI: false },
                { color: 'blue', isAI: false }
            ];

            startCountdown(() => {
                // CRITICAL: Use _id for playerId
                const playerId = user?._id || user?.id || sessionId;
                onStartGame(defaultPlayers, { gameId, localPlayerColor: playerColor, sessionId, playerId, stake });
            });
        });

        // NEW: Tic-Tac-Toe Match Found Handler
        socket.on('ttt_match_found', ({ gameId, players, stake, yourSymbol }: any) => {
            console.log('✅ Tic-Tac-Toe Match found!', { gameId, players, stake });
            setStatus('STARTING');

            if (matchTimeoutRef.current) {
                clearTimeout(matchTimeoutRef.current);
                matchTimeoutRef.current = null;
            }

            // Start Countdown then Launch
            startCountdown(() => {
                const playerId = user?._id || user?.id || sessionId;
                // Map symbol to a dummy color for compatibility, or add symbol to config
                // We will pass gameType='TIC_TAC_TOE' in config
                onStartGame([], {
                    gameId,
                    localPlayerColor: 'red', // Dummy
                    sessionId,
                    playerId,
                    stake,
                    gameType: 'TIC_TAC_TOE' // Important!
                } as any);
            });
        });

        socket.on('ERROR', ({ message }: any) => {
            console.error('Matchmaking error:', message);
            setStatusMessage(`Error: ${message}`);

            // Clear timeout on error
            if (matchTimeoutRef.current) {
                clearTimeout(matchTimeoutRef.current);
                matchTimeoutRef.current = null;
            }

            // Reset to SELECT state after showing error
            setTimeout(() => {
                setStatus('SELECT');
                setMyRequestId(null);
                setSelectedStake(null);
                setStatusMessage('');
            }, 3000);
        });

        return () => {
            // Cleanup timeout on unmount
            if (matchTimeoutRef.current) {
                clearTimeout(matchTimeoutRef.current);
            }

            // Clear re-registration interval
            clearInterval(reregistrationInterval);

            if (socketRef.current) {
                socketRef.current.off('connect');
                socketRef.current.off('reconnect');
                socketRef.current.off('disconnect');
                socketRef.current.off('connect_error');
                socketRef.current.off('registration_confirmed');
                socketRef.current.off('active_requests');
                socketRef.current.off('new_match_request');
                socketRef.current.off('match_request_removed');
                socketRef.current.off('match_request_created');
                socketRef.current.off('match_request_cancel_success');
                socketRef.current.off('match_request_accepted');
                socketRef.current.off('match_found');
                socketRef.current.off('ERROR');
            }
        };
    }, [user, sessionId, onStartGame, myRequestId]);

    // Cleanup timer for request expiration visualization
    useEffect(() => {
        const timer = setInterval(() => {
            setActiveRequests(prev => prev.map(req => ({
                ...req,
                timeRemaining: Math.max(0, req.timeRemaining - 1)
            })).filter(req => req.timeRemaining > 0));
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    const startCountdown = (onComplete: () => void) => {
        let count = 3;
        setCountdown(count);
        const timer = setInterval(() => {
            count--;
            if (count < 0) {
                clearInterval(timer);
                setCountdown(null);
                onComplete();
            } else {
                setCountdown(count);
            }
        }, 1000);
    };

    const handleCreateRequest = (amount: number) => {
        if (!socketRef.current || !socketRef.current.connected) {
            setStatusMessage('Not connected to server');
            return;
        }

        // Check selected game type
        const selectedGameType = localStorage.getItem('selectedGameType');
        const isTTT = selectedGameType === 'TIC_TAC_TOE';

        // CRITICAL: Use _id for MongoDB lookup, fallback to id, then sessionId for guests
        const userId = user?._id || user?.id || sessionId;
        const userName = user?.username || 'Player';

        // Check if user has sufficient balance
        const userBalance = user?.balance || 0;
        if (userBalance < amount) {
            console.log('⚠️ Insufficient balance:', { userBalance, required: amount });
            setShowInsufficientBalanceModal(true);
            return;
        }

        // TTT specific check: Stake must be 0.05
        if (isTTT && amount !== 0.05) {
            // Silently correct or warn? For now let's just proceed, server validates
            console.log('Using fixed TTT stake');
        }

        // Super Admin check
        if (user && ((user.role && user.role.toString().toLowerCase().includes('super')) || (user as any).isSuperAdmin)) {
            setStatusMessage('Super Admin accounts cannot participate.');
            return;
        }

        // AUTO-ACCEPT LOGIC: Check if there's an existing request with the same stake
        // Only for Ludo for now, unless we want to implement peer-to-peer TTT later
        // TTT uses a queue system on server

        if (!isTTT) {
            const matchingRequest = activeRequests.find(req =>
                req.stake === amount &&
                req.canAccept &&
                req.userId !== userId
            );

            if (matchingRequest) {
                console.log('🎯 Auto-accepting matching request:', matchingRequest.requestId);
                handleAcceptRequest(matchingRequest.requestId);
                return;
            }
        }

        console.log(`🎮 Creating ${isTTT ? 'Tic-Tac-Toe' : 'Ludo'} match request:`, { stake: amount, userId, isAuthenticated: !!user });
        setSelectedStake(amount);
        setStatus('CREATING');
        setStatusMessage(isTTT ? 'Joining JAR Queue...' : 'Creating match request...');

        if (isTTT) {
            socketRef.current.emit('ttt_find_match', {
                userId,
                username: userName,
                stake: amount // Should be 0.05
            });
        } else {
            socketRef.current.emit('create_match_request', {
                stake: amount,
                userId,
                userName
            });
        }

        // --- Sending Push Notifications (OneSignal) ---
        // If stake is 0.25, invite other players!
        if (!isTTT && amount === 0.25) {
            console.log('📢 Triggering push notification for 0.25 match...');
            // Need to get token from header for authenticated request
            const token = localStorage.getItem('ludo_token');

            axios.post(`${API_URL}/notifications/announce`,
                { stake: amount },
                { headers: { Authorization: `Bearer ${token}` } }
            )
                .then(res => {
                    if (res.data.success) {
                        console.log('✅ Invite sent to:', res.data.recipientCount, 'players');
                        // Optionally update status message briefly
                        // setStatusMessage('Inviting players...');
                    } else {
                        console.log('⚠️ Invite skipped/failed:', JSON.stringify(res.data));
                    }
                })
                .catch(err => console.error('❌ Failed to trigger notification:', err));
        }
    };

    const handleAcceptRequest = (requestId: string) => {
        if (!socketRef.current || !socketRef.current.connected) return;

        // CRITICAL: Use _id for MongoDB lookup
        const userId = user?._id || user?.id || sessionId;
        const userName = user?.username || 'Player';

        console.log('🤝 Accepting match request:', requestId, { userId, isAuthenticated: !!user });
        socketRef.current.emit('accept_match_request', {
            requestId,
            userId,
            userName
        });
    };

    const handleCancelRequest = () => {
        if (myRequestId && socketRef.current) {
            // CRITICAL: Use _id for MongoDB lookup
            const userId = user?._id || user?.id || sessionId;
            socketRef.current.emit('cancel_match_request', {
                requestId: myRequestId,
                userId
            });
        }
    };

    const [gameType, setGameType] = useState<string>(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('selectedGameType') || 'LUDO';
        }
        return 'LUDO';
    });

    useEffect(() => {
        // Keep listener in case it changes externally (though unlikely in this flow)
        const type = localStorage.getItem('selectedGameType') || 'LUDO';
        setGameType(type);
    }, []);

    const isTTT = gameType === 'TIC_TAC_TOE';
    const activeBetOptions = isTTT ? [0.05] : BET_OPTIONS;

    // ... existing cleanup code ...

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-slate-900 p-4 relative overflow-hidden">
            {/* Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none opacity-20">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/30 rounded-full blur-3xl"></div>
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-cyan-600/30 rounded-full blur-3xl"></div>
            </div>

            {countdown !== null && <CountdownOverlay count={countdown} />}

            {/* Insufficient Balance Modal */}
            {showInsufficientBalanceModal && (
                <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] backdrop-blur-sm p-4" onClick={() => setShowInsufficientBalanceModal(false)}>
                    <div className="bg-gradient-to-br from-red-500 via-red-600 to-orange-600 rounded-3xl max-w-md w-full p-8 shadow-2xl animate-in zoom-in duration-300" onClick={(e) => e.stopPropagation()}>
                        <div className="text-center">
                            <div className="bg-white/20 backdrop-blur-sm rounded-full w-24 h-24 mx-auto mb-6 flex items-center justify-center">
                                <span className="text-6xl">😟</span>
                            </div>
                            <h2 className="text-3xl font-bold text-white mb-4">Waanka xunnahay!</h2>
                            <p className="text-xl text-white/95 mb-6 leading-relaxed">
                                Lacag kuguma jirto ee fadlan ku shubo
                            </p>
                            <div className="bg-white/10 rounded-xl p-4 mb-6 backdrop-blur-sm">
                                <p className="text-white/80 text-sm mb-1">Your Balance</p>
                                <p className="text-3xl font-bold text-white">${(user?.balance || 0).toFixed(2)}</p>
                            </div>
                            <button
                                onClick={() => setShowInsufficientBalanceModal(false)}
                                className="w-full bg-white hover:bg-gray-100 text-red-600 font-bold py-4 px-6 rounded-xl shadow-lg transition-all transform hover:scale-105"
                            >
                                Fahantay (OK)
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div className="z-10 w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 px-4 items-center justify-center">
                {/* Left Column: Create Request */}
                <div className={`text-center lg:text-left ${isTTT ? 'col-span-1 lg:col-span-2 mx-auto' : ''}`}>
                    {isTTT ? (
                        <div className="flex flex-col items-center gap-4 py-8 px-8 bg-slate-800/40 backdrop-blur-xl rounded-[2rem] border border-amber-500/30 shadow-[0_0_40px_rgba(245,158,11,0.15)] animate-in fade-in zoom-in duration-700 max-w-xl mx-auto relative overflow-hidden group">
                            {/* Decorative elements */}
                            <div className="absolute -top-10 -right-10 w-32 h-32 bg-amber-500/10 rounded-full blur-2xl group-hover:bg-amber-500/20 transition-colors duration-500"></div>
                            <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-orange-500/10 rounded-full blur-2xl group-hover:bg-orange-500/20 transition-colors duration-500"></div>

                            <div className="text-6xl mb-2 filter drop-shadow-[0_0_10px_rgba(245,158,11,0.5)] transform group-hover:scale-110 transition-transform duration-500">❌⭕</div>

                            <h1 className="text-2xl sm:text-3xl font-black bg-gradient-to-r from-amber-300 via-amber-400 to-orange-500 bg-clip-text text-transparent uppercase tracking-[0.1em] text-center font-sans drop-shadow-sm">
                                dheel jartaan lacagna ka sameey
                            </h1>

                            <div className="h-px w-24 bg-gradient-to-r from-transparent via-amber-500/50 to-transparent"></div>

                            <p className="text-sm sm:text-base text-amber-50/90 font-medium leading-relaxed font-sans italic text-center max-w-md">
                                ciyaartaan waa jar, barashadeeda iyo dheesheedaba wee fududahay halkii marna waxaad dhigan kartaa $0.05 hada badisidna waxad heleysaa $0.04 total $0.09
                            </p>
                        </div>
                    ) : (
                        <>
                            <video
                                key={ANIMATIONS[currentAnimIndex]}
                                src={ANIMATIONS[currentAnimIndex]}
                                autoPlay
                                loop
                                muted
                                playsInline
                                className="w-32 h-32 mb-4 rounded-xl object-contain shadow-lg mix-blend-screen"
                            />
                            <h1
                                className="text-2xl sm:text-3xl font-bold mb-2 tracking-tight bg-gradient-to-r from-yellow-400 via-emerald-400 to-cyan-400 bg-clip-text text-transparent leading-tight text-center"
                                style={{ fontFamily: 'Papyrus, "Comic Sans MS", cursive' }}
                            >
                                halkaan ka dooro lacagta aad dhiganayso
                            </h1>
                        </>
                    )}
                </div>

                {/* Sliding Notification - Ludo Only */}
                {!isTTT && (
                    <div className="mb-8 max-w-md mx-auto">
                        <SlidingNotification
                            text="intaa lacag doorato gameka haka bixin hadii kale computer ayaa kuu dheelayo, hadii aadka baxayso taabo calaamada (X)"
                            speed={20}
                            className="rounded-2xl border border-red-500/30 shadow-[0_0_20px_rgba(239,68,68,0.1)]"
                        />
                    </div>
                )}

                {/* JAR Description moved into H1, removing the previous separate box if it exists */}

                {status === 'SELECT' ? (
                    <div className="space-y-6">
                        <div className="flex items-center justify-between mb-4 px-1 max-w-md mx-auto">
                            <h3 className="text-xl sm:text-2xl font-bold text-white bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                                {isTTT ? 'Entry Fee' : 'Select Your Stake'}
                            </h3>
                            <button
                                onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onExit();
                                }}
                                className="flex items-center justify-center w-8 h-8 rounded-full bg-red-600 hover:bg-red-700 text-white transition-all shadow-lg"
                                title="Close"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className={`flex justify-center gap-3 max-w-md mx-auto flex-wrap`}>
                            {activeBetOptions.map((amount) => (
                                <div key={amount} className={`${isTTT ? 'w-64' : 'w-[calc(50%-0.375rem)]'} min-w-[140px]`}>
                                    <BetCard
                                        amount={amount}
                                        onClick={() => handleCreateRequest(amount)}
                                        disabled={(user?.balance || 0) < amount}
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                ) : status === 'WAITING' || status === 'CREATING' ? (
                    <div className="bg-slate-800/80 backdrop-blur-md p-8 rounded-3xl shadow-2xl border border-slate-700 animate-in zoom-in duration-300 text-center max-w-md mx-auto">
                        <div className="relative w-20 h-20 mx-auto mb-4">
                            <div className="absolute inset-0 border-4 border-cyan-500/30 rounded-full animate-ping"></div>
                            <Loader2 className="w-full h-full text-cyan-500 animate-spin p-2" />
                        </div>
                        <h2 className="text-xl font-bold text-white mb-2">{statusMessage}</h2>
                        <p className="text-slate-400 mb-6">Stake: <span className="text-cyan-400 font-bold">${selectedStake?.toFixed(2)}</span></p>

                        <button
                            onClick={handleCancelRequest}
                            className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-full font-medium transition-colors flex items-center gap-2 mx-auto"
                        >
                            <X className="w-4 h-4" /> Cancel Request
                        </button>
                    </div>
                ) : null}

                {status === 'SELECT' && (
                    <button
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onExit();
                        }}
                        className="mt-8 text-slate-500 hover:text-white transition-colors font-medium flex items-center gap-2 mx-auto"
                    >
                        <span>&larr; Back to Menu</span>
                    </button>
                )}
            </div>

            {/* Right Column: Active Requests List */}
            <div className="bg-slate-800/50 backdrop-blur-sm rounded-3xl border border-slate-700 p-6 h-[500px] overflow-hidden flex flex-col">
                <MatchRequestList
                    requests={activeRequests}
                    onAccept={(requestId) => {
                        if (isTTT) {
                            // For TTT, "Accepting" means joining the queue with the same stake
                            const request = activeRequests.find(r => r.requestId === requestId);
                            if (request) {
                                handleCreateRequest(request.stake);
                            }
                        } else {
                            handleAcceptRequest(requestId);
                        }
                    }}
                    currentUserId={user?.id || sessionId}
                    onShowTutorial={() => setShowTutorial(true)}
                />
            </div>



            {/* ── TUTORIAL MODAL ── */}
            {showTutorial && (
                <div className="fixed inset-0 bg-black/85 z-[9999] flex flex-col items-center justify-center p-4 backdrop-blur-sm">
                    <div className="w-full max-w-md bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-700 flex flex-col max-h-[80vh]">
                        <div className="p-4 flex justify-between items-center border-b border-slate-800 shrink-0">
                            {activeVideo ? (
                                <button onClick={() => setActiveVideo(null)} className="flex items-center gap-1 bg-transparent border-none text-cyan-400 text-sm cursor-pointer font-bold p-0 hover:text-cyan-300">
                                    <span>←</span> Dib u noqo
                                </button>
                            ) : (
                                <h3 className="m-0 text-white text-base font-bold">🎥 Qeybta Caawinaada</h3>
                            )}
                            <button onClick={() => { setShowTutorial(false); setActiveVideo(null); }} className="bg-transparent border-none text-slate-400 text-2xl cursor-pointer leading-none hover:text-white">&times;</button>
                        </div>
                        
                        {activeVideo ? (
                            <div className="overflow-y-auto">
                                <div className="w-full bg-black flex items-center justify-center">
                                    <video 
                                        className="w-full max-h-[50vh] object-contain"
                                        src={activeVideo.src}
                                        controls
                                        autoPlay
                                        playsInline
                                    />
                                </div>
                                <div className="p-4 text-center">
                                    <h4 className="text-white m-0 mb-2 text-base font-bold">{activeVideo.title}</h4>
                                </div>
                            </div>
                        ) : (
                            <div className="p-4 overflow-y-auto">
                                <p className="text-slate-400 text-sm m-0 mb-4 text-center">
                                    Dooro muuqaalka aad rabto in aad daawato:
                                </p>
                                <div className="flex flex-col gap-3">
                                    {tutorialList.map((tut) => (
                                        <div 
                                            key={tut.id} 
                                            onClick={() => setActiveVideo(tut)}
                                            className="group flex items-center gap-4 p-4 bg-gradient-to-br from-slate-800 to-slate-800/80 border border-slate-700 rounded-2xl cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-500/20 hover:border-cyan-500/50"
                                        >
                                            <div className="text-3xl w-14 h-14 bg-gradient-to-br from-slate-700 to-slate-800 rounded-xl flex items-center justify-center shrink-0 border border-slate-600 shadow-inner group-hover:scale-110 group-hover:border-cyan-500/50 transition-transform duration-300">
                                                {tut.icon}
                                            </div>
                                            <div className="flex-1">
                                                <div className="text-white font-extrabold text-[15px] mb-1">{tut.title}</div>
                                                <div className="text-slate-400 text-xs font-medium mb-3">{tut.enTitle}</div>
                                                <div className="inline-flex items-center gap-1.5 bg-cyan-500/20 text-cyan-400 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border border-cyan-500/30">
                                                    <span className="text-[12px] leading-none">▶</span> Daawo
                                                </div>
                                            </div>
                                            <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-cyan-400 text-xl font-bold group-hover:bg-cyan-500 group-hover:text-white transition-colors duration-300">
                                                ›
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {/* Support Footer */}
                                <div className="mt-6 p-4 bg-slate-800/50 rounded-2xl border border-slate-700/50">
                                    <p className="text-[13px] text-slate-400 leading-relaxed text-center m-0">
                                        <span className="font-bold text-white block mb-1">Ma u baahan tahay caawinaad?</span>
                                        Hadii cabasho ama wax aad fahmi weysay ay jiraan lasoo xariir telegraamkeena <a href="https://t.me/Somlaandhuu" target="_blank" rel="noopener noreferrer" className="text-cyan-400 font-bold hover:underline">@Somlaandhuu</a> ama soo wac <a href="tel:0610251014" className="text-cyan-400 font-bold hover:underline">0610251014</a>
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MultiplayerLobby;
