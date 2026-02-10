import { useState } from 'react';
import { useConnect, useAccount, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { Wallet, ChevronDown, LogOut, Copy, ExternalLink, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { shortenAddress } from '@/lib/utils';
import useAuth from '@/hooks/useAuth';

export function ConnectButton() {
    const [isOpen, setIsOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const { connectors, connect, isPending } = useConnect();
    const { address, isConnected } = useAccount();
    const { disconnect: _disconnect } = useDisconnect();
    const chainId = useChainId();
    const { switchChain } = useSwitchChain();
    const { user, login, logout, isLoading } = useAuth();

    const handleConnect = async (connectorId: number) => {
        const connector = connectors[connectorId];
        await connect({ connector });
    };

    const handleCopy = () => {
        if (address) {
            navigator.clipboard.writeText(address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    const handleSignIn = async () => {
        try {
            await login();
        } catch (error) {
            console.error('Sign in error:', error);
        }
    };

    if (!isConnected) {
        return (
            <div className="relative">
                <Button
                    onClick={() => setIsOpen(!isOpen)}
                    variant="gradient"
                    size="lg"
                    disabled={isPending}
                    loading={isPending}
                >
                    <Wallet className="h-4 w-4" />
                    Connect Wallet
                </Button>

                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                        <div className="absolute right-0 top-full mt-2 w-64 glass rounded-xl p-3 z-50 space-y-2">
                            {connectors.map((connector, i) => (
                                <button
                                    key={connector.id}
                                    onClick={() => {
                                        handleConnect(i);
                                        setIsOpen(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg hover:bg-white/10 transition text-left"
                                >
                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                                        <Wallet className="h-4 w-4 text-white" />
                                    </div>
                                    <div>
                                        <div className="font-medium">{connector.name}</div>
                                        <div className="text-xs text-muted-foreground">Connect</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </>
                )}
            </div>
        );
    }

    // Connected but not signed in
    if (!user) {
        return (
            <Button onClick={handleSignIn} variant="default" loading={isLoading}>
                Sign In
            </Button>
        );
    }

    // Fully authenticated
    return (
        <div className="relative">
            <Button
                onClick={() => setIsOpen(!isOpen)}
                variant="glass"
                className="gap-2"
            >
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xs text-white font-bold">
                    {user.role[0]}
                </div>
                <span className="hidden sm:inline">{shortenAddress(address!)}</span>
                <ChevronDown className="h-4 w-4" />
            </Button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 top-full mt-2 w-72 glass rounded-xl p-4 z-50 space-y-4">
                        {/* Address */}
                        <div className="flex items-center justify-between">
                            <div className="font-mono text-sm">{shortenAddress(address!, 6)}</div>
                            <div className="flex gap-1">
                                <button
                                    onClick={handleCopy}
                                    className="p-2 rounded-lg hover:bg-white/10 transition"
                                >
                                    {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                                </button>
                                <a
                                    href={`https://sepolia.etherscan.io/address/${address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="p-2 rounded-lg hover:bg-white/10 transition"
                                >
                                    <ExternalLink className="h-4 w-4" />
                                </a>
                            </div>
                        </div>

                        {/* Role Badge */}
                        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/10">
                            <span className="text-xs text-muted-foreground">Role:</span>
                            <span className="text-sm font-medium text-primary">{user.role}</span>
                        </div>

                        {/* Network Switcher */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => switchChain?.({ chainId: 11155111 })}
                                className={`flex-1 px-3 py-2 rounded-lg text-sm transition ${chainId === 11155111 ? 'bg-primary text-primary-foreground' : 'bg-white/5 hover:bg-white/10'
                                    }`}
                            >
                                Sepolia
                            </button>
                            <button
                                onClick={() => switchChain?.({ chainId: 84532 })}
                                className={`flex-1 px-3 py-2 rounded-lg text-sm transition ${chainId === 84532 ? 'bg-primary text-primary-foreground' : 'bg-white/5 hover:bg-white/10'
                                    }`}
                            >
                                Base Sepolia
                            </button>
                        </div>

                        {/* Logout */}
                        <button
                            onClick={() => {
                                logout();
                                setIsOpen(false);
                            }}
                            className="w-full flex items-center gap-2 px-4 py-2 rounded-lg text-red-500 hover:bg-red-500/10 transition"
                        >
                            <LogOut className="h-4 w-4" />
                            Sign Out
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

export default ConnectButton;
