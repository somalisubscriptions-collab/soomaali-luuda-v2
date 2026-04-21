import React, { useState, useEffect, useCallback } from 'react';
import type { Player, PlayerColor, GameType } from '../types';
import { PLAYER_TAILWIND_COLORS, PLAYER_COLORS } from '../lib/boardLayout';
import { useAuth } from '../context/AuthContext';
import { gameAPI } from '../services/gameAPI';
import RejoinGameBanner from './RejoinGameBanner';
import WithdrawalTestimonials from './WithdrawalTestimonials';
import { Copy, Gem } from 'lucide-react';
import { toast } from 'react-hot-toast';
import AdminQuickActions from './AdminQuickActions';
import SlidingNotification from './SlidingNotification';
import PlayerStatsModal from './PlayerStatsModal';

interface GameSetupProps {
  onStartGame: (players: Player[]) => void;
  onEnterLobby: () => void;
  onRejoinGame?: (gameId: string, playerColor: string) => void;
  onEnterSuperAdmin?: () => void;
  onEnterMiniAdmin?: () => void;
  onEnterWallet?: () => void;
  onEnterReferrals?: () => void;
  onEnterLiveMatches?: () => void;
  onInstall?: () => void;
  showInstallButton?: boolean;
}

// Helper to trigger refresh on mount
const RefreshTrigger = () => {
  const { refreshUser } = useAuth();
  useEffect(() => {
    refreshUser();
  }, []);
  return null;
};

// Normalised list of phones that get mini-admin access (all storage variants)
const MINI_ADMIN_PHONES = [
  '+252615552432', '252615552432', '0615552432', '615552432',
  '+252614171577', '252614171577', '0614171577', '614171577',
  '+252617706896', '252617706896', '0617706896', '617706896'
];

const isMiniAdmin = (phone?: string) =>
  phone ? MINI_ADMIN_PHONES.includes(phone) : false;

