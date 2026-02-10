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
        { href: '/', label: 'Home' },
        { href: '/marketplace', label: 'Marketplace' },
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
                {/* Logo */}
                <Link to="/" className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                        <span className="text-white font-bold text-xl">LE</span>
                    </div>
                    <span className="text-xl font-bold gradient-text hidden sm:inline">Lead Engine</span>
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

                    {/* Mobile Menu Button */}
                    <button
                        onClick={() => setIsMobileOpen(!isMobileOpen)}
                        className="md:hidden p-2 rounded-lg hover:bg-white/10 transition"
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
                                        : 'hover:bg-white/5'
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
