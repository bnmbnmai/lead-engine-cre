import { ReactNode } from 'react';
import useAuth from '@/hooks/useAuth';
import AuthGate from './AuthGate';
import RoleGate from './RoleGate';

// ============================================
// ProtectedRoute — auth + optional role guard
// ============================================

interface ProtectedRouteProps {
    children: ReactNode;
    /** Optional role requirement. If omitted, only authentication is checked. */
    role?: 'BUYER' | 'SELLER' | 'ADMIN';
}

export function ProtectedRoute({ children, role }: ProtectedRouteProps) {
    const { user, isLoading, isAuthenticated } = useAuth();

    // Show nothing while checking auth (prevents flash)
    if (isLoading) {
        return (
            <div className="min-h-screen bg-background flex items-center justify-center">
                <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
        );
    }

    // Not authenticated → sign-in prompt
    if (!isAuthenticated) {
        return <AuthGate />;
    }

    // Authenticated but wrong role
    if (role && user?.role !== role) {
        return <RoleGate requiredRole={role} currentRole={user?.role || 'UNKNOWN'} />;
    }

    // All clear
    return <>{children}</>;
}

export default ProtectedRoute;
