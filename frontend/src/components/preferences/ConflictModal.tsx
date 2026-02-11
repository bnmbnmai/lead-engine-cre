import { useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

// ============================================
// Types
// ============================================

export interface PreferenceSetData {
    id?: string;
    label: string;
    vertical: string;
    priority: number;
    geoCountry: string;
    geoInclude: string[];
    geoExclude: string[];
    maxBidPerLead?: number;
    dailyBudget?: number;
    autoBidEnabled: boolean;
    autoBidAmount?: number;
    excludedSellerIds: string[];
    preferredSellerIds: string[];
    minSellerReputation?: number;
    requireVerifiedSeller: boolean;
    acceptOffSite: boolean;
    requireVerified: boolean;
    isActive: boolean;
}

interface ConflictModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    localSets: PreferenceSetData[];
    serverSets: PreferenceSetData[];
    onKeepLocal: () => void;
    onAcceptServer: () => void;
}

// ============================================
// Helpers
// ============================================

const VERTICAL_LABELS: Record<string, string> = {
    solar: 'Solar',
    mortgage: 'Mortgage',
    roofing: 'Roofing',
    insurance: 'Insurance',
    home_services: 'Home Services',
    b2b_saas: 'B2B SaaS',
    real_estate: 'Real Estate',
    auto: 'Auto',
    legal: 'Legal',
    financial: 'Financial',
};

function formatCurrency(amount?: number) {
    if (!amount) return 'Not set';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
    }).format(amount);
}

function getDifferences(local: PreferenceSetData, server: PreferenceSetData): string[] {
    const diffs: string[] = [];

    if (local.label !== server.label) diffs.push('Label');
    if (local.vertical !== server.vertical) diffs.push('Vertical');
    if (local.isActive !== server.isActive) diffs.push('Active Status');
    if (JSON.stringify(local.geoInclude) !== JSON.stringify(server.geoInclude)) diffs.push('Included Regions');
    if (JSON.stringify(local.geoExclude) !== JSON.stringify(server.geoExclude)) diffs.push('Excluded Regions');
    if (local.maxBidPerLead !== server.maxBidPerLead) diffs.push('Max Bid');
    if (local.dailyBudget !== server.dailyBudget) diffs.push('Daily Budget');
    if (local.autoBidEnabled !== server.autoBidEnabled) diffs.push('Auto-Bid');
    if (local.autoBidAmount !== server.autoBidAmount) diffs.push('Auto-Bid Amount');
    if (JSON.stringify(local.excludedSellerIds) !== JSON.stringify(server.excludedSellerIds)) diffs.push('Excluded Sellers');
    if (JSON.stringify(local.preferredSellerIds) !== JSON.stringify(server.preferredSellerIds)) diffs.push('Preferred Sellers');
    if (local.minSellerReputation !== server.minSellerReputation) diffs.push('Min Reputation');
    if (local.requireVerifiedSeller !== server.requireVerifiedSeller) diffs.push('Require Verified');

    return diffs;
}

// ============================================
// Component
// ============================================

