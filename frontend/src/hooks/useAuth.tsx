import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useAccount, useSignMessage, useDisconnect } from 'wagmi';
import api, { setAuthToken, getAuthToken } from '@/lib/api';
import socketClient from '@/lib/socket';

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
    login: () => Promise<void>;
    logout: () => Promise<void>;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ============================================
// Auth Provider
// ============================================

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    const { address, isConnected } = useAccount();
    const { signMessageAsync } = useSignMessage();
    const { disconnect } = useDisconnect();

    // Check existing session on mount
    useEffect(() => {
        // E2E / Cypress bypass: if le_auth_user is set in localStorage
        // (by cy.stubAuth), use that mock user directly without wagmi
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
                // Invalid JSON — fall through to normal flow
            }
        }

        const token = getAuthToken();
        if (token && isConnected) {
            refreshUser();
        } else {
            setIsLoading(false);
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
                setUser(data.user);
            }
        } catch {
            setAuthToken(null);
            setUser(null);
        } finally {
            setIsLoading(false);
        }
    };

    const login = async () => {
        if (!address) {
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
            socketClient.connect();
        } finally {
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

    return (
        <AuthContext.Provider
            value={{
                user,
                isLoading,
                isAuthenticated: !!user,
                login,
                logout,
                refreshUser,
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
