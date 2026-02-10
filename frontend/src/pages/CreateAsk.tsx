import { useNavigate } from 'react-router-dom';
import { Info, Wallet } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { AskForm } from '@/components/forms/AskForm';
import { Card, CardContent } from '@/components/ui/card';
import useAuth from '@/hooks/useAuth';

export function CreateAsk() {
    const navigate = useNavigate();
    const { isAuthenticated } = useAuth();

    return (
        <DashboardLayout>
            <div className="max-w-2xl mx-auto">
                {/* Header with tooltip */}
                <div className="mb-8">
                    <div className="flex items-center gap-2 mb-1">
                        <h1 className="text-3xl font-bold">Create Auction Listing</h1>
                        <div className="relative group">
                            <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                            <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-popover border border-border rounded-lg shadow-lg text-xs text-popover-foreground w-64 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                An Ask defines what leads you want to sell — set vertical, geo targets, pricing, and auction rules. Buyers will bid on matching leads.
                            </div>
                        </div>
                    </div>
                    <p className="text-muted-foreground">
                        Define your lead requirements, set pricing rules, and let buyers compete for your leads via sealed-bid auctions
                    </p>
                </div>

                {/* Auth Gate */}
                {!isAuthenticated ? (
                    <Card>
                        <CardContent className="p-12 text-center">
                            <Wallet className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                            <h2 className="text-lg font-semibold mb-2">Connect Your Wallet</h2>
                            <p className="text-sm text-muted-foreground mb-6 max-w-sm mx-auto">
                                You need to connect a wallet to create auction listings. Sellers earn USDC when buyers win auctions for their leads.
                            </p>
                            <p className="text-xs text-muted-foreground">
                                Use the <strong>Connect Wallet</strong> button in the top navigation bar to get started.
                            </p>
                        </CardContent>
                    </Card>
                ) : (
                    <AskForm
                        onSuccess={(ask) => {
                            navigate(`/marketplace/ask/${ask.id}`);
                        }}
                    />
                )}
            </div>
        </DashboardLayout>
    );
}

export default CreateAsk;
