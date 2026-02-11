import { Link, useLocation } from 'react-router-dom';
import { Menu, ArrowLeftRight } from 'lucide-react';
import ConnectButton from '@/components/wallet/ConnectButton';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import useAuth from '@/hooks/useAuth';
import { useSidebar } from '@/components/layout/DashboardLayout';

export function Navbar() {
    const location = useLocation();
    const { isAuthenticated } = useAuth();

    // Try to get sidebar context (exists when inside DashboardLayout)
    let sidebarToggle: (() => void) | null = null;
    try {
        const sidebar = useSidebar();
        sidebarToggle = sidebar.toggle;
    } catch {
        // Not inside DashboardLayout — no sidebar toggle
    }

    const isOnSeller = location.pathname.startsWith('/seller');
    const isOnBuyer = location.pathname.startsWith('/buyer');

    const navLinks = [
        { href: '/marketplace', label: 'Marketplace' },
    ];

    if (isAuthenticated) {
        navLinks.push(
            { href: '/buyer', label: 'Buyer' },
            { href: '/seller', label: 'Seller' },
        );
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

                    {/* Quick role-switch */}
                    {isAuthenticated && (isOnBuyer || isOnSeller) && (
                        <Link
                            to={isOnSeller ? '/buyer' : '/seller'}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition px-3 py-1.5 rounded-lg bg-muted/50 hover:bg-muted"
                        >
                            <ArrowLeftRight className="h-3.5 w-3.5" />
                            Switch to {isOnSeller ? 'Buyer' : 'Seller'}
                        </Link>
                    )}
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
