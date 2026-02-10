import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wagmiConfig } from '@/lib/wagmi';
import { AuthProvider } from '@/hooks/useAuth';
import '@/lib/i18n';

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
                            {/* Public */}
                            <Route path="/" element={<HomePage />} />
                            <Route path="/marketplace" element={<HomePage />} />
                            <Route path="/auction/:leadId" element={<AuctionPage />} />

                            {/* Buyer Routes */}
                            <Route path="/buyer" element={<BuyerDashboard />} />
                            <Route path="/buyer/bids" element={<BuyerBids />} />
                            <Route path="/buyer/preferences" element={<BuyerPreferences />} />

                            {/* Seller Routes */}
                            <Route path="/seller" element={<SellerDashboard />} />
                            <Route path="/seller/leads" element={<SellerLeads />} />
                            <Route path="/seller/asks" element={<SellerAsks />} />
                            <Route path="/seller/asks/new" element={<CreateAsk />} />
                            <Route path="/seller/submit" element={<SellerSubmit />} />

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
