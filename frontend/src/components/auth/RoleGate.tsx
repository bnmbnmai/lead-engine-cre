import { Link } from 'react-router-dom';
import { UserX, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import DashboardLayout from '@/components/layout/DashboardLayout';

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
        dashboardPath: '/',
    },
};

export function RoleGate({ requiredRole, currentRole }: RoleGateProps) {
    const required = ROLE_INFO[requiredRole] || ROLE_INFO.BUYER;
    const current = ROLE_INFO[currentRole] || { label: currentRole, dashboardPath: '/' };

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
                        <Button asChild>
                            <Link to={current.dashboardPath}>
                                Go to {current.label} Dashboard
                                <ArrowRight className="h-4 w-4 ml-2" />
                            </Link>
                        </Button>
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
