import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserX, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { setAuthToken, API_BASE_URL } from '@/lib/api';
import socketClient from '@/lib/socket';

// ============================================
// RoleGate — shown when user lacks required role
// ============================================

interface RoleGateProps {
    requiredRole: 'BUYER' | 'SELLER' | 'ADMIN';
    currentRole: string;
}

const ROLE_INFO: Record<string, { label: string; description: string; dashboardPath: string }> = {
    BUYER: {
        label: 'Buyer',
        description: 'Buyers can browse the marketplace, place bids on leads, set preferences, and track auction outcomes.',
        dashboardPath: '/buyer',
    },
    SELLER: {
        label: 'Seller',
        description: 'Sellers can submit leads, create auctions, manage their pipeline, and track revenue analytics.',
        dashboardPath: '/seller',
    },
    ADMIN: {
        label: 'Admin',
        description: 'Admins can manage users, review flagged content, and access platform-wide analytics.',
        dashboardPath: '/admin',
    },
};

export function RoleGate({ requiredRole, currentRole }: RoleGateProps) {
    const required = ROLE_INFO[requiredRole] || ROLE_INFO.BUYER;
    const current = ROLE_INFO[currentRole] || { label: currentRole, dashboardPath: '/' };
    const navigate = useNavigate();
    const [isSwitching, setIsSwitching] = useState(false);

    const isDemoEnv = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true';

    async function handleSwitch() {
        if (!isDemoEnv || isSwitching) return;
        setIsSwitching(true);

        try {
            if (requiredRole === 'ADMIN') {
                // Admin uses dedicated demo-admin-login endpoint
                const resp = await fetch(`${API_BASE_URL}/api/v1/demo-panel/demo-admin-login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: 'admin', password: 'admin' }),
                });
                const data = await resp.json();
                if (data.token) {
                    setAuthToken(data.token);
                    localStorage.setItem('le_auth_user', JSON.stringify(data.user));
                    socketClient.reconnect(data.token);
                }
            } else {
                // Buyer/Seller use demo-login endpoint
                const resp = await fetch(`${API_BASE_URL}/api/v1/demo-panel/demo-login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ role: requiredRole }),
                });
                const data = await resp.json();
                if (data.token) {
                    setAuthToken(data.token);
                    localStorage.setItem('le_auth_user', JSON.stringify(data.user));
                    socketClient.reconnect(data.token);
                }
            }

            // Trigger useAuth re-read
            window.dispatchEvent(new StorageEvent('storage', {
                key: 'le_auth_user',
                newValue: localStorage.getItem('le_auth_user'),
            }));

            navigate(required.dashboardPath);
        } catch (err) {
            console.error('[RoleGate] Persona switch failed:', err);
        } finally {
            setIsSwitching(false);
        }
    }

    return (
        <DashboardLayout>
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="max-w-md w-full p-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl text-center space-y-6">
                    {/* Icon */}
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
                        <UserX className="h-8 w-8 text-white" />
                    </div>

                    {/* Heading */}
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">
                            {required.label} profile required
                        </h1>
                        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                            This page is available to users with a <strong>{required.label}</strong> role.
                            You're currently signed in as <strong>{current.label}</strong>.
                        </p>
                    </div>

                    {/* What the role can do */}
                    <div className="p-4 rounded-xl bg-muted/50 text-left">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
                            What {required.label}s can do
                        </div>
                        <p className="text-sm text-foreground/80 leading-relaxed">
                            {required.description}
                        </p>
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-3">
                        {isDemoEnv ? (
                            <Button onClick={handleSwitch} disabled={isSwitching}>
                                {isSwitching ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : null}
                                Switch to {required.label} Persona
                                <ArrowRight className="h-4 w-4 ml-2" />
                            </Button>
                        ) : (
                            <Button asChild>
                                <Link to={current.dashboardPath}>
                                    Go to {current.label} Dashboard
                                    <ArrowRight className="h-4 w-4 ml-2" />
                                </Link>
                            </Button>
                        )}
                        <Link
                            to="/"
                            className="text-sm text-muted-foreground hover:text-foreground transition"
                        >
                            Back to Marketplace
                        </Link>
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default RoleGate;
