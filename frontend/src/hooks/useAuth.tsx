import { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import api, { setAuthToken, getAuthToken } from '@/lib/api';
import socketClient from '@/lib/socket';
import type { AuthError } from '@/components/ui/ErrorDialog';

// ============================================
// Types
// ============================================

interface User {
    id: string;
    walletAddress: string;
    role: 'BUYER' | 'SELLER' | 'ADMIN';
    kycStatus?: string;
    profile?: any;
}

interface AuthContextType {
    user: User | null;
    isLoading: boolean;
    isAuthenticated: boolean;
    authError: AuthError | null;
    login: () => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
    clearAuthError: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ============================================
// Auth Provider
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [authError, setAuthError] = useState<AuthError | null>(null);
    const autoLoginAttempted = useRef(false);
    const loginInProgress = useRef(false);

    const { address, isConnected, status } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const { disconnect } = useDisconnect();

    // ==== Wait for wagmi to settle ====
    // wagmi's status can be 'disconnected' briefly before 'reconnecting' on page load.
    // We track whether wagmi has "settled" — meaning it went through reconnecting
    // and came out the other side, OR it was never going to reconnect.
    const [wagmiReady, setWagmiReady] = useState(false);
    const hasSeenReconnecting = useRef(false);
    const sessionRestored = useRef(false);

    useEffect(() => {
        if (status === 'reconnecting') {
            hasSeenReconnecting.current = true;
            return;
        }
        // Once we've seen 'reconnecting' and now we're not, wagmi is ready
        if (hasSeenReconnecting.current) {
            setWagmiReady(true);
            return;
        }
        // If wagmi never enters 'reconnecting' (no saved connector), it goes
        // straight to 'disconnected' or 'connected'. Use a short delay to
        // distinguish "initial disconnected" from "truly no saved wallet".
        const timer = setTimeout(() => setWagmiReady(true), 150);
        return () => clearTimeout(timer);
    }, [status]);

    // ==== Session restore ====
    useEffect(() => {
        // E2E / Cypress bypass
        const e2eUser = localStorage.getItem('le_auth_user');
        if (e2eUser) {
            try {
                const parsed = JSON.parse(e2eUser);
                setUser({
                    id: parsed.id || 'e2e-user',
                    walletAddress: parsed.walletAddress || '0x0',
                    role: (parsed.role || 'buyer').toUpperCase() as User['role'],
                });
                setIsLoading(false);
                return;
            } catch {
                // Invalid JSON — fall through
            }
        }

        // Don't evaluate until wagmi has settled
        if (!wagmiReady) return;

        const token = getAuthToken();
        if (token && isConnected && !sessionRestored.current) {
            sessionRestored.current = true;
            refreshUser();
        } else if (token && !isConnected) {
            // Wallet truly disconnected — clear stale session
            setAuthToken(null);
            setUser(null);
            setIsLoading(false);
        } else {
            setIsLoading(false);
        }
    }, [wagmiReady, isConnected]);

    // ==== Auto-SIWE on wallet connect ====
    // When a wallet connects for the first time (no existing token),
    // automatically trigger SIWE sign-in so the user doesn't need a
    // separate "Sign In" button click.
    useEffect(() => {
        if (
            isConnected &&
            address &&
            !getAuthToken() &&
            !user &&
            !isLoading &&
            status === 'connected' &&
            !autoLoginAttempted.current &&
            wagmiReady &&
            !loginInProgress.current
        ) {
            autoLoginAttempted.current = true;
            login().catch(() => {
                // Error already captured in authError state
                autoLoginAttempted.current = false;
            });
        }
    }, [isConnected, address, status, isLoading, wagmiReady]);

    // Reset auto-login guard when wallet disconnects
    useEffect(() => {
        if (!isConnected) {
            autoLoginAttempted.current = false;
        }
    }, [isConnected]);

    // Connect socket when authenticated
    useEffect(() => {
        if (user) {
            socketClient.connect();
        }
        return () => {
            if (!user) {
                socketClient.disconnect();
            }
        };
    }, [user]);

    // Cross-tab logout: detect when auth_token is removed in another tab
    useEffect(() => {
        const onStorage = (e: StorageEvent) => {
            if (e.key === 'auth_token' && !e.newValue) {
                setUser(null);
                socketClient.disconnect();
            }
        };
        window.addEventListener('storage', onStorage);
        return () => window.removeEventListener('storage', onStorage);
    }, []);

    const refreshUser = async () => {
        try {
            const { data, error } = await api.getMe();
            if (error) {
                setAuthToken(null);
                setUser(null);
            } else {
                // Backend /auth/me returns user fields at top level (not nested under .user)
                const userData = data.user || data;
                setUser(userData);
            }
        } catch {
            setAuthToken(null);
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    };

    const login = async () => {
        if (loginInProgress.current) return;
        loginInProgress.current = true;

        if (!address) {
            loginInProgress.current = false;
            throw new Error('Wallet not connected');
        }

        setIsLoading(true);
        try {
            // Get nonce and SIWE message
            const { data: nonceData, error: nonceError } = await api.getNonce(address);
            if (nonceError || !nonceData) {
                throw new Error(nonceError?.error || 'Failed to get nonce');
            }

            // Sign message
            const signature = await signMessageAsync({ message: nonceData.message });

            // Verify signature and get token
            const { data: authData, error: authError } = await api.login(
                address,
                nonceData.message,
                signature
            );
            if (authError || !authData) {
                throw new Error(authError?.error || 'Authentication failed');
            }

            setAuthToken(authData.token);
            setUser(authData.user);
            setAuthError(null);
            socketClient.connect();
        } catch (err: any) {
            const msg = err?.message || '';
            if (msg.includes('User rejected') || msg.includes('user rejected') || err?.code === 4001) {
                setAuthError({
                    type: 'signature-rejected',
                    message: 'Please sign the message in your wallet to verify ownership. This is free and does not cost gas.',
                });
            } else if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed to get nonce')) {
                setAuthError({
                    type: 'network-error',
                    message: 'Unable to reach the server. Please check your connection and try again.',
                });
            } else {
                setAuthError({
                    type: 'generic',
                    message: msg || 'Authentication failed. Please try again.',
                });
            }
        } finally {
            loginInProgress.current = false;
            setIsLoading(false);
        }
    };

    const logout = async () => {
        try {
            await api.logout();
        } finally {
            setAuthToken(null);
            setUser(null);
            socketClient.disconnect();
            disconnect();
        }
    };

    const clearAuthError = () => setAuthError(null);

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated: !!user,
                authError,
                login,
                logout,
                refreshUser,
                clearAuthError,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

// ============================================
// Hook
// ============================================

export function useAuth() {
    const context = useContext(AuthContext);
    if (!context) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

export default useAuth;
