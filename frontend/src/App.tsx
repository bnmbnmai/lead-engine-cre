import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import { wagmiConfig } from '@/lib/wagmi';
import { AuthProvider } from '@/hooks/useAuth';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { initSentry } from '@/lib/sentry';
initSentry();

// Pages
import HomePage from '@/pages/HomePage';
import BuyerDashboard from '@/pages/BuyerDashboard';
import BuyerPortfolio from '@/pages/BuyerPortfolio';
import SellerDashboard from '@/pages/SellerDashboard';
import AuctionPage from '@/pages/AuctionPage';
import BuyerBids from '@/pages/BuyerBids';
import { BuyerPreferences } from '@/pages/BuyerPreferences';
import SellerLeads from '@/pages/SellerLeads';
import SellerFunnels from '@/pages/SellerFunnels';
import SellerSubmit from '@/pages/SellerSubmit';
import FormBuilder from '@/pages/FormBuilder';
import SellerAnalytics from '@/pages/SellerAnalytics';
import BuyerAnalytics from '@/pages/BuyerAnalytics';
import AdminNFTs from '@/pages/AdminNFTs';
import AdminVerticals from '@/pages/AdminVerticals';
import AskDetailPage from '@/pages/AskDetailPage';
import HostedForm from '@/pages/HostedForm';
import LeadDetailPage from '@/pages/LeadDetailPage';
import SellerIntegrations from '@/pages/SellerIntegrations';
import BuyerIntegrations from '@/pages/BuyerIntegrations';

import { DemoPanel } from '@/components/demo/DemoPanel';
import { AgentChatWidget } from '@/components/agent/AgentChatWidget';
import { Toaster } from '@/components/ui/Toaster';
import { ErrorDialog } from '@/components/ui/ErrorDialog';
import useAuth from '@/hooks/useAuth';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});

// Auth error dialog — must be inside AuthProvider to consume context
function AuthErrorDialog() {
    const { authError, clearAuthError, requestLogin } = useAuth();
    return (
        <ErrorDialog
            error={authError}
            onRetry={() => { clearAuthError(); requestLogin(); }}
            onDismiss={clearAuthError}
        />
    );
}

// Redirect authenticated users away from public lander to their dashboard
function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, isLoading, user } = useAuth();
    if (isLoading) return null; // wait for session restore
    if (isAuthenticated) {
        const dest = user?.role === 'SELLER' ? '/seller' : '/buyer';
        return <Navigate to={dest} replace />;
    }
    return <>{children}</>;
}

function App() {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider theme={darkTheme({ accentColor: '#375BD2', borderRadius: 'medium' })}>
                    <AuthProvider>
                        <Router>
                            <Routes>
                                {/* Marketplace (public landing — auth users redirected to dashboard) */}
                                <Route path="/" element={<RedirectIfAuthenticated><HomePage /></RedirectIfAuthenticated>} />
                                {/* Marketplace — accessible to everyone (auth users use this from dashboard) */}
                                <Route path="/marketplace" element={<HomePage />} />
                                <Route path="/auction/:leadId" element={<AuctionPage />} />
                                <Route path="/lead/:id" element={<LeadDetailPage />} />
                                <Route path="/marketplace/ask/:askId" element={<AskDetailPage />} />

                                {/* Public hosted forms */}
                                <Route path="/f/:slug" element={<HostedForm />} />

                                {/* Buyer Routes (auth + role required) */}
                                <Route path="/buyer" element={<ProtectedRoute role="BUYER"><BuyerDashboard /></ProtectedRoute>} />
                                <Route path="/buyer/bids" element={<ProtectedRoute role="BUYER"><BuyerBids /></ProtectedRoute>} />
                                <Route path="/buyer/analytics" element={<ProtectedRoute role="BUYER"><BuyerAnalytics /></ProtectedRoute>} />
                                <Route path="/buyer/preferences" element={<ProtectedRoute role="BUYER"><BuyerPreferences /></ProtectedRoute>} />
                                <Route path="/buyer/portfolio" element={<ProtectedRoute role="BUYER"><BuyerPortfolio /></ProtectedRoute>} />
                                <Route path="/buyer/integrations" element={<ProtectedRoute role="BUYER"><BuyerIntegrations /></ProtectedRoute>} />

                                {/* Seller Routes (auth + role required) */}
                                <Route path="/seller" element={<ProtectedRoute role="SELLER"><SellerDashboard /></ProtectedRoute>} />
                                <Route path="/seller/leads" element={<ProtectedRoute role="SELLER"><SellerLeads /></ProtectedRoute>} />
                                <Route path="/seller/leads/:leadId" element={<ProtectedRoute role="SELLER"><SellerLeads /></ProtectedRoute>} />
                                <Route path="/seller/funnels" element={<ProtectedRoute role="SELLER"><SellerFunnels /></ProtectedRoute>} />
                                {/* Redirects from old routes */}
                                <Route path="/seller/asks" element={<Navigate to="/seller/funnels" replace />} />
                                <Route path="/seller/asks/new" element={<Navigate to="/seller/funnels" replace />} />
                                <Route path="/seller/asks/:askId" element={<Navigate to="/seller/funnels" replace />} />
                                <Route path="/seller/templates" element={<Navigate to="/seller/funnels" replace />} />
                                <Route path="/seller/submit" element={<ProtectedRoute role="SELLER"><SellerSubmit /></ProtectedRoute>} />
                                <Route path="/seller/analytics" element={<ProtectedRoute role="SELLER"><SellerAnalytics /></ProtectedRoute>} />
                                <Route path="/seller/integrations" element={<ProtectedRoute role="SELLER"><SellerIntegrations /></ProtectedRoute>} />

                                {/* Admin Routes (auth + admin role required) */}
                                <Route path="/admin/nfts" element={<ProtectedRoute role="ADMIN"><AdminNFTs /></ProtectedRoute>} />
                                <Route path="/admin/verticals" element={<ProtectedRoute role="ADMIN"><AdminVerticals /></ProtectedRoute>} />
                                <Route path="/admin/form-builder" element={<ProtectedRoute role="ADMIN"><FormBuilder /></ProtectedRoute>} />



                                {/* Fallback */}
                                <Route path="*" element={<Navigate to="/" replace />} />
                            </Routes>

                            {(import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === 'true') && <DemoPanel />}

                            {/* Persistent AI Agent chat widget */}
                            <AgentChatWidget />

                            {/* Toast notifications */}
                            <Toaster />

                            {/* Auth error dialog */}
                            <AuthErrorDialog />
                        </Router>
                    </AuthProvider>
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}

export default App;
