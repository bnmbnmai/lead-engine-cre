import { Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Search,
    Gavel,
    BarChart3,
    Settings,
    FileText,
    Send,
    Tag,
    TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import useAuth from '@/hooks/useAuth';

interface SidebarItem {
    href: string;
    label: string;
    icon: React.ReactNode;
}

const buyerItems: SidebarItem[] = [
    { href: '/buyer', label: 'Overview', icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: '/', label: 'Marketplace', icon: <Search className="h-5 w-5" /> },
    { href: '/buyer/bids', label: 'My Bids', icon: <Gavel className="h-5 w-5" /> },
    { href: '/buyer/analytics', label: 'Analytics', icon: <BarChart3 className="h-5 w-5" /> },
    { href: '/buyer/preferences', label: 'Preferences', icon: <Settings className="h-5 w-5" /> },
];

const sellerItems: SidebarItem[] = [
    { href: '/seller', label: 'Overview', icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: '/seller/asks', label: 'My Asks', icon: <Tag className="h-5 w-5" /> },
    { href: '/seller/leads', label: 'My Leads', icon: <FileText className="h-5 w-5" /> },
    { href: '/seller/submit', label: 'Submit Lead', icon: <Send className="h-5 w-5" /> },
    { href: '/seller/analytics', label: 'Analytics', icon: <TrendingUp className="h-5 w-5" /> },
];

export function Sidebar() {
    const location = useLocation();
    const { user } = useAuth();

    const items = user?.role === 'SELLER' ? sellerItems : buyerItems;

    return (
        <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 border-r border-border bg-background/80 backdrop-blur-xl hidden lg:block">
            <div className="p-4 space-y-1">
                {items.map((item) => {
                    const isActive = location.pathname === item.href;
                    return (
                        <Link
                            key={item.href}
                            to={item.href}
                            className={cn(
                                'flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm',
                                isActive
                                    ? 'bg-primary text-primary-foreground'
                                    : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'
                            )}
                        >
                            {item.icon}
                            <span className="font-medium">{item.label}</span>
                        </Link>
                    );
                })}
            </div>
        </aside>
    );
}

export default Sidebar;
