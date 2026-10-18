import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { User } from '../types';

// Firebase configuration
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const firebaseAuth = getAuth(app);

// Exchanges the caller's Privy access token for a Firebase custom token so
// Firestore rules can match request.auth.uid against the Privy user id.
export async function signInToFirebaseWithPrivy(
  privyUserId: string,
  getPrivyAccessToken: () => Promise<string | null>
): Promise<void> {
  if (firebaseAuth.currentUser?.uid === privyUserId) return;

  const accessToken = await getPrivyAccessToken();
  if (!accessToken) throw new Error('Missing Privy access token');

  const response = await fetch('/api/firebase-token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Firebase token exchange failed (${response.status})`);

  const { token } = (await response.json()) as { token?: string };
  if (!token) throw new Error('Firebase token exchange returned no token');

  const credential = await signInWithCustomToken(firebaseAuth, token);
  if (credential.user.uid !== privyUserId) {
    await signOut(firebaseAuth);
    throw new Error('Firebase identity does not match the Privy user');
  }
}

export async function signOutOfFirebase(): Promise<void> {
  if (firebaseAuth.currentUser) await signOut(firebaseAuth);
}

function assertSignedInAs(userId: string): void {
  if (!userId || firebaseAuth.currentUser?.uid !== userId) {
    throw new Error('Not signed in to Firebase as this user');
  }
}

// User document interface for Firebase
export interface FirebaseUser {
  id: string;
  email: string;
  name: string;
  type: 'investor' | 'rwa-project';
  walletAddress?: string;
  kycStatus?: 'pending' | 'approved' | 'rejected';
  profileCompleted?: boolean;
  subscriptionTier?: 'free' | 'premium';
  isPrivyUser?: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  lastLoginAt?: Timestamp;
  // Additional role-specific fields
  investorProfile?: {
    riskTolerance?: 'low' | 'medium' | 'high';
    investmentExperience?: 'beginner' | 'intermediate' | 'advanced';
    preferredAssetTypes?: string[];
    totalInvested?: number;
  };
  originatorProfile?: {
    companyName?: string;
    companySize?: 'startup' | 'small' | 'medium' | 'large';
    industry?: string;
    totalProjectsListed?: number;
    totalFundsRaised?: number;
  };
}

// Firebase service class
export class FirebaseUserService {
  private static instance: FirebaseUserService;
  
  static getInstance(): FirebaseUserService {
    if (!FirebaseUserService.instance) {
      FirebaseUserService.instance = new FirebaseUserService();
    }
    return FirebaseUserService.instance;
  }

  // Get user by ID
  async getUserById(userId: string): Promise<FirebaseUser | null> {
    try {
      assertSignedInAs(userId);
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) {
        return userDoc.data() as FirebaseUser;
      }
      return null;
    } catch (error) {
      console.error('Error fetching user by ID:', error);
      throw error;
    }
  }

  // Create new user
  async createUser(userData: Omit<FirebaseUser, 'createdAt' | 'updatedAt'>): Promise<FirebaseUser> {
    try {
      assertSignedInAs(userData.id);
      const userRef = doc(db, 'users', userData.id);
      const newUser: FirebaseUser = {
        ...userData,
        createdAt: serverTimestamp() as Timestamp,
        updatedAt: serverTimestamp() as Timestamp,
      };
      
      await setDoc(userRef, newUser);
      return newUser;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    }
  }

  // Update user
  async updateUser(userId: string, updates: Partial<FirebaseUser>): Promise<void> {
    try {
      assertSignedInAs(userId);
      const userRef = doc(db, 'users', userId);
      await updateDoc(userRef, {
        ...updates,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    }
  }

  // Update user role and create role-specific profile
  async updateUserRole(userId: string, role: 'investor' | 'rwa-project'): Promise<void> {
    try {
      const updates: Partial<FirebaseUser> = {
        type: role,
      };

      // Initialize role-specific profile
      if (role === 'investor') {
        updates.investorProfile = {
          riskTolerance: 'medium',
          investmentExperience: 'beginner',
          preferredAssetTypes: [],
          totalInvested: 0,
        };
      } else {
        updates.originatorProfile = {
          companyName: '',
          companySize: 'startup',
          industry: '',
          totalProjectsListed: 0,
          totalFundsRaised: 0,
        };
      }

      await this.updateUser(userId, updates);
    } catch (error) {
      console.error('Error updating user role:', error);
      throw error;
    }
  }

  // Record last login
  async recordLastLogin(userId: string): Promise<void> {
    try {
      await this.updateUser(userId, {
        lastLoginAt: serverTimestamp() as Timestamp,
      });
    } catch (error) {
      console.error('Error recording last login:', error);
      throw error;
    }
  }

  // Convert Firebase user to local User interface
  convertToLocalUser(firebaseUser: FirebaseUser): User {
    return {
      id: firebaseUser.id,
      email: firebaseUser.email,
      name: firebaseUser.name,
      type: firebaseUser.type,
      walletAddress: firebaseUser.walletAddress,
      kycStatus: firebaseUser.kycStatus,
      profileCompleted: firebaseUser.profileCompleted,
      subscriptionTier: firebaseUser.subscriptionTier,
      isPrivyUser: firebaseUser.isPrivyUser,
    };
  }

  // Check if user needs role selection
  async userNeedsRoleSelection(userId: string): Promise<boolean> {
    try {
      const user = await this.getUserById(userId);
      return !user || !user.type;
    } catch (error) {
      console.error('Error checking if user needs role selection:', error);
      return true; // Default to showing role selection on error
    }
  }

  // Create user with role selection
  async createUserWithRole(
    userData: {
      id: string;
      email: string;
      name: string;
      walletAddress?: string;
      isPrivyUser?: boolean;
    },
    role: 'investor' | 'rwa-project'
  ): Promise<FirebaseUser> {
    try {
      const existingUser = await this.getUserById(userData.id);
      if (existingUser) {
        await this.updateUserRole(userData.id, role);
        return (await this.getUserById(userData.id)) ?? existingUser;
      }

      const newUserData: Omit<FirebaseUser, 'createdAt' | 'updatedAt'> = {
        ...userData,
        type: role,
        profileCompleted: false,
      };

      // Add role-specific defaults
      if (role === 'investor') {
        newUserData.kycStatus = 'pending';
        newUserData.subscriptionTier = 'free';
        newUserData.investorProfile = {
          riskTolerance: 'medium',
          investmentExperience: 'beginner',
          preferredAssetTypes: [],
          totalInvested: 0,
        };
      } else {
        newUserData.originatorProfile = {
          companyName: '',
          companySize: 'startup',
          industry: '',
          totalProjectsListed: 0,
          totalFundsRaised: 0,
        };
      }

      return await this.createUser(newUserData);
    } catch (error) {
      console.error('Error creating user with role:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const firebaseUserService = FirebaseUserService.getInstance();