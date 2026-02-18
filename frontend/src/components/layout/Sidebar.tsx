import { Link, useLocation } from 'react-router-dom';
import {
    LayoutDashboard,
    Gavel,
    BarChart3,
    Settings,
    FileText,
    Send,
    TrendingUp,
    ShoppingCart,
    X,
    Gem,
    Layers,
    Blocks,
    Zap,
    Briefcase,
    Plug,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarItem {
    href: string;
    label: string;
    icon: React.ReactNode;
}

interface SidebarProps {
    isOpen?: boolean;
    onClose?: () => void;
}

const marketplaceItems: SidebarItem[] = [
    { href: '/marketplace', label: 'Marketplace', icon: <ShoppingCart className="h-5 w-5" /> },
];

const buyerItems: SidebarItem[] = [
    { href: '/buyer', label: 'Overview', icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: '/buyer/bids', label: 'My Bids', icon: <Gavel className="h-5 w-5" /> },
    { href: '/buyer/portfolio', label: 'Portfolio', icon: <Briefcase className="h-5 w-5" /> },
    { href: '/buyer/analytics', label: 'Analytics', icon: <BarChart3 className="h-5 w-5" /> },
    { href: '/buyer/preferences', label: 'Auto Bidding', icon: <Settings className="h-5 w-5" /> },
    { href: '/buyer/integrations', label: 'Integrations', icon: <Plug className="h-5 w-5" /> },
];

const sellerItems: SidebarItem[] = [
    { href: '/seller', label: 'Overview', icon: <LayoutDashboard className="h-5 w-5" /> },
    { href: '/seller/funnels', label: 'My Funnels', icon: <Zap className="h-5 w-5" /> },
    { href: '/seller/leads', label: 'My Leads', icon: <FileText className="h-5 w-5" /> },
    { href: '/seller/submit', label: 'Submit Lead', icon: <Send className="h-5 w-5" /> },
    { href: '/seller/analytics', label: 'Analytics', icon: <TrendingUp className="h-5 w-5" /> },
    { href: '/seller/integrations', label: 'Integrations', icon: <Plug className="h-5 w-5" /> },
];

const adminItems: SidebarItem[] = [
    { href: '/admin/nfts', label: 'NFT Admin', icon: <Gem className="h-5 w-5" /> },
    { href: '/admin/verticals', label: 'Verticals', icon: <Layers className="h-5 w-5" /> },
    { href: '/admin/form-builder', label: 'Form Builder', icon: <Blocks className="h-5 w-5" /> },
];

function getContextItems(pathname: string) {
    if (pathname.startsWith('/admin')) return { label: 'Admin', items: adminItems };
    if (pathname.startsWith('/seller')) return { label: 'Seller', items: sellerItems };
    if (pathname.startsWith('/buyer')) return { label: 'Buyer', items: buyerItems };
    return { label: 'Marketplace', items: marketplaceItems };
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
    const location = useLocation();
    const { label, items } = getContextItems(location.pathname);

    const sidebarContent = (
        <div className="p-4 space-y-1">
            {/* Context Label */}
            <div className="px-4 py-2 mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {label}
                </span>
                {/* Mobile close button */}
                {onClose && (
                    <button
                        onClick={onClose}
                        className="lg:hidden p-1 rounded-md text-muted-foreground hover:text-foreground transition"
                    >
                        <X className="h-4 w-4" />
                    </button>
                )}
            </div>

            {items.map((item) => {
                const isActive = location.pathname === item.href;
                return (
                    <Link
                        key={item.href}
                        to={item.href}
                        onClick={onClose}
                        className={cn(
                            'flex items-center gap-3 px-4 py-3 rounded-lg transition-all text-sm',
                            isActive
                                ? 'bg-muted/60 text-foreground font-semibold border-l-2 border-emerald-500'
                                : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                        )}
                    >
                        {item.icon}
                        <span className="font-medium">{item.label}</span>
                    </Link>
                );
            })}

            {/* Quick-switch section */}
            <div className="pt-4 mt-4 border-t border-border space-y-1">
                <div className="px-4 py-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Quick Switch
                    </span>
                </div>
                {[
                    ...(label !== 'Marketplace'
                        ? [{ href: '/marketplace', label: 'Marketplace', icon: <ShoppingCart className="h-4 w-4" /> }]
                        : []),
                    ...(label !== 'Buyer'
                        ? [{ href: '/buyer', label: 'Buyer Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> }]
                        : []),
                    ...(label !== 'Seller'
                        ? [{ href: '/seller', label: 'Seller Dashboard', icon: <Send className="h-4 w-4" /> }]
                        : []),
                ].map((item) => (
                    <Link
                        key={item.href}
                        to={item.href}
                        onClick={onClose}
                        className="flex items-center gap-3 px-4 py-2 rounded-lg text-xs text-muted-foreground hover:bg-white/[0.04] hover:text-foreground transition-all"
                    >
                        {item.icon}
                        <span>{item.label}</span>
                    </Link>
                ))}
            </div>
        </div>
    );

    return (
        <>
            {/* Desktop Sidebar — always visible */}
            <aside className="fixed left-0 top-16 h-[calc(100vh-4rem)] w-64 border-r border-border bg-background/80 backdrop-blur-xl hidden lg:block overflow-y-auto">
                {sidebarContent}
            </aside>

            {/* Mobile Sidebar Drawer */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
                        onClick={onClose}
                    />
                    {/* Drawer */}
                    <aside className="fixed left-0 top-0 h-full w-72 z-50 bg-background border-r border-border lg:hidden sidebar-drawer-enter overflow-y-auto">
                        {/* Logo header in drawer */}
                        <div className="h-16 flex items-center px-6 border-b border-border">
                            <div className="w-8 h-8 rounded-lg bg-[#375BD2] flex items-center justify-center mr-2.5">
                                <span className="text-white font-bold text-sm">LE</span>
                            </div>
                            <span className="text-lg font-semibold tracking-tight">Lead Engine</span>
                        </div>
                        {sidebarContent}
                    </aside>
                </>
            )}
        </>
    );
}

export default Sidebar;
