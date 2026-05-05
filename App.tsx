
import React, { useState, useEffect, useCallback } from 'react';
import Board from './components/GameBoard';
import Dice from './components/Dice';
import GameSetup from './components/GameSetup';
import PlayerInfo from './components/PlayerInfo';
import GameOverModal from './components/GameOverModal';
import QuickChat from './components/QuickChat';
import WinNotification from './components/WinNotification';
import { useGameLogic } from './hooks/useGameLogic';
import { useGlobalSocket } from './hooks/useGlobalSocket';
import MultiplayerLobby from './components/MultiplayerLobby';
import TicTacToeBoard from './components/TicTacToeBoard'; // NEW
import { useTicTacToeLogic } from './hooks/useTicTacToeLogic'; // NEW
import Login from './components/auth/Login';
import Register from './components/auth/Register';
import ResetPassword from './components/auth/ResetPassword';
import CompleteProfile from './components/auth/CompleteProfile';
import { AuthProvider, useAuth } from './context/AuthContext';
import type { Player, PlayerColor, MultiplayerGame, GameType } from './types'; // Updated types
import { debugService } from './services/debugService';
import DebugConsole from './components/DebugConsole';
import LiveMatchesModal from './components/LiveMatchesModal';
import { audioService } from './services/audioService';
import { notificationService, WinNotificationData } from './services/notificationService';


import SuperAdminDashboard from './components/superadmin/SuperAdminDashboard';
import MiniAdminDashboard from './components/MiniAdminDashboard';
import Wallet from './components/Wallet';
import ReferralDashboard from './components/ReferralDashboard';
import AdminDiceControl from './components/AdminDiceControl';
import CompactGemReroll from './components/CompactGemReroll';
import DepositToast from './components/DepositToast';
import { API_URL } from './lib/apiConfig';


type View = 'setup' | 'game' | 'multiplayer-lobby' | 'login' | 'register' | 'reset-password' | 'superadmin' | 'wallet';

interface MultiplayerConfig {
  gameId: string;
  localPlayerColor: PlayerColor;
  sessionId: string;
  playerId: string;
  stake?: number;
  isSpectator?: boolean;
  gameType?: GameType; // NEW: Support game type
}



import ErrorBoundary from './components/ErrorBoundary';

