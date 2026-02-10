import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { AuthProvider } from '@/hooks/useAuth';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import '@/lib/i18n';
import { initSentry } from '@/lib/sentry';
initSentry();

// Pages
import HomePage from '@/pages/HomePage';
import BuyerDashboard from '@/pages/BuyerDashboard';
import SellerDashboard from '@/pages/SellerDashboard';
import AuctionPage from '@/pages/AuctionPage';
import BuyerBids from '@/pages/BuyerBids';
import BuyerPreferences from '@/pages/BuyerPreferences';
import SellerLeads from '@/pages/SellerLeads';
import SellerAsks from '@/pages/SellerAsks';
import SellerSubmit from '@/pages/SellerSubmit';
import CreateAsk from '@/pages/CreateAsk';
import FormBuilder from '@/pages/FormBuilder';
import SellerAnalytics from '@/pages/SellerAnalytics';
import BuyerAnalytics from '@/pages/BuyerAnalytics';

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            refetchOnWindowFocus: false,
            retry: 1,
        },
    },
});

function App() {
    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <AuthProvider>
                    <Router>
                        <Routes>
                            {/* Marketplace (public landing) */}
                            <Route path="/" element={<HomePage />} />
                            <Route path="/marketplace" element={<Navigate to="/" replace />} />
                            <Route path="/auction/:leadId" element={<AuctionPage />} />

                            {/* Buyer Routes (auth required) */}
                            <Route path="/buyer" element={<ProtectedRoute><BuyerDashboard /></ProtectedRoute>} />
                            <Route path="/buyer/bids" element={<ProtectedRoute><BuyerBids /></ProtectedRoute>} />
                            <Route path="/buyer/analytics" element={<ProtectedRoute><BuyerAnalytics /></ProtectedRoute>} />
                            <Route path="/buyer/preferences" element={<ProtectedRoute><BuyerPreferences /></ProtectedRoute>} />

                            {/* Seller Routes (auth required) */}
                            <Route path="/seller" element={<ProtectedRoute><SellerDashboard /></ProtectedRoute>} />
                            <Route path="/seller/leads" element={<ProtectedRoute><SellerLeads /></ProtectedRoute>} />
                            <Route path="/seller/asks" element={<ProtectedRoute><SellerAsks /></ProtectedRoute>} />
                            <Route path="/seller/asks/new" element={<ProtectedRoute><CreateAsk /></ProtectedRoute>} />
                            <Route path="/seller/submit" element={<ProtectedRoute><SellerSubmit /></ProtectedRoute>} />
                            <Route path="/seller/form-builder" element={<ProtectedRoute><FormBuilder /></ProtectedRoute>} />
                            <Route path="/seller/analytics" element={<ProtectedRoute><SellerAnalytics /></ProtectedRoute>} />

                            {/* Fallback */}
                            <Route path="*" element={<Navigate to="/" replace />} />
                        </Routes>
                    </Router>
                </AuthProvider>
            </QueryClientProvider>
        </WagmiProvider>
    );
}

export default App;
