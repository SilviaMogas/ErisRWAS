import React, { createContext, useContext, useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { User } from '../types';
import { firebaseUserService, signInToFirebaseWithPrivy, signOutOfFirebase } from '../services/firebase';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string, type: 'investor' | 'rwa-project', isDemo?: boolean) => Promise<void>;
  loginWithPrivy: () => void;
  logout: () => void;
  isLoading: boolean;
  isPrivyAuthenticated: boolean;
  privyUser: any;
  walletAddress: string | undefined;
  // New role selection methods
  needsRoleSelection: boolean;
  setUserRole: (role: 'investor' | 'rwa-project') => Promise<void>;
  refreshUser: () => Promise<void>;
  clearAllSessions: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsRoleSelection, setNeedsRoleSelection] = useState(false);
  
  // Check if Privy is available
  const appId = import.meta.env.VITE_PRIVY_APP_ID;
  const isPrivyAvailable = appId && appId !== 'dummy-build-value';
  
  console.log('Privy Config:', { appId, isPrivyAvailable });
  
  // Conditionally use Privy hooks
  let privyLogin: (() => void) | undefined;
  let privyLogout: (() => void) | undefined;
  let isPrivyAuthenticated = false;
  let privyUser: any = null;
  let getPrivyAccessToken: (() => Promise<string | null>) | undefined;
  let walletAddress: string | undefined;
  
  try {
    if (isPrivyAvailable) {
      const privyHooks = usePrivy();
      const accountHooks = useAccount();
      
      privyLogin = privyHooks.login;
      privyLogout = privyHooks.logout;
      isPrivyAuthenticated = privyHooks.authenticated;
      privyUser = privyHooks.user;
      getPrivyAccessToken = privyHooks.getAccessToken;
      walletAddress = accountHooks.address;
    }
  } catch (error) {
    console.warn('Privy hooks not available:', error);
  }

  // Load user from Firebase or localStorage
  const loadUser = async () => {
    setIsLoading(true);
    
    try {
      // Check for existing session in localStorage first
      const savedUser = localStorage.getItem('rwa-user');
      if (savedUser) {
        const localUser = JSON.parse(savedUser);
        setUser(localUser);
        setNeedsRoleSelection(false);
        setIsLoading(false);
        return;
      }

      // If Privy is authenticated, check Firebase for user
      if (isPrivyAuthenticated && privyUser) {
        await handlePrivyAuthentication();
      }
    } catch (error) {
      console.error('Error loading user:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const ensureFirebaseSession = async (userId: string) => {
    if (!getPrivyAccessToken) throw new Error('Privy is not available');
    await signInToFirebaseWithPrivy(userId, getPrivyAccessToken);
  };

  // Handle Privy authentication and Firebase sync
  const handlePrivyAuthentication = async () => {
    if (!privyUser) return;

    try {
      const userId = privyUser.id;
      await ensureFirebaseSession(userId);

      const firebaseUser = await firebaseUserService.getUserById(userId);

      if (firebaseUser?.type) {
        // Record last login
        await firebaseUserService.recordLastLogin(firebaseUser.id);
        
        // Convert to local user format
        const localUser = firebaseUserService.convertToLocalUser(firebaseUser);
        setUser(localUser);
        localStorage.setItem('rwa-user', JSON.stringify(localUser));
        setNeedsRoleSelection(false);
      } else {
        // User exists in Privy but not in Firebase, needs role selection
        setNeedsRoleSelection(true);
      }
    } catch (error) {
      console.error('Error handling Privy authentication:', error);
      setNeedsRoleSelection(true);
    }
  };

  // Set user role after selection
  const setUserRole = async (role: 'investor' | 'rwa-project') => {
    if (!privyUser) {
      throw new Error('No authenticated user found');
    }

    try {
      setIsLoading(true);

      const userId = privyUser.id;
      const email = privyUser.email?.address || privyUser.wallet?.address || 'unknown@privy.com';
      const name = privyUser.email?.address?.split('@')[0] || privyUser.wallet?.address?.slice(0, 8) || 'Privy User';

      await ensureFirebaseSession(userId);

      // Create user with selected role
      const firebaseUser = await firebaseUserService.createUserWithRole(
        {
          id: userId,
          email,
          name,
          walletAddress,
          isPrivyUser: true,
        },
        role
      );

      // Convert to local user and save
      const localUser = firebaseUserService.convertToLocalUser(firebaseUser);
      setUser(localUser);
      localStorage.setItem('rwa-user', JSON.stringify(localUser));
      setNeedsRoleSelection(false);
    } catch (error) {
      console.error('Error setting user role:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  // Refresh user data from Firebase
  const refreshUser = async () => {
    if (!user?.id) return;

    try {
      if (privyUser?.id !== user.id) return;
      await ensureFirebaseSession(user.id);
      const firebaseUser = await firebaseUserService.getUserById(user.id);
      if (firebaseUser) {
        const localUser = firebaseUserService.convertToLocalUser(firebaseUser);
        setUser(localUser);
        localStorage.setItem('rwa-user', JSON.stringify(localUser));
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  // Traditional login (for demo accounts)
  const login = async (email: string, password: string, type: 'investor' | 'rwa-project', isDemo: boolean = false) => {
    let mockUser: User;

    if (isDemo) {
      // Demo accounts with pre-filled data
      if (type === 'investor') {
        mockUser = {
          id: 'demo-investor-1',
          email: 'investor@demo.com',
          name: 'Michael Harrison',
          type: 'investor',
          kycStatus: 'approved',
          profileCompleted: true,
          subscriptionTier: 'premium',
        };
      } else {
        mockUser = {
          id: 'demo-originator-1',
          email: 'originator@demo.com',
          name: 'Sarah Chen',
          type: 'rwa-project',
          kycStatus: 'approved',
          profileCompleted: true,
          subscriptionTier: 'premium',
        };
      }
    } else {
      // New user accounts with empty profiles
      mockUser = {
        id: `new-${type}-${Date.now()}`,
        email,
        name: email.split('@')[0],
        type,
        kycStatus: type === 'investor' ? 'pending' : undefined,
        profileCompleted: false,
        subscriptionTier: type === 'investor' ? 'free' : undefined,
      };
    }
    
    setUser(mockUser);
    localStorage.setItem('rwa-user', JSON.stringify(mockUser));
  };

  const loginWithPrivy = () => {
    if (privyLogin) {
      privyLogin();
    }
  };

  // Force clear all sessions (for testing/debugging)
  const clearAllSessions = () => {
    setUser(null);
    setNeedsRoleSelection(false);
    localStorage.clear();
    void signOutOfFirebase();
    if (privyLogout) {
      privyLogout();
    }
    window.location.reload();
  };

  const logout = () => {
    setUser(null);
    setNeedsRoleSelection(false);
    localStorage.removeItem('rwa-user');
    void signOutOfFirebase();
    // Clear any Privy cached data
    localStorage.removeItem('privy:token');
    localStorage.removeItem('privy:refresh_token');
    if (privyLogout && isPrivyAuthenticated) {
      privyLogout();
    }
  };

  // Load user on mount and when Privy auth changes
  useEffect(() => {
    console.log('Auth state changed:', { isPrivyAuthenticated, hasPrivyUser: !!privyUser, hasUser: !!user });
    loadUser();
  }, [isPrivyAuthenticated, privyUser]);

  return (
    <AuthContext.Provider value={{ 
      user, 
      login, 
      loginWithPrivy,
      logout, 
      isLoading,
      isPrivyAuthenticated,
      privyUser,
      walletAddress,
      needsRoleSelection,
      setUserRole,
      refreshUser,
      clearAllSessions
    }}>
      {children}
    </AuthContext.Provider>
  );
};