const AppContent: React.FC = () => {
  const [multiplayerConfig, setMultiplayerConfig] = useState<MultiplayerConfig | null>(null);

  // Conditionally initialize hooks based on game type
  // Note: Hooks rules require unconditional call, so we call both and use based on config
  const ludoLogic = useGameLogic(multiplayerConfig?.gameType !== 'TIC_TAC_TOE' ? multiplayerConfig : undefined);
  const ticTacToeLogic = useTicTacToeLogic(
    multiplayerConfig?.gameType === 'TIC_TAC_TOE' ? {
      ...multiplayerConfig,
      onRematchStart: (newGameId) => handleRematchAccepted(newGameId)
    } : undefined
  );

  // Destructure Ludo state for easy access (used in UI if Ludo)
  const { state: ludoState, startGame, handleRollDice, handleMoveToken, handleAnimationComplete, isMyTurn: isLudoMyTurn, setState: setLudoState, socket: ludoSocket } = ludoLogic;

  // Restore variables for existing Ludo code compatibility
  const state = ludoState;
  const isMyTurn = isLudoMyTurn;
  const setState = setLudoState;

  // Use appropriate socket based on active game  (Ludo only, TTT manages its own)
  const socket = ludoSocket;

  const { gameStarted, players, currentPlayerIndex, turnState, winners, timer } = ludoState;

  const { user, isAuthenticated, loading: authLoading, refreshUser, loginWithGoogleToken, logout } = useAuth();
  const [view, setView] = useState<View>('login');
  const [googleAuthError, setGoogleAuthError] = useState<string | null>(null);
  const [showSuperAdminOverlay, setShowSuperAdminOverlay] = useState(false);
  const [showMiniAdminDashboard, setShowMiniAdminDashboard] = useState(false);
  const [isRejoining, setIsRejoining] = useState(false); // New state for rejoining status
  const [showWallet, setShowWallet] = useState(false);
  const [showReferrals, setShowReferrals] = useState(false);
  const [showLiveMatches, setShowLiveMatches] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any | null>(null);
  const [winNotification, setWinNotification] = useState<WinNotificationData | null>(null);
  const [depositToastData, setDepositToastData] = useState<{ amount: number; type: 'DEPOSIT' | 'WITHDRAWAL'; newBalance: number; message: string } | null>(null);

  // Sifalo Pay: holds the order_id to verify once auth is confirmed
  const [pendingSifaloOrderId, setPendingSifaloOrderId] = useState<string | null>(null);
  const [pendingSifaloSid, setPendingSifaloSid] = useState<string | null>(null);

  // Connect to global socket for financial notifications
  useGlobalSocket(user?.id || user?._id, isAuthenticated);

  // Handle Google OAuth redirect — runs once on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const googleToken = params.get('google_token');
    const authError = params.get('auth_error');

    // ── Sifalo Pay return detection ──
    const isSifaloReturn = params.get('sifalo_deposit') === '1';
    const sifaloOrderId = params.get('order_id');
    const sifaloSid = params.get('sid');

    if (googleToken) {
      // Clear the token from the URL immediately
      window.history.replaceState({}, document.title, window.location.pathname);
      loginWithGoogleToken(googleToken)
        .then(() => setView('setup'))
        .catch(() => setGoogleAuthError('Google login failed. Please try again.'));
    } else if (authError) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const messages: Record<string, string> = {
        google_denied: 'Google sign-in was cancelled.',
        token_failed: 'Google sign-in failed. Please try again.',
        server_error: 'Server error during Google login. Please try again.',
      };
      setGoogleAuthError(messages[authError] || 'Google login failed. Please try again.');
    } else if (isSifaloReturn && sifaloOrderId) {
      // Clear URL params, store pending verification
      window.history.replaceState({}, document.title, window.location.pathname);
      setPendingSifaloOrderId(sifaloOrderId);
      if (sifaloSid) setPendingSifaloSid(sifaloSid);
    }
  }, []);

  // Once authenticated, process any pending Sifalo Pay verification
  useEffect(() => {
    if (!pendingSifaloOrderId || !isAuthenticated || authLoading) return;

    const verifyDeposit = async () => {
      try {
        const token = localStorage.getItem('ludo_token');
        const res = await fetch(`${API_URL}/wallet/sifalo-verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            order_id: pendingSifaloOrderId,
            sid: pendingSifaloSid || undefined,
            userId: user?.id || user?._id,
          }),
        });

        const data = await res.json();
        setPendingSifaloOrderId(null);
        setPendingSifaloSid(null);

        if (data.success) {
          if (refreshUser) await refreshUser();
          // Fire BALANCE_CREDITED so the DepositToast shows
          window.dispatchEvent(new CustomEvent('BALANCE_CREDITED', {
            detail: {
              amount: data.amount || 0,
              type: 'DEPOSIT',
              newBalance: data.newBalance || 0,
              message: `✅ $${(data.amount || 0).toFixed(2)} si toos ah loo dhigay! (${data.paymentType || 'Sifalo Pay'})`,
            }
          }));
          // Open the wallet so the user can see their new balance
          setShowWallet(true);
        } else {
          // Show failure toast
          window.dispatchEvent(new CustomEvent('BALANCE_CREDITED', {
            detail: {
              amount: 0,
              type: 'DEPOSIT',
              newBalance: user?.balance || 0,
              message: `❌ Lacag-dhigasho la diidey: ${data.error || 'Payment not completed'}`,
            }
          }));
        }
      } catch (e) {
        console.error('[SifaloPay] Verify error in App.tsx:', e);
        setPendingSifaloOrderId(null);
        setPendingSifaloSid(null);
      }
    };

    verifyDeposit();
  }, [pendingSifaloOrderId, isAuthenticated, authLoading]);


  // --- OneSignal Push Notification Initialization (v16 SDK) ---
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const savePlayerId = async (playerId: string) => {
      if (!playerId) return;
      console.log('🔔 Syncing OneSignal ID to DB:', playerId);
      const token = localStorage.getItem('ludo_token');
      try {
        await fetch(`${API_URL}/notifications/player-id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ playerId })
        });
        console.log('✅ OneSignal ID synced.');
      } catch (e) {
        console.error('Failed to sync OneSignal ID:', e);
      }
    };

    // v16 SDK uses window.OneSignalDeferred
    (window as any).OneSignalDeferred = (window as any).OneSignalDeferred || [];
    (window as any).OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        await OneSignal.init({
          appId: '0416f4a4-ca9d-42c6-8106-eb44fa34f0ab',
          safari_web_id: 'web.onesignal.auto.5a5a1f6a-128a-4933-871d-531e21b06385',
          notifyButton: { enable: false },
          allowLocalhostAsSecureOrigin: true,
        });

        // Check if already subscribed and sync the ID
        const playerId = await OneSignal.User.PushSubscription.id;
        if (playerId) {
          await savePlayerId(playerId);
        }

        // Listen for new subscriptions
        OneSignal.User.PushSubscription.addEventListener('change', async (event: any) => {
          if (event.current?.isSubscribed) {
            const newId = event.current.id;
            if (newId) await savePlayerId(newId);
          }
        });

        console.log('✅ OneSignal v16 initialized successfully');
      } catch (err) {
        console.error('❌ OneSignal v16 Init Error:', err);
      }
    });
  }, [isAuthenticated, user]);

  // Unlock audio on first user interaction
  useEffect(() => {
    const handler = () => {
      audioService.unlock();
      window.removeEventListener('pointerdown', handler);
    };
    window.addEventListener('pointerdown', handler, { once: true });
    return () => window.removeEventListener('pointerdown', handler);
  }, []);

  // Render Super Admin Overlay
  const renderSuperAdminOverlay = () => {
    if (!showSuperAdminOverlay) return null;
    return (
      <div className="fixed inset-0 z-50 bg-white flex items-center justify-center">
        <div className="w-full h-full overflow-auto">
          <ErrorBoundary name="Super Admin Dashboard">
            <SuperAdminDashboard onExit={() => setShowSuperAdminOverlay(false)} />
          </ErrorBoundary>
        </div>
      </div>
    );
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault();
      // Stash the event so it can be triggered later.
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // Effect to listen for multiplayer game state updates from another tab
  useEffect(() => {
    if (!multiplayerConfig) {
      console.log('No multiplayer config, skipping broadcast channel setup');
      return;
    }

    console.log('Setting up broadcast channel for game:', multiplayerConfig.gameId);
    const channel = new BroadcastChannel(`ludo-game-${multiplayerConfig.gameId}`);

    const handleMessage = (event: MessageEvent) => {
      const { type, payload } = event.data;
      console.log('📡 Broadcast message received:', type, 'from session:', payload?.sessionId, 'local session:', multiplayerConfig.sessionId);
      if (type === 'GAME_STATE_UPDATE' && payload.sessionId !== multiplayerConfig.sessionId) {
        console.log('📡 Updating state from broadcast channel for game:', multiplayerConfig.gameId);
        setState(payload.state);
      } else if (type === 'GAME_STATE_UPDATE' && payload.sessionId === multiplayerConfig.sessionId) {
        console.log('📡 Ignoring broadcast message from own session');
      }
    };

    channel.addEventListener('message', handleMessage);

    return () => {
      console.log('Cleaning up broadcast channel');
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [multiplayerConfig]);

  // Effect to listen for win notifications from socket
  useEffect(() => {
    if (!socket) return;

    const handleWinNotification = (data: WinNotificationData) => {
      console.log('🎉 Win notification received:', data);
      // Only show notification if this user is the winner
      if (user && (data.winnerId === user.id || data.winnerId === user._id)) {
        notificationService.showWinNotification(data);
        setWinNotification(data);
      }
    };

    socket.on('win_notification', handleWinNotification);

    return () => {
      socket.off('win_notification', handleWinNotification);
    };
  }, [socket, user]);

  // Listen for the custom BALANCE_CREDITED event to show DepositToast
  useEffect(() => {
    const handleBalanceCredited = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        setDepositToastData(customEvent.detail);
      }
    };
    window.addEventListener('BALANCE_CREDITED', handleBalanceCredited);
    return () => window.removeEventListener('BALANCE_CREDITED', handleBalanceCredited);
  }, []);


  useEffect(() => {
    if (isRejoining && gameStarted) {
      console.log('✅ Game state received after rejoin, setting isRejoining to false');
      setIsRejoining(false);
    }
  }, [isRejoining, gameStarted]);

  const handleStartGame = useCallback((gamePlayers: Player[], mpConfig?: MultiplayerConfig) => {
    console.log('🎮 handleStartGame called with:', { gamePlayers: gamePlayers?.length, mpConfig });

    try {
      if (mpConfig) {
        console.log('🎲 Setting up multiplayer game');
        // Only update config if it's actually different to prevent unnecessary re-renders
        setMultiplayerConfig(prev => {
          if (prev?.gameId === mpConfig.gameId &&
            prev?.localPlayerColor === mpConfig.localPlayerColor &&
            prev?.sessionId === mpConfig.sessionId &&
            prev?.playerId === mpConfig.playerId) {
            return prev; // Same config, don't update
          }
          return mpConfig;
        });
        // For multiplayer, initialize with the provided players
        startGame(gamePlayers);
        // Persist a small rejoin blob so the user can return after refresh/disconnect
        try {
          const savedPlayerId = mpConfig.playerId || user?.id || user?._id || mpConfig.sessionId;
          const rejoinBlob = {
            gameId: mpConfig.gameId,
            playerId: savedPlayerId,
            playerColor: mpConfig.localPlayerColor,
            sessionId: mpConfig.sessionId,
            stake: mpConfig.stake || 0,
          };
          localStorage.setItem('ludo_rejoin', JSON.stringify(rejoinBlob));
          console.log('✅ Saved rejoin info to localStorage', rejoinBlob);
        } catch (e) {
          console.warn('⚠️ Failed to persist rejoin info', e);
        }
      } else {
        console.log('🎲 Setting up local game');
        // For local games
        startGame(gamePlayers);
      }
      setView('game');
      console.log('✅ Game view set successfully');
    } catch (error) {
      console.error('❌ Error in handleStartGame:', error);
      (window as any).gameStarting = false;
    }
  }, [startGame]);

  const handleRestart = () => {
    window.location.reload();
  };

  const handleEnterLobby = () => setView('multiplayer-lobby');
  const handleEnterSuperAdmin = async () => {
    // Refresh user data before showing SuperAdmin dashboard
    if (refreshUser) {
      await refreshUser();
    }
    setShowSuperAdminOverlay(true);
  };

  const handleEnterMiniAdmin = async () => {
    if (refreshUser) {
      await refreshUser();
    }
    setShowMiniAdminDashboard(true);
  };
  const handleToggleWallet = async () => {
    if (!showWallet) {
      if (refreshUser) {
        await refreshUser();
      }
    }
    setShowWallet(prev => !prev);
  }

  const handleEnterWallet = async () => {
    // Refresh user data before showing wallet
    if (refreshUser) {
      await refreshUser();
    }
    setShowWallet(true);
  };

  const handleExitWallet = () => {
    setShowWallet(false);
    // Refresh user data after wallet operations
    if (refreshUser) {
      refreshUser();
    }
  };

  const handleEnterReferrals = async () => {
    // Refresh user data before showing referral dashboard
    if (refreshUser) {
      await refreshUser();
    }
    setShowReferrals(true);
  };

  const handleExitReferrals = () => {
    setShowReferrals(false);
  };

  const handleEnterLiveMatches = () => {
    setShowLiveMatches(true);
  };

  const handleWatchGame = (gameId: string) => {
    console.log(`👀 Watching game ${gameId}`);
    setShowLiveMatches(false);

    // Create a spectator config
    const mpConfig: MultiplayerConfig = {
      gameId,
      localPlayerColor: 'red', // Dummy color for spectator
      sessionId: Math.random().toString(36).substring(2, 10),
      playerId: user?.id || user?._id || 'spectator',
      isSpectator: true
    };

    setMultiplayerConfig(mpConfig);
    setView('game');
  };

  // Auto-navigate to setup view if user is already authenticated
  useEffect(() => {
    if (isAuthenticated && !authLoading && view === 'login') {
      console.log('👤 User already authenticated, setting view to setup');
      setView('setup');
    }
  }, [isAuthenticated, authLoading, view, user]);

  const handleLoginSuccess = () => {
    // Check if user is Super Admin and redirect to dashboard
    let userStr = localStorage.getItem('ludo_user');
    // Defensive: handle legacy/broken storage where the string "undefined" was stored
    if (userStr === 'undefined') {
      console.warn('⚠️ Found invalid ludo_user value in localStorage, clearing');
      localStorage.removeItem('ludo_user');
      localStorage.removeItem('ludo_token');
      userStr = null;
    }

    setView('setup');
  };

  const handleRegisterSuccess = () => setView('setup');
  const handleSwitchToRegister = () => setView('register');
  const handleSwitchToLogin = () => setView('login');
  const handleSwitchToResetPassword = () => setView('reset-password');
  const handleResetPasswordSuccess = () => setView('login');

  const handleRejoinGame = useCallback((gameId: string, playerColor: PlayerColor) => {
    console.log(`🎮 handleRejoinGame called!`);
    console.log(`🔄 Rejoining game ${gameId} as ${playerColor}`);
    console.log(`👤 User:`, user);

    if (!user) {
      console.error('❌ Cannot rejoin: user not authenticated');
      alert('Please login to rejoin the game');
      return;
    }

    setIsRejoining(true); // Set rejoining state
    // Generate a session ID for this rejoin
    const sessionId = Math.random().toString(36).substring(2, 10);
    const playerId = user.id || user._id || user.username;

    console.log(`📋 Player ID for rejoin: ${playerId}`);

    // Create multiplayer config for rejoining
    const mpConfig: MultiplayerConfig = {
      gameId,
      localPlayerColor: playerColor,
      sessionId,
      playerId: playerId,
    };

    console.log(`✅ Rejoin config created:`, mpConfig);

    // Set the multiplayer config and switch to game view
    setMultiplayerConfig(mpConfig);
    setView('game');

    // Persist rejoin info for dashboard fallback (in case of refresh/disconnect)
    try {
      localStorage.setItem('ludo_rejoin', JSON.stringify({
        gameId: mpConfig.gameId,
        playerId: mpConfig.playerId,
        playerColor: mpConfig.localPlayerColor,
        sessionId: mpConfig.sessionId
      }));
      console.log('✅ Persisted rejoin blob for rejoin flow');
    } catch (e) {
      console.warn('⚠️ Failed to persist rejoin info', e);
    }

    // The actual state will be updated when we receive GAME_STATE_UPDATE from server
    // startGame(placeholderPlayers) is removed as it's no longer needed;
    // the UI will display a loading state until the real game state arrives.

    console.log('✅ Rejoin complete, game view set, view is now:', 'game');
  }, [user, setIsRejoining, setView]);

  const handleRematchAccepted = useCallback((newGameId: string) => {
    console.log(`🔄 Rematch starting: ${newGameId}`);
    if (multiplayerConfig) {
      setMultiplayerConfig({
        ...multiplayerConfig,
        gameId: newGameId
      });
      // View is already 'game', useGameLogic will handle reconnection automatically
    } else {
      // Fallback if config is lost
      window.location.reload();
    }
  }, [multiplayerConfig]);

  const handleInstallClick = () => {
    if (!installPrompt) {
      return;
    }
    // Show the install prompt
    installPrompt.prompt();
    // Wait for the user to respond to the prompt
    installPrompt.userChoice.then((choiceResult: any) => {
      if (choiceResult.outcome === 'accepted') {
        console.log('User accepted the install prompt');
      } else {
        console.log('User dismissed the install prompt');
      }
      // We can't use the prompt again, so clear it
      setInstallPrompt(null);
    });
  };

  // Show loading while checking authentication
  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading...</div>
      </div>
    );
  }

  // Show login/register/reset password if not authenticated
  if (!isAuthenticated) {
    if (view === 'login') {
      return <Login onSuccess={handleLoginSuccess} onSwitchToRegister={handleSwitchToRegister} onSwitchToResetPassword={handleSwitchToResetPassword} googleAuthError={googleAuthError} />;
    }
    if (view === 'register') {
      return <Register onSuccess={handleRegisterSuccess} onSwitchToLogin={handleSwitchToLogin} />;
    }
    if (view === 'reset-password') {
      return <ResetPassword onSuccess={handleResetPasswordSuccess} onCancel={handleSwitchToLogin} />;
    }
    // Default to login if not authenticated
    return <Login onSuccess={handleLoginSuccess} onSwitchToRegister={handleSwitchToRegister} />;
  }

  // -------------------------
  // AUTHENTICATED RENDER LOOP
  // -------------------------

  // Force users without a phone number to complete their profile first
  if (user && !user.phone) {
    return <CompleteProfile onSuccess={() => setView('setup')} onSkip={logout} />;
  }

  // Authenticated: Show main game interface
  return (
    <>
      <audio id="click-sound" src="/sounds/click.mp3" preload="auto"></audio>
      {renderSuperAdminOverlay()}
      {showMiniAdminDashboard && (
        <MiniAdminDashboard onClose={() => setShowMiniAdminDashboard(false)} />
      )}
      {showWallet && <Wallet onClose={handleExitWallet} />}
      {showReferrals && <ReferralDashboard onClose={handleExitReferrals} />}
      {winNotification && (
        <WinNotification
          playerName={winNotification.winnerUsername}
          grossWin={winNotification.grossWin}
          netAmount={winNotification.netAmount}
          platformFee={winNotification.commission}
          onClose={() => setWinNotification(null)}
          onNavigateToWallet={handleEnterWallet}
        />
      )}

      {depositToastData && (
        <DepositToast
          amount={depositToastData.amount}
          type={depositToastData.type}
          newBalance={depositToastData.newBalance}
          message={depositToastData.message}
          onClose={() => setDepositToastData(null)}
        />
      )}

      {view === 'setup' && (
        <GameSetup
          onStartGame={handleStartGame}
          onEnterLobby={handleEnterLobby}
          onRejoinGame={handleRejoinGame}
          onEnterSuperAdmin={handleEnterSuperAdmin}
          onEnterMiniAdmin={handleEnterMiniAdmin}
          onEnterWallet={handleEnterWallet}
          onEnterReferrals={handleEnterReferrals}
          onEnterLiveMatches={handleEnterLiveMatches}
          onInstall={handleInstallClick}
          showInstallButton={!!installPrompt}
        />
      )}

      {view === 'multiplayer-lobby' && (
        <MultiplayerLobby
          onStartGame={handleStartGame}
          onExit={() => setView('setup')}
        />
      )}

      {view === 'game' && (
        <div className="min-h-screen bg-slate-800 flex flex-col">
          {isRejoining && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
              <div className="bg-white p-6 rounded-lg shadow-xl">
                <p className="text-xl font-bold">Rejoining game...</p>
              </div>
            </div>
          )}
          {/* PlayerInfo cards removed as per user request */}
          {/* <div className="flex-shrink-0 p-4 flex justify-between items-start">
            <div className="flex gap-2 flex-wrap">
              {players.map((p, i) => (
                <PlayerInfo
                  key={p.color}
                  player={p}
                  tokens={state.tokens}
                  isCurrentPlayer={i === currentPlayerIndex}
                  winners={winners}
                  message={state.message}
                />
              ))}
            </div>
            <button
              onClick={handleRestart}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition h-10"
            >
              Exit Game
            </button>
          </div> */}

          {/* Prize Display - Only visible to players, not spectators */}
          {multiplayerConfig && state.stake && state.stake > 0 && !multiplayerConfig.isSpectator && (
            <div className="fixed top-2 left-1/2 transform -translate-x-1/2 z-10">
              <div className="bg-gradient-to-r from-yellow-500 to-yellow-600 text-white px-3 py-1 rounded-full shadow-md border border-yellow-300">
                <div className="flex items-center gap-1.5">
                  <span className="text-base">🏆</span>
                  <div className="text-center">
                    <div className="text-[8px] font-semibold uppercase tracking-wide opacity-90 leading-tight">Prize</div>
                    <div className="text-sm font-bold leading-tight">${((state.stake || 0) * 0.8).toFixed(2)}</div>
                  </div>
                  <span className="text-base">💰</span>
                </div>
              </div>
            </div>
          )}


          {multiplayerConfig?.isSpectator && (
            <div className="absolute top-4 right-4 z-20">
              <button
                onClick={handleRestart}
                className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg transition shadow-lg font-bold text-sm"
              >
                Exit Spectator Mode
              </button>
            </div>
          )}

          <div className="flex-1 flex items-center justify-center p-2">
            <div className="max-w-[700px] w-full aspect-square">
              {multiplayerConfig?.gameType === 'TIC_TAC_TOE' ? (
                ticTacToeLogic.state ? (
                  <TicTacToeBoard
                    gameState={ticTacToeLogic.state}
                    onCellClick={ticTacToeLogic.makeMove}
                    isMyTurn={ticTacToeLogic.isMyTurn}
                    mySymbol={ticTacToeLogic.mySymbol!}
                    onExit={handleRestart}
                    onRematch={ticTacToeLogic.requestRematch}
                    rematchRequested={ticTacToeLogic.rematchRequested}
                    ticTacToeLogic={ticTacToeLogic}
                    opponentRematchRequested={ticTacToeLogic.opponentRematchRequested}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-white">
                    <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                    <p>Loading JAR...</p>
                  </div>
                )
              ) : (
                <Board
                  gameState={ludoState}
                  onMoveToken={handleMoveToken}
                  onAnimationComplete={handleAnimationComplete}
                  isMyTurn={isLudoMyTurn}
                  perspectiveColor={multiplayerConfig?.localPlayerColor}
                />
              )}
            </div>
          </div>

          <div className="flex-shrink-0 p-2 flex flex-col items-center gap-4">
            {multiplayerConfig?.gameType !== 'TIC_TAC_TOE' && (
              <Dice
                value={ludoState.diceValue}
                onRoll={handleRollDice}
                isMyTurn={isLudoMyTurn}
                playerColor={players[currentPlayerIndex]?.color || 'red'}
                timer={timer}
                turnState={turnState}
                potAmount={ludoState.stake}
              />
            )}
          </div>

          {/* Compact Gem Reroll - Positioned above chat button */}
          {multiplayerConfig && isMyTurn && !multiplayerConfig.isSpectator && (
            <div className="fixed bottom-24 right-6 z-50">
              <CompactGemReroll
                gameId={multiplayerConfig.gameId}
                userId={user?.id || user?._id || ''}
                socket={socket}
                userGems={user?.gems || 0}
                rerollsUsed={state.rerollsUsed?.[user?.id || user?._id || ''] || 0}
                maxRerolls={4}
                currentPlayerTurn={isMyTurn}
                turnState={state.turnState}
                onRerollSuccess={async () => {
                  // Refresh user gems in background
                  if (refreshUser) await refreshUser();
                }}
              />
            </div>
          )}

          {/* Quick Chat - Only for multiplayer games */}
          {multiplayerConfig && socket && (
            <QuickChat
              gameId={multiplayerConfig.gameId}
              socket={socket}
              userId={multiplayerConfig.playerId}
              playerColor={multiplayerConfig.localPlayerColor}
            />
          )}

          {winners.length > 0 && (
            <GameOverModal
              winners={winners}
              players={players}
              onRestart={handleRestart}
              prize={(state.stake || 0) * 0.8}
              socket={socket}
              gameId={multiplayerConfig?.gameId || null}
              stakeAmount={state.stake || multiplayerConfig?.stake}
              localPlayerColor={multiplayerConfig?.localPlayerColor}
              onRematchAccepted={handleRematchAccepted}
            />
          )}



          {/* Admin Dice Control */}
          {user && (user.phone === '252615552432' || user.phone === '+252615552432' || user.phone === '615552432') && (
            <AdminDiceControl
              socket={socket}
              gameId={multiplayerConfig?.gameId || null}
            />
          )}
        </div>
      )}

      {view === 'superadmin' && (
        <SuperAdminDashboard onExit={() => setView('setup')} />
      )}

      {showLiveMatches && (
        <LiveMatchesModal
          onClose={() => setShowLiveMatches(false)}
          onWatch={handleWatchGame}
        />
      )}
    </>
  );
};

// Main App component with AuthProvider wrapper
const App: React.FC = () => {
  return (
    <AuthProvider>
      <AppContent />
      <DebugConsole />
    </AuthProvider>
  );
};

export default App;
