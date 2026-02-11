import { Link } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Info } from 'lucide-react';
import ConnectButton from '@/components/wallet/ConnectButton';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useState } from 'react';

// ============================================
// AuthGate — sign-in prompt for protected routes
// ============================================

export function AuthGate() {
    const [showTooltip, setShowTooltip] = useState(false);

    return (
        <DashboardLayout>
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="relative max-w-md w-full p-8 rounded-2xl border border-white/[0.08] bg-white/[0.02] backdrop-blur-xl text-center space-y-6">
                    {/* Icon */}
                    <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-[#375BD2] to-[#2a47a8] flex items-center justify-center shadow-lg shadow-[#375BD2]/20">
                        <ShieldCheck className="h-8 w-8 text-white" />
                    </div>

                    {/* Heading */}
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Sign in required</h1>
                        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                            Connect your wallet and sign in to access this page.
                            Your data is secured with blockchain-verified identity.
                        </p>
                    </div>

                    {/* Action */}
                    <div className="flex justify-center">
                        <ConnectButton />
                    </div>

                    {/* Escape hatch */}
                    <Link
                        to="/marketplace"
                        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" />
                        Back to Marketplace
                    </Link>

                    {/* Security info tooltip */}
                    <div className="relative inline-block ml-3">
                        <button
                            onMouseEnter={() => setShowTooltip(true)}
                            onMouseLeave={() => setShowTooltip(false)}
                            onClick={() => setShowTooltip((p) => !p)}
                            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
                            aria-label="Why sign in?"
                        >
                            <Info className="h-3.5 w-3.5" />
                            Why sign in?
                        </button>

                        {showTooltip && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 p-3 rounded-xl bg-card border border-border shadow-xl text-xs text-muted-foreground leading-relaxed z-50">
                                Lead data contains PII (names, emails, phone numbers).
                                Wallet-based authentication ensures only verified participants
                                can access, bid on, or manage leads — protecting both buyers
                                and the individuals whose data is being traded.
                                <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-card border-r border-b border-border rotate-45 -mt-1" />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </DashboardLayout>
    );
}

export default AuthGate;
