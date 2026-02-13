import { Link, useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import ConnectButton from '@/components/wallet/ConnectButton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import useAuth from '@/hooks/useAuth';
import { useSidebar } from '@/components/layout/DashboardLayout';

export function Navbar() {
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();

    // Try to get sidebar context (exists when inside DashboardLayout)
    let sidebarToggle: (() => void) | null = null;
    try {
        const sidebar = useSidebar();
        sidebarToggle = sidebar.toggle;
    } catch {
        // Not inside DashboardLayout — no sidebar toggle
    }



    // Hide 'Marketplace' link on lander for unauth users (the lander IS the marketplace)
    const isOnLander = location.pathname === '/';
    const navLinks: { href: string; label: string }[] = [];

    // Show Marketplace link for auth users (they access it from dashboard)
    // or for unauth users not on the lander
    if (isAuthenticated || !isOnLander) {
        navLinks.push({ href: '/marketplace', label: 'Marketplace' });
    }

    if (isAuthenticated) {
        navLinks.push(
            { href: '/buyer', label: 'Buyer' },
            { href: '/seller', label: 'Seller' },
        );
        if (user?.role === 'ADMIN') {
            navLinks.push({ href: '/admin', label: 'Admin' });
        }
    }

    return (
        <nav className="fixed top-0 w-full z-30 glass">
            <div className="container mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
                {/* Left: Burger + Logo */}
                <div className="flex items-center gap-3">
                    {/* Mobile sidebar toggle */}
                    {sidebarToggle && (
                        <button
                            onClick={sidebarToggle}
                            className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-white/[0.06] transition"
                            aria-label="Toggle sidebar"
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                    )}

                    {/* Logo */}
                    <Link to="/" className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-lg bg-[#375BD2] flex items-center justify-center">
                            <span className="text-white font-bold text-base tracking-tight">LE</span>
                        </div>
                        <span className="text-lg font-semibold text-foreground hidden sm:inline tracking-tight">
                            Lead Engine
                        </span>
                    </Link>
                </div>

                {/* Center: Desktop Nav */}
                <div className="hidden md:flex items-center gap-6">
                    {navLinks.map((link) => {
                        const isActive = link.href === '/'
                            ? location.pathname === '/'
                            : location.pathname.startsWith(link.href);
                        return (
                            <Link
                                key={link.href}
                                to={link.href}
                                className={`text-sm font-medium transition ${isActive
                                    ? 'text-foreground'
                                    : 'text-muted-foreground hover:text-foreground'
                                    }`}
                            >
                                {link.label}
                            </Link>
                        );
                    })}


                </div>

                {/* Right: Theme + Wallet */}
                <div className="flex items-center gap-3">
                    <ThemeToggle />
                    <ConnectButton />
                </div>
            </div>
        </nav>
    );
}

export default Navbar;