export function ConflictModal({
    open,
    onOpenChange,
    localSets,
    serverSets,
    onKeepLocal,
    onAcceptServer,
}: ConflictModalProps) {
    const [selectedChoice, setSelectedChoice] = useState<'local' | 'server' | null>(null);

    // Find sets that differ
    const conflicts: Array<{
        local: PreferenceSetData;
        server: PreferenceSetData;
        diffs: string[];
    }> = [];

    localSets.forEach((local) => {
        const server = serverSets.find((s) => s.id === local.id);
        if (server) {
            const diffs = getDifferences(local, server);
            if (diffs.length > 0) {
                conflicts.push({ local, server, diffs });
            }
        }
    });

    // Check for added/removed sets
    const localIds = new Set(localSets.map((s) => s.id).filter(Boolean));
    const addedLocally = localSets.filter((s) => !s.id);
    const removedLocally = serverSets.filter((s) => s.id && !localIds.has(s.id));
    const addedOnServer = serverSets.filter((s) => s.id && !localIds.has(s.id) && !removedLocally.includes(s));

    const handleConfirm = () => {
        if (selectedChoice === 'local') {
            onKeepLocal();
        } else if (selectedChoice === 'server') {
            onAcceptServer();
        }
        onOpenChange(false);
        setSelectedChoice(null);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-xl">
                        <AlertTriangle className="h-5 w-5 text-amber-500" />
                        Preference Conflict Detected
                    </DialogTitle>
                    <DialogDescription className="text-base">
                        Your preferences were updated in another session. Choose which version to keep.
                    </DialogDescription>
                </DialogHeader>

                <ScrollArea className="flex-1 pr-4">
                    <div className="space-y-6 py-4">
                        {/* Summary */}
                        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                            <div className="flex items-start gap-3">
                                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                                <div className="space-y-2 text-sm">
                                    <p className="font-medium">Changes detected:</p>
                                    <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                                        {conflicts.length > 0 && (
                                            <li>{conflicts.length} preference set{conflicts.length > 1 ? 's' : ''} modified</li>
                                        )}
                                        {addedLocally.length > 0 && (
                                            <li>{addedLocally.length} new set{addedLocally.length > 1 ? 's' : ''} created locally</li>
                                        )}
                                        {addedOnServer.length > 0 && (
                                            <li>{addedOnServer.length} new set{addedOnServer.length > 1 ? 's' : ''} created on server</li>
                                        )}
                                        {removedLocally.length > 0 && (
                                            <li>{removedLocally.length} set{removedLocally.length > 1 ? 's were' : ' was'} deleted on server</li>
                                        )}
                                    </ul>
                                </div>
                            </div>
                        </div>

                        {/* Conflicts */}
                        {conflicts.length > 0 && (
                            <div className="space-y-4">
                                <h3 className="text-sm font-semibold">Modified Preference Sets</h3>
                                {conflicts.map(({ local, server, diffs }, idx) => (
                                    <div key={idx} className="rounded-lg border border-border bg-muted/30 p-4 space-y-3">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="font-medium">{local.label || server.label}</div>
                                                <div className="text-sm text-muted-foreground">
                                                    {VERTICAL_LABELS[local.vertical] || local.vertical}
                                                </div>
                                            </div>
                                            <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                                                {diffs.length} change{diffs.length > 1 ? 's' : ''}
                                            </Badge>
                                        </div>

                                        <div className="grid grid-cols-2 gap-3 text-sm">
                                            <div className="space-y-2">
                                                <div className="font-medium text-blue-500 flex items-center gap-1">
                                                    <Check className="h-3.5 w-3.5" />
                                                    Your Changes
                                                </div>
                                                {diffs.includes('Label') && <div><span className="text-muted-foreground">Label:</span> {local.label}</div>}
                                                {diffs.includes('Active Status') && <div><span className="text-muted-foreground">Active:</span> {local.isActive ? 'Yes' : 'No'}</div>}
                                                {diffs.includes('Max Bid') && <div><span className="text-muted-foreground">Max Bid:</span> {formatCurrency(local.maxBidPerLead)}</div>}
                                                {diffs.includes('Daily Budget') && <div><span className="text-muted-foreground">Daily Budget:</span> {formatCurrency(local.dailyBudget)}</div>}
                                                {diffs.includes('Auto-Bid') && <div><span className="text-muted-foreground">Auto-Bid:</span> {local.autoBidEnabled ? 'Enabled' : 'Disabled'}</div>}
                                            </div>

                                            <div className="space-y-2">
                                                <div className="font-medium text-emerald-500 flex items-center gap-1">
                                                    <Check className="h-3.5 w-3.5" />
                                                    Server Version
                                                </div>
                                                {diffs.includes('Label') && <div><span className="text-muted-foreground">Label:</span> {server.label}</div>}
                                                {diffs.includes('Active Status') && <div><span className="text-muted-foreground">Active:</span> {server.isActive ? 'Yes' : 'No'}</div>}
                                                {diffs.includes('Max Bid') && <div><span className="text-muted-foreground">Max Bid:</span> {formatCurrency(server.maxBidPerLead)}</div>}
                                                {diffs.includes('Daily Budget') && <div><span className="text-muted-foreground">Daily Budget:</span> {formatCurrency(server.dailyBudget)}</div>}
                                                {diffs.includes('Auto-Bid') && <div><span className="text-muted-foreground">Auto-Bid:</span> {server.autoBidEnabled ? 'Enabled' : 'Disabled'}</div>}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* New/Deleted Sets */}
                        {(addedLocally.length > 0 || addedOnServer.length > 0 || removedLocally.length > 0) && (
                            <div className="space-y-3">
                                {addedLocally.length > 0 && (
                                    <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                                        <div className="text-sm font-medium text-blue-500 mb-2">Created Locally</div>
                                        <div className="space-y-1 text-sm text-muted-foreground">
                                            {addedLocally.map((set, idx) => (
                                                <div key={idx}>• {set.label} ({VERTICAL_LABELS[set.vertical]})</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {addedOnServer.length > 0 && (
                                    <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                                        <div className="text-sm font-medium text-emerald-500 mb-2">Created on Server</div>
                                        <div className="space-y-1 text-sm text-muted-foreground">
                                            {addedOnServer.map((set, idx) => (
                                                <div key={idx}>• {set.label} ({VERTICAL_LABELS[set.vertical]})</div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {removedLocally.length > 0 && (
                                    <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                                        <div className="text-sm font-medium text-red-500 mb-2">Deleted on Server</div>
                                        <div className="space-y-1 text-sm text-muted-foreground">
                                            {removedLocally.map((set, idx) => (
                                                <div key={idx}>• {set.label} ({VERTICAL_LABELS[set.vertical]})</div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Choice */}
                        <div className="space-y-3">
                            <h3 className="text-sm font-semibold">Choose which version to keep:</h3>
                            <div className="grid grid-cols-2 gap-3">
                                <button
                                    onClick={() => setSelectedChoice('local')}
                                    className={`p-4 rounded-lg border-2 transition-all ${selectedChoice === 'local'
                                        ? 'border-blue-500 bg-blue-500/10'
                                        : 'border-border hover:border-blue-500/50 bg-background'
                                        }`}
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedChoice === 'local' ? 'border-blue-500 bg-blue-500' : 'border-border'
                                            }`}>
                                            {selectedChoice === 'local' && <Check className="h-3 w-3 text-white" />}
                                        </div>
                                        <div className="font-medium">Keep Your Changes</div>
                                    </div>
                                    <div className="text-xs text-muted-foreground text-left">
                                        Discard server version and save your local edits
                                    </div>
                                </button>

                                <button
                                    onClick={() => setSelectedChoice('server')}
                                    className={`p-4 rounded-lg border-2 transition-all ${selectedChoice === 'server'
                                        ? 'border-emerald-500 bg-emerald-500/10'
                                        : 'border-border hover:border-emerald-500/50 bg-background'
                                        }`}
                                >
                                    <div className="flex items-center gap-2 mb-2">
                                        <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedChoice === 'server' ? 'border-emerald-500 bg-emerald-500' : 'border-border'
                                            }`}>
                                            {selectedChoice === 'server' && <Check className="h-3.5 w-3.5 text-white" />}
                                        </div>
                                        <div className="font-medium">Accept Server Version</div>
                                    </div>
                                    <div className="text-xs text-muted-foreground text-left">
                                        Discard your local changes and reload from server
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>
                </ScrollArea>

                <DialogFooter className="flex-row justify-between items-center space-x-0">
                    <Button
                        variant="ghost"
                        onClick={() => {
                            onOpenChange(false);
                            setSelectedChoice(null);
                        }}
                    >
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selectedChoice}
                    >
                        <Check className="h-4 w-4 mr-1" />
                        Confirm Choice
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export default ConflictModal;