const GameSetup: React.FC<GameSetupProps> = ({ onStartGame, onEnterLobby, onRejoinGame, onEnterAdmin, onEnterSuperAdmin, onEnterMiniAdmin, onEnterWallet, onEnterReferrals, onEnterLiveMatches, onInstall, showInstallButton }) => {
  const { user, logout, refreshUser } = useAuth();
  const [isPurchasing, setIsPurchasing] = useState(false);

  const handleBuyGems = async (price: number, gems: number) => {
    // Show custom confirmation modal instead of ugly native alert
    setConfirmGemPurchase({ show: true, price, gems });
  };

  const executeWhatsAppPurchase = () => {
    const { price, gems } = confirmGemPurchase;
    const userInfo = `${user?.username || 'Player'} (${user?.phone || 'Unknown phone'})`;
    const message = `Asc, waxaan rabaa inaan iibsado ${gems} Undo Gems oo qiimahoodu yahay $${price.toFixed(2)}.\n\nUsername: ${userInfo}`;
    const whatsappUrl = `https://wa.me/252610251014?text=${encodeURIComponent(message)}`;
    
    // Open WhatsApp in a new tab
    window.open(whatsappUrl, '_blank');
    
    // Close the modals
    setConfirmGemPurchase({ show: false, price: 0, gems: 0 });
    setShowGemStoreModal(false);
  };

  // Game Type Selection State
  const [selectedGame, setSelectedGame] = useState<GameType>('LUDO');

  // Load saved selection on mount
  useEffect(() => {
    const saved = localStorage.getItem('selectedGameType') as GameType;
    if (saved === 'TIC_TAC_TOE' || saved === 'LUDO') {
      setSelectedGame(saved);
    }
  }, []);

  const handleSelectGame = (type: GameType) => {
    setSelectedGame(type);
    localStorage.setItem('selectedGameType', type);
    toast.success(`Selected ${type === 'TIC_TAC_TOE' ? 'JAR' : 'Ludo'}`);
  };

  const [activeGameInfo, setActiveGameInfo] = useState<any>(null);
  const [showRejoinBanner, setShowRejoinBanner] = useState(false);
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showDepositModal, setShowDepositModal] = useState(false);

  const [checkingActiveGame, setCheckingActiveGame] = useState(true);

  const WHATSAPP_GROUP_LINK = 'https://chat.whatsapp.com/H1JaSyHUSTk2ZQ0RDZNUHP';



  // Debug: Log when onRejoinGame prop changes
  useEffect(() => {
    console.log('🔧 GameSetup: onRejoinGame prop:', typeof onRejoinGame, onRejoinGame ? 'defined' : 'undefined');
  }, [onRejoinGame]);

  const handleSignOut = () => {
    logout();
    window.location.reload(); // Reload to redirect to login
  };

  const [mode, setMode] = useState<'choice' | 'local_setup'>('choice');

  const checkForActiveGame = useCallback(async () => {
    setCheckingActiveGame(true);
    if (!user || !user.id) {
      setCheckingActiveGame(false);
      return;
    }

    const userId = user.id || user._id;
    if (!userId) {
      console.warn('⚠️ User object missing both id and _id');
      setCheckingActiveGame(false);
      return;
    }

    try {
      console.log('🔍 Checking for active game for user:', userId);
      const result = await gameAPI.checkActiveGame(userId);
      console.log('✅ API response for checkActiveGame:', JSON.stringify(result, null, 2));

      if (result.hasActiveGame && result.game && result.game.status === 'ACTIVE') {
        console.log('✅ Active game found:', result.game);
        setActiveGameInfo(result.game);
        setShowRejoinBanner(true);
      } else {
        if (result.hasActiveGame) {
          console.log(`ℹ️ Game found, but status is '${result.game.status}'. Not showing rejoin banner.`);
        } else {
          console.log('ℹ️ No active game found');
          // Clear any stale localStorage rejoin data
          localStorage.removeItem('ludo_rejoin');
        }
        setActiveGameInfo(null);
        setShowRejoinBanner(false);
      }
    } catch (error) {
      console.error('Error checking for active game:', error);
      alert('Error checking for an active game. Please check your connection and try refreshing the page.');
      setShowRejoinBanner(false);
      setActiveGameInfo(null);
    } finally {
      setCheckingActiveGame(false);
    }
  }, [user]);

  // Check for active game when component mounts
  useEffect(() => {
    let isMounted = true;
    let autoRejoinTimer: NodeJS.Timeout | null = null;

    checkForActiveGame();

    // Cleanup function
    return () => {
      isMounted = false;
      if (autoRejoinTimer) {
        clearTimeout(autoRejoinTimer);
      }
    };
  }, [user, checkForActiveGame]);

  // Auto-attempt rejoin when an active game is detected
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (showRejoinBanner && activeGameInfo) {
      // Delay auto-rejoin a little to allow UI to settle and network to stabilize
      timer = setTimeout(() => {
        console.log('🔁 Auto-attempting to rejoin detected active game', activeGameInfo.gameId);
        handleRejoin();
      }, 1500);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [showRejoinBanner, activeGameInfo]);

  const handleRejoin = async () => {
    console.log('🎯 handleRejoin called!');
    console.log('📋 activeGameInfo:', activeGameInfo);
    console.log('👤 user:', user);

    if (!activeGameInfo || !user) {
      console.error('❌ Cannot rejoin: missing game info or user');
      alert('Cannot rejoin: User information is missing. Please login again.');
      return;
    }

    try {
      console.log('🔄 Attempting to rejoin game:', activeGameInfo.gameId);

      // Validate required game info
      if (!activeGameInfo.gameId || !activeGameInfo.playerColor) {
        throw new Error('Invalid game information');
      }

      // Use either id or _id
      const userId = user.id || user._id;
      if (!userId) {
        throw new Error('User ID is missing. Please login again.');
      }

      // Call rejoin API with username for auto-sync
      const result = await gameAPI.rejoinGame(activeGameInfo.gameId, userId, user.username);

      if (result.success) {
        console.log('✅ Rejoin successful, notifying parent component');
        console.log('📋 Rejoin result:', result);
        setShowRejoinBanner(false);
        // Clear persisted rejoin info (we just rejoined)
        try { localStorage.removeItem('ludo_rejoin'); } catch (e) { /* ignore */ }

        // Call the parent's rejoin handler if provided
        if (onRejoinGame) {
          console.log('🎯 Calling onRejoinGame with:', { gameId: result.gameId, playerColor: result.playerColor });
          onRejoinGame(result.gameId, result.playerColor);
        } else {
          // Fallback: reload the page to trigger socket reconnection
          console.log('⚠️ No rejoin handler provided, reloading page...');
          window.location.reload();
        }
      } else {
        throw new Error('Rejoin failed - server returned unsuccessful response');
      }
    } catch (error) {
      console.error('❌ Error rejoining game:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      alert(`Failed to rejoin game: ${errorMessage}\nPlease check your connection and try again.`);
    }
  };

  const handleDismissBanner = () => {
    setShowRejoinBanner(false);
  };

  // Default configuration: Red vs Yellow (Facing/Diagonal)
  const [playerConfig, setPlayerConfig] = useState<Record<PlayerColor, { active: boolean; isAI: boolean }>>({
    red: { active: true, isAI: false },
    green: { active: false, isAI: true },
    yellow: { active: true, isAI: true },
    blue: { active: false, isAI: true },
  });

  // Enforce Red vs Yellow default when entering setup
  useEffect(() => {
    if (mode === 'local_setup') {
      setPlayerConfig(prev => ({
        red: { ...prev.red, active: true, isAI: false },
        yellow: { ...prev.yellow, active: true, isAI: true },
        green: { ...prev.green, active: false, isAI: true },
        blue: { ...prev.blue, active: false, isAI: true }
      }));
    }
  }, [mode]);

  const randomizeColors = () => {
    // Enforce diagonal pairs so players always "face" each other
    const pairs: [PlayerColor, PlayerColor][] = [
      ['red', 'yellow'],
      ['green', 'blue']
    ];
    const selectedPair = pairs[Math.floor(Math.random() * pairs.length)];

    // Randomly decide which one is the AI (0 or 1)
    const aiIndex = Math.floor(Math.random() * 2);

    setPlayerConfig(prev => {
      const next = { ...prev };
      PLAYER_COLORS.forEach(c => {
        const pairIndex = selectedPair.indexOf(c);
        const isActive = pairIndex !== -1;
        next[c] = {
          active: isActive,
          // Ensure exactly one human and one computer if active
          isAI: isActive ? (pairIndex === aiIndex) : true
        };
      });
      return next;
    });
  };

  const handleStart = () => {
    const players: Player[] = PLAYER_COLORS
      .filter(color => playerConfig[color].active)
      .map(color => ({
        color,
        isAI: playerConfig[color].isAI,
      }));

    if (players.length !== 2) {
      alert("Exactly 2 players are required.");
      return;
    }
    onStartGame(players);
  };

  const toggleActive = (color: PlayerColor) => {
    setPlayerConfig(prev => {
      // 1. If clicking an already active color, DO NOTHING. 
      // We enforce exactly 2 players, so you cannot turn one off directly.
      if (prev[color].active) return prev;

      // 2. If clicking an inactive color, we must activate it.
      // To maintain the count of 2, we must deactivate one of the currently active ones.
      // We remove the first active color found in the list (FIFO-ish) or random.

      const activeColors = PLAYER_COLORS.filter(c => prev[c].active);
      const next = { ...prev };

      // Deactivate the first currently active player
      if (activeColors.length > 0) {
        next[activeColors[0]].active = false;
      }

      // Activate the target
      next[color].active = true;
      return next;
    });
  };

  const toggleAI = (color: PlayerColor) => {
    setPlayerConfig(prev => ({
      ...prev,
      [color]: { ...prev[color], isAI: !prev[color].isAI }
    }));
  };

  // --- Local Game Setup View ---
  if (mode === 'local_setup') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-800 p-4">
        <div className="bg-slate-700 p-8 rounded-xl shadow-2xl w-full max-w-md">
          <div className="mb-6 text-center">
            <h2 className="block text-2xl font-medium mb-2 text-slate-200">2-Player Duel</h2>
            <p className="text-slate-400">Red vs Yellow (Diagonal). One Human vs One Computer.</p>
          </div>

          <div className="mb-6">
            <button
              onClick={randomizeColors}
              className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-lg shadow-lg transition-all transform hover:scale-105 flex items-center justify-center gap-2"
            >
              <span className="text-xl">🎲</span>
              Randomize Setup
            </button>
          </div>

          <div className="mb-8">
            <label className="block text-lg font-medium mb-2 text-slate-300">Selected Players</label>
            <div className="space-y-3">
              {PLAYER_COLORS.map((color: PlayerColor) => {
                const config = playerConfig[color];
                return (
                  <div
                    key={color}
                    onClick={() => toggleActive(color)}
                    className={`flex items-center justify-between p-3 rounded-lg transition-all duration-300 cursor-pointer border ${config.active ? PLAYER_TAILWIND_COLORS[color].bg.replace(/-[0-9]+/, '-800') + ' border-slate-400 ring-1 ring-white/20' : 'bg-slate-800/50 border-transparent opacity-50 hover:opacity-80'}`}
                  >
                    <div className="flex items-center space-x-3">
                      <div className={`w-5 h-5 rounded-full border ${config.active ? 'bg-cyan-500 border-white' : 'border-slate-500'}`}>
                        {config.active && <div className="w-full h-full flex items-center justify-center text-xs text-black font-bold">✓</div>}
                      </div>
                      <span className={`font-bold text-lg capitalize ${config.active ? PLAYER_TAILWIND_COLORS[color].text.replace(/-[0-9]+/, '-300') : 'text-slate-400'}`}>
                        {color}
                      </span>
                    </div>

                    {config.active && (
                      <div className="flex items-center space-x-2 animate-in fade-in zoom-in duration-300">
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleAI(color); }}
                          className="px-3 py-1 bg-slate-900/50 hover:bg-slate-900 rounded-md text-sm min-w-[90px] text-center font-mono text-white shadow-sm z-10"
                        >
                          {config.isAI ? '🤖 Comp' : '🧑 Human'}
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <button
            onClick={handleStart}
            className="w-full bg-green-600 hover:bg-green-500 text-white font-bold text-2xl py-4 rounded-lg shadow-xl transition transform hover:scale-105"
          >
            Start Match
          </button>
          <div className="mt-6 text-center">
            <button
              onClick={() => setMode('choice')}
              className="text-slate-400 hover:text-white"
            >
              &larr; Back to Main Menu
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- Main Menu View ---
  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] bg-slate-800 p-4 relative pt-20">
      {/* Conditionally render the Rejoin Game Banner */}
      {showRejoinBanner && activeGameInfo && (
        <RejoinGameBanner
          gameId={activeGameInfo.gameId}
          playerColor={activeGameInfo.playerColor}
          prize={(activeGameInfo.stake || 0) * 0.8}
          allPawnsHome={activeGameInfo.allPawnsHome}
          winners={activeGameInfo.winners}
          onRejoin={handleRejoin}
          onDismiss={handleDismissBanner}
        />
      )}

      <div className="fixed top-0 left-0 w-full p-2 flex justify-between items-center bg-slate-900/50 backdrop-blur-sm z-30 shadow-sm">
        <div className="flex items-center gap-2">
          {/* Super Admin Button */}
          {(() => {
            // Check for SUPER_ADMIN or ADMIN role
            const isSuperAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN';

            if (isSuperAdmin && onEnterSuperAdmin) {
              return (
                <button
                  onClick={onEnterSuperAdmin}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-purple-600 hover:bg-purple-700 border border-purple-500 transition-all duration-300 shadow-lg text-white font-bold mr-2 z-50"
                  title="Super Admin Dashboard"
                >
                  <span className="text-xl">⚡</span>
                  <span className="text-sm">Super Admin</span>
                </button>
              );
            }
            return null;
          })()}

          <button
            onClick={handleSignOut}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 hover:border-red-500/50 transition-all duration-300 shadow-lg text-red-400 hover:text-red-300"
            title="Sign Out"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
            <span className="text-sm font-bold hidden sm:inline">Sign Out</span>
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Wallet Balance Display */}
          <div
            onClick={onEnterWallet}
            className="flex items-center gap-2 px-2 sm:px-4 py-2 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 rounded-lg cursor-pointer transition-all duration-300 shadow-lg border border-green-400/30"
          >
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="flex flex-col items-start">
              <span className="text-xs text-green-100 font-medium hidden sm:inline">Balance</span>
              <span className="text-sm font-bold text-white">${user?.balance?.toFixed(2) || '0.00'}</span>
            </div>
          </div>

          {/* Gems Balance Display */}
          <div
            className="flex items-center gap-2 px-2 sm:px-4 py-2 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 rounded-lg cursor-pointer transition-all duration-300 shadow-lg border border-purple-400/30"
            title="Gems for re-rolls (1 gem = $0.01)"
          >
            <Gem className="w-5 h-5 text-white" />
            <div className="flex flex-col items-start">
              <span className="text-xs text-purple-100 font-medium hidden sm:inline">Gems</span>
              <span className="text-sm font-bold text-white">{user?.gems || 0}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 bg-slate-800/50 p-1.5 pr-4 rounded-full border border-slate-700/50">
            <img
              src={user.avatar || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.username}`}
              alt={user.username}
              className="w-10 h-10 rounded-full border-2 border-slate-600 shadow-md bg-slate-700 cursor-pointer hover:border-cyan-400 transition-colors"
              onClick={() => setShowStatsModal(true)}
            />
            <div className="text-left min-w-0">
              <div
                className="cursor-pointer hover:bg-slate-700/50 rounded px-1 -ml-1 transition-colors"
                onClick={() => setShowStatsModal(true)}
              >
                <p className="text-sm font-bold text-white leading-tight truncate max-w-[120px] sm:max-w-[150px]" title={user.username}>{user.username}</p>
                <p className="text-[10px] text-cyan-400 font-medium">View Stats</p>
              </div>
              <button
                onClick={() => {
                  const textToCopy = user.phone;
                  // Try modern API first
                  if (navigator.clipboard && window.isSecureContext) {
                    navigator.clipboard.writeText(textToCopy)
                      .then(() => toast.success('Phone number copied!', { id: 'copy-phone' }))
                      .catch((err) => {
                        console.error('Clipboard failed:', err);
                        toast.error('Failed to copy');
                      });
                  } else {
                    // Fallback for non-secure contexts (like HTTP on LAN)
                    const textArea = document.createElement("textarea");
                    textArea.value = textToCopy;

                    // Ensure it's not visible but part of DOM
                    textArea.style.position = "fixed";
                    textArea.style.left = "-999999px";
                    textArea.style.top = "-999999px";
                    document.body.appendChild(textArea);

                    textArea.focus();
                    textArea.select();

                    try {
                      document.execCommand('copy');
                      toast.success('Phone number copied!', { id: 'copy-phone' });
                    } catch (err) {
                      console.error('Fallback copy failed:', err);
                      toast.error('Failed to copy');
                    }

                    document.body.removeChild(textArea);
                  }
                }}
                className="flex items-center gap-1.5 group"
                title="Copy Phone Number"
              >
                <p className="text-xs text-slate-400 group-hover:text-cyan-400 transition-colors font-mono">{user.phone}</p>
                <Copy className="w-3 h-3 text-slate-500 group-hover:text-cyan-400 transition-colors" />
              </button>
            </div>
          </div>
        </div>

      </div>



      {/* Admin Quick Actions (Only visible to Admin/SuperAdmin/Whitelisted phones) */}
      {(user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN' || isMiniAdmin(user?.phone)) && (
        <AdminQuickActions />
      )}

      <img src="/icons/laddea.png" alt="Ludo Master Logo" className="w-20 h-auto mb-1 mt-2" />

      {/* WhatsApp Support Sliding Notification */}
      <div className="w-full max-w-md mb-4 px-2">
        <SlidingNotification
          text="Markii aad lacagta dhiganayso ama labaxayso whatsappka imoow, soo qor 1. magacaga 2. cadadka lacagta soo dirtay ama labaxaysid, 3. numberka gameka aad ku samaysatay"
          speed={35}
          bgColor="bg-green-500/10"
          textColor="text-green-50"
          className="rounded-xl border border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.1)]"
        />
      </div>

      <div className="bg-slate-700 p-4 rounded-xl shadow-2xl w-full max-w-md text-center border border-slate-600">
        <WithdrawalTestimonials />

        {/* Main Menu Buttons Stack */}
        <div className="space-y-3 w-full">
          {/* 1. Online (Ludo) Button */}
          <button
            onClick={() => {
              handleSelectGame('LUDO');
              onEnterLobby();
            }}
            disabled={user?.balance === undefined || user.balance <= 0}
            className={`w-full flex items-center justify-center gap-4 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-bold text-xl py-5 rounded-xl shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 border-b-4 border-blue-800 ${user?.balance !== undefined && user.balance > 0 ? '' : 'grayscale opacity-70 cursor-not-allowed'}`}
          >
            <span className="text-3xl filter drop-shadow-md">🎲</span>
            <span className="text-2xl tracking-wide drop-shadow-sm">Online</span>
          </button>

          {/* 2. JAR (Tic-Tac-Toe) Button - Hidden until ready */}
          {/* <button
            onClick={() => {
              handleSelectGame('TIC_TAC_TOE');
              onEnterLobby();
            }}
            disabled={user?.balance === undefined || user.balance <= 0}
            className={`w-full flex items-center justify-center gap-3 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-bold text-lg py-3 rounded-lg shadow-md transition-all transform hover:scale-[1.02] active:scale-95 border-b-4 border-orange-800 ${user?.balance !== undefined && user.balance > 0 ? '' : 'grayscale opacity-70 cursor-not-allowed'}`}
          >
            <span className="text-2xl">❌⭕</span>
            <div className="flex flex-col items-start leading-none">
              <span className="text-lg">JAR</span>
              <span className="text-[10px] text-amber-100 opacity-90">Win $0.09 • Stake $0.05</span>
            </div>
          </button> */}


          {/* Referrals Button - Temporarily Hidden */}
          {/* {onEnterReferrals && (
            <button
              onClick={onEnterReferrals}
              className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-cyan-600 to-purple-600 hover:from-cyan-700 hover:to-purple-700 text-white font-bold text-lg py-3 rounded-lg shadow-xl transition-all transform hover:scale-105 border-2 border-cyan-400/50"
            >
              <span className="text-2xl">🎁</span>
              <div className="flex flex-col items-start">
                <span className="text-sm text-cyan-100 font-medium">Referrals</span>
                <span className="text-xs text-cyan-200/80">Earn from friends</span>
              </div>
            </button>
          )} */}

          {/* WhatsApp Community Button */}
          <button
            onClick={() => setShowWhatsAppModal(true)}
            className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold text-lg py-3 rounded-lg shadow-xl transition-all transform hover:scale-105 border-2 border-green-400/40"
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            <div className="flex flex-col items-start">
              <span className="text-sm text-white font-medium">Kusoo biir</span>
              <span className="text-xs text-green-100/80">Join Community</span>
            </div>
          </button>

          {/* Live Matches Button */}
          {onEnterLiveMatches && (
            <button
              onClick={onEnterLiveMatches}
              className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-blue-500/20 to-indigo-500/20 hover:from-blue-500/30 hover:to-indigo-500/30 text-white font-bold text-lg py-3 rounded-lg shadow-xl transition-all transform hover:scale-105 border-2 border-blue-400/20 group"
            >
              <span className="text-2xl group-hover:animate-pulse">📡</span>
              <div className="flex flex-col items-start text-left">
                <span className="text-sm text-white font-bold">Ciyaaraha Socda</span>
                <span className="text-[10px] text-blue-200/60 uppercase tracking-widest">Live Watch Mode</span>
              </div>
            </button>
          )}

          {showInstallButton && onInstall && (
            <button
              onClick={onInstall}
              className="w-full flex items-center justify-center space-x-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xl py-4 rounded-lg shadow-xl transition transform hover:scale-105 border-2 border-blue-400/50 mt-4"
            >
              <span className="text-2xl">⬇️</span>
              <span>Install App</span>
            </button>
          )}

          {/* DEPOSIT / WITHDRAWAL BUTTON */}
          <button
            onClick={() => setShowDepositModal(true)}
            className="w-full flex items-center justify-center gap-4 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-500 hover:to-teal-600 text-white font-bold text-lg py-4 rounded-xl shadow-xl transition-all transform hover:scale-105 border-2 border-emerald-400/40 relative overflow-hidden group mt-4"
          >
            <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
            <span className="text-3xl group-hover:scale-110 transition-transform duration-300 drop-shadow-md">💰</span>
            <div className="flex flex-col items-start leading-tight gap-0.5">
              <span className="text-lg font-bold tracking-wide">Lacag dhigasho & labixid</span>
              <span className="text-[10px] text-emerald-200/80 uppercase tracking-widest font-black">Deposit & Withdrawal</span>
            </div>
          </button>

          {/* Mini Admin Dashboard Button - for whitelisted phones */}
          {isMiniAdmin(user?.phone) && onEnterMiniAdmin && (
            <button
              onClick={onEnterMiniAdmin}
              className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold text-lg py-3 rounded-lg shadow-xl transition-all transform hover:scale-105 border-2 border-amber-400/40 mt-4"
            >
              <span className="text-2xl">🛡️</span>
              <div className="flex flex-col items-start">
                <span className="text-sm font-bold">Admin Panel</span>
                <span className="text-[10px] text-amber-100/80 uppercase tracking-widest">Active Games & Requests</span>
              </div>
            </button>
          )}

          {/* Super Admin Button - Prominent in Main Menu */}
          {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && onEnterSuperAdmin && (
            <button
              onClick={onEnterSuperAdmin}
              className="w-full flex items-center justify-center space-x-3 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white font-bold text-xl py-4 rounded-lg shadow-xl transition transform hover:scale-105 border-2 border-purple-400/50 mt-4"
            >
              <span className="text-2xl">⚡</span>
              <span>Super Admin Dashboard</span>
            </button>
          )}
        </div>


      </div>

      {/* WhatsApp Community Modal */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 p-4" onClick={() => setShowWhatsAppModal(false)}>
          <div className="bg-gradient-to-br from-green-500 via-green-600 to-teal-600 rounded-2xl max-w-md w-full p-8 space-y-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-center">
              <div className="bg-white/20 backdrop-blur-sm rounded-full w-20 h-20 mx-auto mb-4 flex items-center justify-center">
                <svg className="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Kusoo biir Groupkaan! 🎮</h2>
            </div>

            <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 space-y-4 text-white">
              <p className="text-lg leading-relaxed">
                <span className="text-xl">👥</span> Waa halka ay <strong className="text-yellow-300">isugu yimaadaan dadka</strong> diyaarka u ah inay dheelaan game ka Som Ludo.
              </p>
              <p className="text-lg leading-relaxed">
                <span className="text-xl">🎯</span> Kusoo biir <strong className="text-yellow-300">kadibna la dheel</strong> qofkii diyaar ah!
              </p>
              <p className="text-lg leading-relaxed">
                <span className="text-xl">💰</span> Hel <strong className="text-yellow-300">ciyaartooyo badan</strong> oo diyaar ah!
              </p>
            </div>

            <div className="space-y-3">
              <a
                href={WHATSAPP_GROUP_LINK}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full bg-white hover:bg-gray-100 text-green-600 font-bold py-4 px-6 rounded-xl shadow-lg transition-all transform hover:scale-105 text-center"
              >
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  Kusoo biir hadda!
                </span>
              </a>
              <button
                onClick={() => setShowWhatsAppModal(false)}
                className="w-full bg-white/20 hover:bg-white/30 text-white font-semibold py-3 px-6 rounded-xl transition-all"
              >
                Xir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Deposit/Withdrawal WhatsApp Modal */}
      {showDepositModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-in fade-in zoom-in duration-200" onClick={() => setShowDepositModal(false)}>
          <div className="bg-gradient-to-br from-green-900 via-emerald-800 to-teal-900 rounded-3xl max-w-sm w-full p-6 shadow-[0_0_40px_rgba(16,185,129,0.3)] border border-green-500/30 relative" onClick={(e) => e.stopPropagation()}>
            <button 
              onClick={() => setShowDepositModal(false)}
              className="absolute top-4 right-4 text-emerald-200 hover:text-white transition-colors"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
            <div className="text-center mb-6 mt-2">
              <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-2xl w-20 h-20 mx-auto mb-4 flex items-center justify-center border border-green-500/30 shadow-[0_0_20px_rgba(16,185,129,0.2)] transform transition-transform hover:scale-105 duration-300">
                 <span className="text-4xl drop-shadow-[0_0_8px_rgba(16,185,129,0.8)]">💰</span>
              </div>
              <h2 className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-green-300 to-emerald-300 tracking-tight leading-tight">Lacag Dhigasho & Labixid</h2>
              <div className="bg-slate-950/40 rounded-xl p-4 mt-6 border border-slate-700/50">
                <p className="text-slate-200 text-sm font-medium leading-relaxed">
                  Fadlan hadii aad dooneyso lacag labixid iyo dhigasho la xariir nambarkaan hoose.
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-4 mt-4">
              <a 
                href={`https://wa.me/252611164682?text=${encodeURIComponent(`${user?.username || ''}\n${user?.phone || ''}\n\nAsc waxaan rabaa in laii shaqeeyo`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="relative bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500 border-2 border-green-400/50 hover:border-green-300 rounded-2xl p-4 flex items-center justify-center gap-3 shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all hover:shadow-[0_0_30px_rgba(16,185,129,0.6)] hover:-translate-y-1 group overflow-hidden"
              >
                <svg className="w-8 h-8 text-white drop-shadow-md z-10 group-hover:scale-110 transition-transform" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                <div className="flex flex-col items-start gap-0.5 z-10 w-full text-center items-center justify-center">
                  <span className="text-white font-black text-xl leading-none drop-shadow-md">+252 61 1164682</span>
                  <span className="text-green-200 text-[10px] uppercase tracking-widest font-bold">La xariir WhatsApp</span>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}



      {/* Player Stats Modal */}
      {showStatsModal && user && (
        <PlayerStatsModal
          user={user}
          onClose={() => setShowStatsModal(false)}
        />
      )}
      {/* Auto-refresh user when modal opens to ensure latest XP */}
      {showStatsModal && (
        <RefreshTrigger />
      )}
    </div>
  );
};

export default GameSetup;
