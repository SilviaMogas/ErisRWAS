import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePrivy } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { firebaseUserService, signInToFirebaseWithPrivy } from '../../services/firebase';
import { User, Users, ArrowRight, Shield, Star } from 'lucide-react';

const LoginSimple: React.FC = () => {
  const [userType, setUserType] = useState<'investor' | 'rwa-project'>('investor');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const { login, authenticated, user, getAccessToken } = usePrivy();
  const { address } = useAccount();
  const navigate = useNavigate();

  const handleContinue = async () => {
    if (!authenticated) {
      // First authenticate with Privy
      setIsLoading(true);
      try {
        await login();
        // After successful login, the useEffect will handle the rest
      } catch (error) {
        console.error('Privy authentication failed:', error);
        setIsLoading(false);
      }
    } else {
      // User is authenticated, save role to Firebase and navigate
      await saveUserRoleAndNavigate();
    }
  };

  const saveUserRoleAndNavigate = async () => {
    if (!user) return;

    setIsProcessing(true);
    try {
      const userId = user.id;
      const email = user.email?.address || user.wallet?.address || 'unknown@privy.com';
      const name = user.email?.address?.split('@')[0] || user.wallet?.address?.slice(0, 8) || 'Privy User';

      await signInToFirebaseWithPrivy(userId, getAccessToken);

      // Create or update user with selected role in Firebase
      const firebaseUser = await firebaseUserService.createUserWithRole(
        {
          id: userId,
          email,
          name,
          walletAddress: address,
          isPrivyUser: true,
        },
        userType
      );

      console.log('User saved to Firebase:', firebaseUser);

      // Navigate to dashboard
      navigate('/dashboard');
    } catch (error) {
      console.error('Error saving user role:', error);
      // Still navigate on error, but could show a toast notification
      navigate('/dashboard');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle post-authentication flow
  React.useEffect(() => {
    if (authenticated && user && isLoading) {
      // User just completed authentication, stop loading state
      setIsLoading(false);
    }
  }, [authenticated, user, isLoading]);

  // Check if user already has a role and redirect if they do
  React.useEffect(() => {
    const checkExistingUser = async () => {
      if (authenticated && user && !isLoading && !isProcessing) {
        try {
          await signInToFirebaseWithPrivy(user.id, getAccessToken);
          const existingUser = await firebaseUserService.getUserById(user.id);
          if (existingUser && existingUser.type) {
            console.log('User already has role:', existingUser.type);
            // User already has a role, redirect to dashboard
            navigate('/dashboard');
          }
        } catch (error) {
          console.log('User not found in Firebase, needs to select role');
        }
      }
    };
    
    checkExistingUser();
  }, [authenticated, user, isLoading, isProcessing, navigate, getAccessToken]);

  const LogoComponent = () => (
    <div className="relative w-12 h-12">
      {/* Outer cosmic ring */}
      <div className="absolute inset-0 rounded-full border-2 border-gradient-to-r from-emerald-400 to-blue-400 animate-pulse"></div>
      
      {/* Inner glow effect */}
      <div className="absolute inset-1 rounded-full bg-gradient-to-r from-emerald-500 to-blue-500 opacity-20 animate-pulse"></div>
      
      {/* Core symbol */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-6 h-6 bg-gradient-to-r from-emerald-600 to-blue-600 rounded-full shadow-lg">
          <div className="w-full h-full rounded-full border-2 border-white/30"></div>
        </div>
      </div>
      
      {/* Orbiting elements */}
      <div className="absolute inset-0">
        <div className="absolute top-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-emerald-400 rounded-full animate-bounce"></div>
        <div className="absolute bottom-1 left-1/2 transform -translate-x-1/2 w-1 h-1 bg-blue-400 rounded-full animate-bounce delay-75"></div>
        <div className="absolute left-1 top-1/2 transform -translate-y-1/2 w-1 h-1 bg-purple-400 rounded-full animate-bounce delay-150"></div>
        <div className="absolute right-1 top-1/2 transform -translate-y-1/2 w-1 h-1 bg-pink-400 rounded-full animate-bounce delay-300"></div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex">
      {/* Left side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-emerald-600 via-blue-600 to-purple-600 relative overflow-hidden">
        <div className="absolute inset-0 bg-black/20"></div>
        <div className="relative z-10 flex flex-col justify-center items-center text-center p-12 text-white">
          <div className="mb-8">
            <LogoComponent />
          </div>
          <h1 className="text-4xl font-bold mb-4">ErisRWA Platform</h1>
          <p className="text-xl mb-8 opacity-90">
            Tokenizing Real-World Assets for the Future
          </p>
          
          {/* Feature highlights */}
          <div className="space-y-4 max-w-md">
            <div className="flex items-center space-x-3">
              <Shield className="h-5 w-5 text-emerald-300" />
              <span className="text-sm">Secure blockchain technology</span>
            </div>
            <div className="flex items-center space-x-3">
              <Star className="h-5 w-5 text-blue-300" />
              <span className="text-sm">Professional asset management</span>
            </div>
            <div className="flex items-center space-x-3">
              <ArrowRight className="h-5 w-5 text-purple-300" />
              <span className="text-sm">Seamless Web3 integration</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right side - Login Form */}
      <div className="flex-1 flex flex-col justify-center px-4 sm:px-6 lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm lg:w-96">
          <div className="text-center mb-8">
            <Link to="/" className="inline-block mb-4 lg:hidden">
              <LogoComponent />
            </Link>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome to ErisRWA</h2>
            <p className="text-gray-600">Choose your platform access and continue</p>
          </div>

          <div className="space-y-6">
            {/* Platform Access Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-4">Platform Access</label>
              <div className="grid grid-cols-1 gap-3">
                <button
                  type="button"
                  onClick={() => setUserType('investor')}
                  className={`flex items-center p-4 rounded-xl border-2 transition-all duration-200 ${
                    userType === 'investor'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 shadow-lg'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <User className="h-6 w-6 mr-3" />
                  <div className="text-left flex-1">
                    <div className="font-semibold">Investor Platform</div>
                    <div className="text-sm opacity-75">Browse and invest in tokenized real-world assets</div>
                  </div>
                  {userType === 'investor' && (
                    <div className="w-2 h-2 bg-emerald-500 rounded-full"></div>
                  )}
                </button>
                
                <button
                  type="button"
                  onClick={() => setUserType('rwa-project')}
                  className={`flex items-center p-4 rounded-xl border-2 transition-all duration-200 ${
                    userType === 'rwa-project'
                      ? 'border-blue-500 bg-blue-50 text-blue-700 shadow-lg'
                      : 'border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <Users className="h-6 w-6 mr-3" />
                  <div className="text-left flex-1">
                    <div className="font-semibold">Originator Platform</div>
                    <div className="text-sm opacity-75">List and manage your real-world asset projects</div>
                  </div>
                  {userType === 'rwa-project' && (
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  )}
                </button>
              </div>
            </div>

            {/* Authentication Status */}
            {authenticated ? (
              <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="flex items-center text-green-700 mb-2">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                  Authentication Complete
                </div>
                <p className="text-sm text-green-600">
                  {user?.email?.address && `Signed in as ${user.email.address}`}
                  {user?.wallet?.address && !user?.email?.address && `Connected wallet ${user.wallet.address.slice(0, 8)}...`}
                </p>
              </div>
            ) : (
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                <p className="text-sm text-blue-700">
                  Click continue to authenticate with Privy using your wallet, email, or social account.
                </p>
              </div>
            )}

            {/* Continue Button */}
            <button
              onClick={handleContinue}
              disabled={isLoading || isProcessing}
              className={`w-full flex items-center justify-center py-3 px-4 rounded-xl font-semibold transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-[1.02] ${
                userType === 'investor'
                  ? 'bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white'
                  : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white'
              } disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none`}
            >
              {isLoading ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Authenticating...
                </>
              ) : isProcessing ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Setting up your account...
                </>
              ) : authenticated ? (
                <>
                  <ArrowRight className="h-5 w-5 mr-2" />
                  Continue to Platform
                </>
              ) : (
                <>
                  <Shield className="h-5 w-5 mr-2" />
                  Continue with Privy
                </>
              )}
            </button>

            {/* Footer Links */}
            <div className="text-center space-y-2">
              <p className="text-xs text-gray-500">
                By continuing, you agree to our{' '}
                <Link to="/terms" className="text-blue-600 hover:text-blue-700 underline">
                  Terms of Service
                </Link>{' '}
                and{' '}
                <Link to="/privacy" className="text-blue-600 hover:text-blue-700 underline">
                  Privacy Policy
                </Link>
              </p>
              <div className="flex justify-center space-x-4 text-sm text-gray-500">
                <Link to="/about-us" className="hover:text-gray-700">About Us</Link>
                <Link to="/contact" className="hover:text-gray-700">Contact</Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginSimple;