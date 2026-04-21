import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { authAPI } from '../services/authAPI';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (phone: string, password: string) => Promise<void>;
  register: (fullName: string, phone: string, password: string, referralCode?: string) => Promise<void>;
  loginWithGoogleToken: (token: string) => Promise<void>;
  logout: () => void;
  requestPasswordReset: (phoneOrUsername: string) => Promise<void>;
  resetPassword: (token: string, newPassword: string) => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Wrapped in useCallback so the LUDO_REFRESH_USER listener always has a stable, up-to-date reference
  const refreshUser = useCallback(async () => {
    const storedToken = localStorage.getItem('ludo_token');
    if (!storedToken) {
      return; // No token, can't refresh
    }

    try {
      const currentUser = await authAPI.getCurrentUser();
      // Update user with fresh data from server
      setUser(currentUser);
      // Update localStorage with fresh user data
      localStorage.setItem('ludo_user', JSON.stringify(currentUser));
      console.log('✅ User data refreshed from server');
    } catch (error: any) {
      // NEVER clear storage on refresh - keep user logged in
      const errorMessage = error?.message || '';
      console.log('ℹ️ Could not refresh user data, keeping existing session:', errorMessage);
    }
  }, []); // setUser from useState is always stable — safe with empty deps

  useEffect(() => {
    // Check for stored authentication token
    const storedUser = localStorage.getItem('ludo_user');
    const storedToken = localStorage.getItem('ludo_token');

    if (storedUser && storedToken) {
      try {
        const userData = JSON.parse(storedUser);
        // Immediately restore user from localStorage and keep them logged in
        setUser(userData);
        setLoading(false);

        // Refresh user data in the background
        refreshUser();
      } catch {
        // Invalid JSON in localStorage, clear it
        console.warn('⚠️ Invalid user data in localStorage, clearing');
        localStorage.removeItem('ludo_user');
        localStorage.removeItem('ludo_token');
        setUser(null);
        setLoading(false);
      }
    } else {
      setLoading(false);
    }
  }, [refreshUser]);

  // Listen for global user refresh events (admin balance change, XP gain, etc.)
  useEffect(() => {
    const handleRefresh = () => {
      console.log('🔄 Global user refresh triggered');
      refreshUser();
    };

    window.addEventListener('LUDO_REFRESH_USER', handleRefresh);
    return () => window.removeEventListener('LUDO_REFRESH_USER', handleRefresh);
  }, [refreshUser]);

  const login = async (phone: string, password: string) => {
    const response = await authAPI.login(phone, password);
    setUser(response.user);
    localStorage.setItem('ludo_user', JSON.stringify(response.user));
    localStorage.setItem('ludo_token', response.token);
  };

  const register = async (fullName: string, phone: string, password: string, referralCode?: string) => {
    const response = await authAPI.register(fullName, phone, password, referralCode);
    setUser(response.user);
    localStorage.setItem('ludo_user', JSON.stringify(response.user));
    localStorage.setItem('ludo_token', response.token);
  };

  const loginWithGoogleToken = async (token: string) => {
    localStorage.setItem('ludo_token', token);
    try {
      const currentUser = await authAPI.getCurrentUser();
      setUser(currentUser);
      localStorage.setItem('ludo_user', JSON.stringify(currentUser));
    } catch (err) {
      localStorage.removeItem('ludo_token');
      throw new Error('Failed to load user from Google token');
    }
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('ludo_user');
    localStorage.removeItem('ludo_token');
  };

  const requestPasswordReset = async (phoneOrUsername: string) => {
    await authAPI.requestPasswordReset(phoneOrUsername);
  };

  const resetPassword = async (token: string, newPassword: string) => {
    await authAPI.resetPassword(token, newPassword);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        register,
        loginWithGoogleToken,
        logout,
        requestPasswordReset,
        resetPassword,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
