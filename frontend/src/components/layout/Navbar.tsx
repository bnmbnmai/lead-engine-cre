import { Link, useLocation } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useState } from 'react';
import ConnectButton from '@/components/wallet/ConnectButton';
import useAuth from '@/hooks/useAuth';

export function Navbar() {
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const location = useLocation();
    const { isAuthenticated, user } = useAuth();

    const navLinks = [
        { href: '/', label: 'Marketplace' },
    ];

    if (isAuthenticated) {
        if (user?.role === 'BUYER') {
            navLinks.push({ href: '/buyer', label: 'Dashboard' });
        } else if (user?.role === 'SELLER') {
            navLinks.push({ href: '/seller', label: 'Dashboard' });
        }
    }

    return (
        <nav className="fixed top-0 w-full z-50 glass">
            <div className="container mx-auto px-6 py-4 flex items-center justify-between">
                {/* Logo — Chainlink-inspired solid blue */}
                <Link to="/" className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg bg-[#375BD2] flex items-center justify-center">
                        <span className="text-white font-bold text-base tracking-tight">LE</span>
                    </div>
                    <span className="text-lg font-semibold text-foreground hidden sm:inline tracking-tight">
                        Lead Engine
                    </span>
                </Link>

                {/* Desktop Nav */}
                <div className="hidden md:flex items-center gap-8">
                    {navLinks.map((link) => (
                        <Link
                            key={link.href}
                            to={link.href}
                            className={`text-sm font-medium transition ${location.pathname === link.href
                                ? 'text-foreground'
                                : 'text-muted-foreground hover:text-foreground'
                                }`}
                        >
                            {link.label}
                        </Link>
                    ))}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-4">
                    <ConnectButton />

                    {/* Mobile Menu */}
                    <button
                        onClick={() => setIsMobileOpen(!isMobileOpen)}
                        className="md:hidden p-2 rounded-lg hover:bg-white/[0.06] transition"
                    >
                        {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                    </button>
                </div>
            </div>

            {/* Mobile Nav */}
            {isMobileOpen && (
                <div className="md:hidden glass border-t border-border">
                    <div className="container mx-auto px-6 py-4 space-y-2">
                        {navLinks.map((link) => (
                            <Link
                                key={link.href}
                                to={link.href}
                                onClick={() => setIsMobileOpen(false)}
                                className={`block px-4 py-3 rounded-lg transition ${location.pathname === link.href
                                    ? 'bg-primary/10 text-primary'
                                    : 'hover:bg-white/[0.04]'
                                    }`}
                            >
                                {link.label}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </nav>
    );
}

export default Navbar;
