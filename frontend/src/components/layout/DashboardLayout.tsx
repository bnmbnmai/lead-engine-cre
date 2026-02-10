import { ReactNode, useState, createContext, useContext } from 'react';
import Navbar from './Navbar';
import Sidebar from './Sidebar';
import useAuth from '@/hooks/useAuth';

// ============================================
// Sidebar Context — allows Navbar to toggle
// ============================================

interface SidebarContextType {
    isOpen: boolean;
    toggle: () => void;
    close: () => void;
}

const SidebarContext = createContext<SidebarContextType>({
    isOpen: false,
    toggle: () => { },
    close: () => { },
});

export function useSidebar() {
    return useContext(SidebarContext);
}

// ============================================
// Layout
// ============================================

interface DashboardLayoutProps {
    children: ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const { isAuthenticated } = useAuth();

    const ctx: SidebarContextType = {
        isOpen: sidebarOpen,
        toggle: () => setSidebarOpen((p) => !p),
        close: () => setSidebarOpen(false),
    };

    return (
        <SidebarContext.Provider value={ctx}>
            <div className="min-h-screen bg-background">
                <Navbar />
                {isAuthenticated && (
                    <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
                )}
                <main className={`pt-16 ${isAuthenticated ? 'lg:pl-64' : ''}`}>
                    <div className="container mx-auto px-4 sm:px-6 py-8">
                        {children}
                    </div>
                </main>
            </div>
        </SidebarContext.Provider>
    );
}

export default DashboardLayout;

