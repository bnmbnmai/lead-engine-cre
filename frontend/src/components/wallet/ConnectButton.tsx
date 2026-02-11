import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit';
import useAuth from '@/hooks/useAuth';

// ============================================
// Wallet Connect Button
// ============================================
// Thin wrapper around RainbowKit's ConnectButton.
// RainbowKit handles: wallet picker modal with branded icons,
// account dropdown (address, balance, copy, etherscan link),
// network switcher, and disconnect.
//
// We layer on our SIWE auth state so the button shows the
// user's role when fully authenticated.
// On logout/disconnect → navigate to /marketplace.

export function ConnectButton() {
    const { user, isAuthenticated } = useAuth();
    const navigate = useNavigate();
    const wasAuthenticated = useRef(isAuthenticated);

    // Redirect to marketplace when user logs out or disconnects
    useEffect(() => {
        if (wasAuthenticated.current && !isAuthenticated) {
            navigate('/', { replace: true });
        }
        wasAuthenticated.current = isAuthenticated;
    }, [isAuthenticated, navigate]);

    return (
        <RainbowConnectButton.Custom>
            {({
                account,
                chain,
                openAccountModal,
                openChainModal,
                openConnectModal,
                mounted,
            }) => {
                const ready = mounted;
                const connected = ready && account && chain;

                return (
                    <div
                        {...(!ready && {
                            'aria-hidden': true,
                            style: {
                                opacity: 0,
                                pointerEvents: 'none' as const,
                                userSelect: 'none' as const,
                            },
                        })}
                    >
                        {(() => {
                            if (!connected) {
                                return (
                                    <button
                                        onClick={openConnectModal}
                                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#375BD2] to-[#5B7FE5] text-white font-medium text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] transition-all"
                                    >
                                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
                                        </svg>
                                        Connect Wallet
                                    </button>
                                );
                            }

                            if (chain.unsupported) {
                                return (
                                    <button
                                        onClick={openChainModal}
                                        className="px-4 py-2 rounded-xl bg-red-500/10 text-red-500 font-medium text-sm border border-red-500/20"
                                    >
                                        Wrong Network
                                    </button>
                                );
                            }

                            return (
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={openChainModal}
                                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition text-sm border border-white/10"
                                        title="Switch Network"
                                    >
                                        {chain.hasIcon && chain.iconUrl && (
                                            <img
                                                alt={chain.name ?? 'Chain icon'}
                                                src={chain.iconUrl}
                                                className="h-4 w-4 rounded-full"
                                            />
                                        )}
                                        <span className="hidden sm:inline text-muted-foreground">
                                            {chain.name}
                                        </span>
                                    </button>

                                    <button
                                        onClick={openAccountModal}
                                        className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition text-sm border border-white/10"
                                    >
                                        {user && (
                                            <div className="w-5 h-5 rounded-full bg-[#375BD2] flex items-center justify-center text-[10px] text-white font-bold">
                                                {user.role[0]}
                                            </div>
                                        )}
                                        <span className="font-mono">
                                            {account.displayName}
                                        </span>
                                    </button>
                                </div>
                            );
                        })()}
                    </div>
                );
            }}
        </RainbowConnectButton.Custom>
    );
}

export default ConnectButton;
