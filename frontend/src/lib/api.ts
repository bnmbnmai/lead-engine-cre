// Fallback chain mirrors socket.ts so both always point to the same Render backend.
// Priority: VITE_API_URL (explicit) → VITE_SOCKET_URL (already set for WebSocket) → dev localhost.
// If VITE_API_URL is unset on Vercel but VITE_SOCKET_URL is, the browser won't call
// http://localhost:3001 from an HTTPS page (mixed-content block reported as CORS error).
export const API_BASE_URL = (
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_SOCKET_URL ||
    'http://localhost:3001'
).replace(/\/$/, ''); // strip trailing slash so /api/v1/... paths compose cleanly

// Shared secret for the public demo button — must match TEST_API_TOKEN on the backend.
// Set VITE_TEST_API_TOKEN in Vercel env vars.
const TEST_API_TOKEN = (import.meta.env.VITE_TEST_API_TOKEN as string) || '';

// ============================================
// Types
// ============================================

interface ApiError {
    error: string;
    message?: string;
    details?: unknown;
}

interface ApiResponse<T> {
    data?: T;
    error?: ApiError;
}

// ============================================
// Token Management
// ============================================

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
    authToken = token;
    if (token) {
        localStorage.setItem('auth_token', token);
    } else {
        localStorage.removeItem('auth_token');
    }
}

export function getAuthToken(): string | null {
    if (!authToken) {
        authToken = localStorage.getItem('auth_token');
    }
    return authToken;
}

// ============================================
// Fetch Wrapper
// ============================================

async function apiFetch<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<ApiResponse<T>> {
    const token = getAuthToken();

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, {
            ...options,
            headers,
        });

        const data = await response.json();

        if (!response.ok) {
            return { error: data as ApiError };
        }

        return { data: data as T };
    } catch (error) {
        return {
            error: {
                error: 'Network error',
                message: error instanceof Error ? error.message : 'Unknown error',
            },
        };
    }
}

// ============================================
// API Methods
// ============================================

export const api = {
    apiFetch,

    // Auth
    getNonce: (address: string) =>
        apiFetch<{ nonce: string; message: string }>(`/api/v1/auth/nonce/${address}`),

    login: (address: string, message: string, signature: string) =>
        apiFetch<{ token: string; user: any }>('/api/v1/auth/wallet', {
            method: 'POST',
            body: JSON.stringify({ address, message, signature }),
        }),

    getMe: () => apiFetch<any>('/api/v1/auth/me'),

    logout: () => apiFetch('/api/v1/auth/logout', { method: 'POST' }),

    // Asks
    listAsks: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<{ asks: any[]; pagination: any }>(`/api/v1/asks${query}`);
    },

    createAsk: (data: any) =>
        apiFetch<{ ask: any }>('/api/v1/asks', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getAsk: (id: string) => apiFetch<{ ask: any }>(`/api/v1/asks/${id}`),

    updateAsk: (id: string, data: any) =>
        apiFetch<{ ask: any }>(`/api/v1/asks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    deleteAsk: (id: string) =>
        apiFetch<{ success: boolean }>(`/api/v1/asks/${id}`, { method: 'DELETE' }),

    // Leads
    listLeads: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<{ leads: any[]; pagination: any }>(`/api/v1/leads${query}`);
    },

    submitLead: (data: any) =>
        apiFetch<{ lead: any }>('/api/v1/leads/submit', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getLead: (id: string) => apiFetch<{ lead: any }>(`/api/v1/leads/${id}`),
    getLeadPreview: (id: string) => apiFetch<{ preview: any }>(`/api/v1/leads/${id}/preview`),

    // Sellers
    listSellers: (params?: Record<string, string>) => {
        const query = params ? '?' + new URLSearchParams(params).toString() : '';
        return apiFetch<{ sellers: any[]; pagination: any }>(`/api/v1/sellers${query}`);
    },
    searchSellers: (q: string) =>
        apiFetch<{ sellers: any[] }>(`/api/v1/sellers/search?q=${encodeURIComponent(q)}`),

    // Bids
    placeBid: (data: { leadId: string; amount?: number; commitment?: string }) =>
        apiFetch<{ bid: any }>('/api/v1/bids', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    revealBid: (bidId: string, amount: number, salt: string) =>
        apiFetch<{ bid: any }>(`/api/v1/bids/${bidId}/reveal`, {
            method: 'POST',
            body: JSON.stringify({ amount, salt }),
        }),

    getMyBids: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<{ bids: any[] }>(`/api/v1/bids/my${query}`);
    },

    updatePreferences: (data: any) =>
        apiFetch('/api/v1/bids/preferences', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    getPreferenceSets: () =>
        apiFetch<{ sets: any[] }>('/api/v1/bids/preferences/v2'),

    updatePreferenceSets: (data: { preferenceSets: any[] }) =>
        apiFetch('/api/v1/bids/preferences/v2', {
            method: 'PUT',
            body: JSON.stringify(data),
        }),

    // Data Feeds — Chainlink real-time floor prices
    getBidFloor: (vertical: string, country: string = 'US') =>
        apiFetch<{ bidFloor: any; priceIndex: any }>(`/api/v1/bids/bid-floor?vertical=${vertical}&country=${country}`),

    // Analytics
    getOverview: (source?: 'real' | 'mock') =>
        apiFetch<any>(`/api/v1/analytics/overview${source ? `?source=${source}` : ''}`),
    getLeadAnalytics: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<any>(`/api/v1/analytics/leads${query}`);
    },
    getBidAnalytics: (source?: 'real' | 'mock') =>
        apiFetch<any>(`/api/v1/analytics/bids${source ? `?source=${source}` : ''}`),
    getConversions: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<any>(`/api/v1/analytics/conversions${query}`);
    },
    getConversionsByPlatform: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<any>(`/api/v1/analytics/conversions/by-platform${query}`);
    },

    // Verticals
    getVerticalHierarchy: () =>
        apiFetch<{ tree: any[] }>('/api/v1/verticals/hierarchy'),

    getVerticalFlat: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<{ verticals: any[]; total: number }>(`/api/v1/verticals/flat${query}`);
    },

    suggestVertical: (data: { description: string; vertical?: string; leadId?: string }) =>
        apiFetch<{ suggestion: any }>('/api/v1/verticals/suggest', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    getVerticalSuggestions: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<{ suggestions: any[]; pagination: { page: number; limit: number; total: number; totalPages: number } }>(`/api/v1/verticals/suggestions${query}`);
    },

    approveSuggestion: (id: string, mintNft = false) =>
        apiFetch<{ message: string; vertical: any; nft: any }>(`/api/v1/verticals/suggestions/${id}/approve`, {
            method: 'PUT',
            body: JSON.stringify({ mintNft }),
        }),

    rejectSuggestion: (id: string, reason?: string) =>
        apiFetch<{ message: string; suggestion: any }>(`/api/v1/verticals/suggestions/${id}/reject`, {
            method: 'PUT',
            body: JSON.stringify({ reason }),
        }),

    updateSuggestionStatus: (id: string, status: 'ACTIVE' | 'DEPRECATED' | 'REJECTED') =>
        apiFetch<{ message: string; suggestion: any }>(`/api/v1/verticals/suggestions/${id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
        }),

    activateVertical: (slug: string) =>
        apiFetch<{ activated: boolean; tokenId: number; txHash: string; slug: string }>(
            `/api/v1/verticals/${slug}/activate`, { method: 'PUT' }
        ),

    resaleVertical: (slug: string, buyerAddress: string, salePrice: number) =>
        apiFetch<{ transferred: boolean; tokenId: number; txHash: string; buyer: string; salePrice: number; royalty: { receiver: string; amount: string; bps: number }; priceSource: string }>(
            `/api/v1/verticals/${slug}/resale`, {
            method: 'POST',
            body: JSON.stringify({ buyerAddress, salePrice }),
        }),

    getVerticalFields: (slug: string) =>
        apiFetch<{ fields: any[] }>(`/api/v1/verticals/${slug}/fields`),

    // P2-13: VerticalField sync validation (admin-only)
    getVerticalSyncStatus: (id: string) =>
        apiFetch<{ inSync: boolean; missingFields: string[]; extraFields: string[]; warnings: string[] }>(
            `/api/v1/verticals/${id}/sync-status`
        ),

    searchLeadsAdvanced: (params: {
        vertical: string;
        state?: string;
        status?: string;
        fieldFilters?: Array<{ fieldKey: string; operator: string; value: string }>;
        minQualityScore?: number;
        maxQualityScore?: number;
        minPrice?: number;
        maxPrice?: number;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
        limit?: number;
        offset?: number;
    }) =>
        apiFetch<{ leads: any[]; total: number; pagination: any }>('/api/v1/leads/search', {
            method: 'POST',
            body: JSON.stringify(params),
        }),

    getVerticalNFTs: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<{ verticals: any[]; total: number }>(`/api/v1/verticals/flat${query}`);
    },

    // Form Config
    getFormConfig: (slug: string) =>
        apiFetch<{ formConfig: any | null; croConfig: any | null; vertical: { slug: string; name: string } }>(
            `/api/v1/verticals/${slug}/form-config`
        ),

    getPublicFormConfig: (slug: string) =>
        apiFetch<{ formConfig: any; croConfig: any | null; vertical: { slug: string; name: string } }>(
            `/api/v1/verticals/public/${slug}/form-config`
        ),

    saveFormConfig: (slug: string, config: { fields: any[]; steps: any[]; gamification?: any; croConfig?: any }) =>
        apiFetch<{ message: string; formConfig: any; croConfig: any | null }>(
            `/api/v1/verticals/${slug}/form-config`, {
            method: 'PUT',
            body: JSON.stringify(config),
        }),

    // Demo Panel (dev-only)
    demoStatus: () => apiFetch<{ seeded: boolean; leads: number; bids: number; asks: number }>('/api/v1/demo-panel/status'),
    demoSeed: () => apiFetch<{ success: boolean; leads: number; bids: number; asks: number }>('/api/v1/demo-panel/seed', { method: 'POST' }),
    demoClear: () => apiFetch<{ success: boolean; deleted: { leads: number; bids: number; asks: number } }>('/api/v1/demo-panel/clear', { method: 'POST' }),
    demoInjectLead: (vertical?: string) => apiFetch<{ success: boolean; lead: any }>('/api/v1/demo-panel/lead', { method: 'POST', body: JSON.stringify({ vertical }) }),
    demoStartAuction: (vertical?: string) => apiFetch<{ success: boolean; leadId: string; simulatedBids: number; demoBuyersEnabled: boolean }>('/api/v1/demo-panel/auction', { method: 'POST', body: JSON.stringify({ vertical }) }),
    demoReset: () => apiFetch<{ success: boolean; cleared: number; reseeded: { leads: number; bids: number; asks: number } }>('/api/v1/demo-panel/reset', { method: 'POST' }),
    demoSeedTemplates: () => apiFetch<{ success: boolean; templatesApplied: number; totalTemplates: number; message: string }>('/api/v1/demo-panel/seed-templates', { method: 'POST' }),
    demoSettle: (leadId?: string) => apiFetch<{ success: boolean; transactionId: string; leadId: string; buyerId: string; buyerWallet: string; amount: number; escrowId: string | null; txHash: string | null; escrowReleased: boolean; message: string }>('/api/v1/demo-panel/settle', { method: 'POST', body: JSON.stringify({ leadId }) }),
    demoBuyersToggle: (enabled?: boolean) => apiFetch<{ enabled: boolean }>('/api/v1/demo-panel/demo-buyers-toggle', { method: 'POST', body: JSON.stringify({ enabled }) }),
    demoBuyersStatus: () => apiFetch<{ enabled: boolean }>('/api/v1/demo-panel/demo-buyers-toggle'),
    demoWallets: () => apiFetch<{ seller: string; deployer: string; buyers: string[] }>('/api/v1/demo-panel/demo-wallets'),
    demoWipe: () => apiFetch<{ success: boolean; deleted: { leads: number; bids: number; transactions: number; auctionRooms: number; asks: number }; message: string }>('/api/v1/demo-panel/wipe', { method: 'POST', body: JSON.stringify({ confirm: true }) }),
    demoFundEth: () => apiFetch<{ totalSent: string; deployerBefore: string; deployerAfter: string; results: Array<{ label: string; addr: string; sent: string; status: string }> }>('/api/v1/demo-panel/fund-eth', { method: 'POST' }),

    // Vertical Auctions
    createVerticalAuction: (slug: string, reservePrice: number, durationSecs: number) =>
        apiFetch<{ success: boolean; auctionId?: number; startTime?: string; endTime?: string }>(
            `/api/v1/verticals/${slug}/auction`, {
            method: 'POST',
            body: JSON.stringify({ reservePrice, durationSecs }),
        }),

    placeBidOnAuction: (auctionId: string, bidderAddress: string, amount: number) =>
        apiFetch<{
            success: boolean;
            currentHighBid?: number;
            holderPerks?: {
                prePingSeconds: number;
                multiplier: number;
                effectiveBid: number;
            };
        }>(
            `/api/v1/verticals/auctions/${auctionId}/bid`, {
            method: 'POST',
            body: JSON.stringify({ bidderAddress, amount }),
        }),

    settleVerticalAuction: (auctionId: string) =>
        apiFetch<{ success: boolean; winner?: string; finalPrice?: number }>(
            `/api/v1/verticals/auctions/${auctionId}/settle`, {
            method: 'POST',
        }),

    getActiveAuctions: () =>
        apiFetch<{ auctions: any[] }>('/api/v1/verticals/auctions'),

    // Public Template Config (hosted form colors/branding)
    getPublicTemplateConfig: (vertical: string, sellerId: string) =>
        apiFetch<{ templateConfig: any }>(
            `/api/v1/asks/public/template-config?vertical=${encodeURIComponent(vertical)}&sellerId=${encodeURIComponent(sellerId)}`,
        ),

    // Public Lead Submit (hosted forms / embeds)
    submitPublicLead: (data: { sellerId: string; vertical: string; parameters: Record<string, unknown>; geo?: Record<string, unknown> }) =>
        apiFetch<{ lead: any; matchingAsks?: number }>('/api/v1/leads/public/submit', {
            method: 'POST',
            body: JSON.stringify(data),
        }),

    // Buy It Now
    listBuyNowLeads: (params?: Record<string, string>) =>
        apiFetch<{ leads: any[]; pagination: any }>(
            `/api/v1/leads?buyNow=true${params ? '&' + new URLSearchParams(params).toString() : ''}`,
        ),

    buyNow: (leadId: string) =>
        apiFetch<{ lead: any; transaction: any; escrowAction: string | null; escrowTxData: any }>(
            `/api/v1/leads/${leadId}/buy-now`, { method: 'POST' },
        ),

    prepareEscrow: (leadId: string) =>
        apiFetch<{
            escrowContractAddress: string;
            usdcContractAddress: string;
            createEscrowCalldata: string;
            approveCalldata: string;
            amountWei: string;
            amountUSDC: number;
            chainId: number;
            transactionId: string;
            leadId: string;
            convenienceFeeTransferCalldata?: string;
            convenienceFeeAmountWei?: string;
            platformWalletAddress?: string;
        }>(`/api/v1/leads/${leadId}/prepare-escrow`, { method: 'POST' }),

    confirmEscrow: (leadId: string, escrowTxHash: string, fundTxHash?: string, convenienceFeeTxHash?: string) =>
        apiFetch<{ success: boolean; escrowId: string; txHash: string }>(
            `/api/v1/leads/${leadId}/confirm-escrow`, {
            method: 'POST',
            body: JSON.stringify({ escrowTxHash, fundTxHash, convenienceFeeTxHash }),
        }),

    requalifyLead: (leadId: string) =>
        apiFetch<{ preview: string; estimatedDelivery: string; status: string; note: string }>(
            `/api/v1/leads/${leadId}/requalify`, { method: 'POST' },
        ),


    // Vertical bounties — see /api/v1/verticals/:slug/bounty
    depositBounty: (slug: string, amount: number, criteria?: Record<string, unknown>) =>
        apiFetch<{ success: boolean; poolId: string; amount: number; criteria: Record<string, unknown>; txHash?: string; offChain?: boolean }>(
            `/api/v1/verticals/${slug}/bounty`,
            { method: 'POST', body: JSON.stringify({ amount, criteria }) },
        ),

    withdrawBounty: (slug: string, poolId: string, amount?: number) =>
        apiFetch<{ success: boolean; txHash?: string; offChain?: boolean }>(
            `/api/v1/verticals/${slug}/bounty/withdraw`,
            { method: 'POST', body: JSON.stringify({ poolId, amount }) },
        ),

    getBountyInfo: (slug: string) =>
        apiFetch<{ verticalSlug: string; verticalName: string; totalBounty: number; activePools: number; pools: Array<{ buyerId: string; amount: number; criteria: Record<string, unknown>; createdAt: string }> }>(
            `/api/v1/verticals/${slug}/bounty`,
        ),

    getMyBountyPools: (slug: string) =>
        apiFetch<{ pools: Array<{ poolId: string; amount: number; totalReleased: number; available: number; criteria: Record<string, unknown>; createdAt: string; active: boolean }> }>(
            `/api/v1/verticals/${slug}/bounty/my-pools`,
        ),

    // Decrypted lead data (only available for owned NFTs)
    getLeadDecrypted: (leadId: string) =>
        apiFetch<{ lead: { id: string; firstName: string; lastName: string; email: string; phone: string; address?: string; city?: string; state?: string; zip?: string; notes?: string; customFields?: Record<string, unknown> } }>(
            `/api/v1/leads/${leadId}/decrypted`,
        ),

    // Seller conversion tracking settings
    getConversionSettings: () =>
        apiFetch<{ conversionPixelUrl: string | null; conversionWebhookUrl: string | null }>(
            '/api/v1/seller/conversion-settings',
        ),
    updateConversionSettings: (settings: { conversionPixelUrl?: string; conversionWebhookUrl?: string }) =>
        apiFetch<{ conversionPixelUrl: string | null; conversionWebhookUrl: string | null }>(
            '/api/v1/seller/conversion-settings',
            { method: 'PUT', body: JSON.stringify(settings) },
        ),

    // Lead count (public, no auth — used by SocialProofBanner)
    getLeadCountToday: () =>
        apiFetch<{ count: number }>('/api/v1/leads/count-today'),

    // ── Escrow Vault ──────────────────────────────
    getVault: () =>
        apiFetch<{ balance: number; totalDeposited: number; totalSpent: number; totalRefunded: number; transactions: any[] }>(
            '/api/v1/buyer/vault',
        ),
    depositVault: (amount: number, txHash?: string) =>
        apiFetch<{ success: boolean; balance: number }>(
            '/api/v1/buyer/vault/deposit',
            { method: 'POST', body: JSON.stringify({ amount, txHash }) },
        ),
    withdrawVault: (amount: number, txHash?: string) =>
        apiFetch<{ success: boolean; balance: number; error?: string }>(
            '/api/v1/buyer/vault/withdraw',
            { method: 'POST', body: JSON.stringify({ amount, txHash }) },
        ),

    // ── Demo E2E (Full On-Chain Demo) ──────────────
    demoFullE2EStart: (cycles?: number) =>
        apiFetch<{ success: boolean; message: string; running: boolean }>(
            '/api/v1/demo-panel/full-e2e',
            {
                method: 'POST',
                body: JSON.stringify({ cycles: cycles || 5 }),
                headers: { 'X-Api-Token': TEST_API_TOKEN },
            },
        ),
    demoFullE2EStop: () =>
        apiFetch<{ success: boolean; message: string }>(
            '/api/v1/demo-panel/full-e2e/stop',
            { method: 'POST', headers: { 'X-Api-Token': TEST_API_TOKEN } },
        ),
    demoFullE2EResults: (runId: string) =>
        apiFetch<any>(
            `/api/v1/demo-panel/full-e2e/results/${runId}`,
        ),
    demoFullE2ELatestResults: () =>
        apiFetch<any>(
            '/api/v1/demo-panel/full-e2e/results/latest',
        ),
    demoFullE2EStatus: () =>
        apiFetch<{ running: boolean; results: any[] }>(
            '/api/v1/demo-panel/full-e2e/status',
        ),
    demoFullE2EReset: () =>
        apiFetch<{ success: boolean; message: string; wasRunning: boolean }>(
            '/api/v1/demo-panel/full-e2e/reset',
            { method: 'POST' },
        ),
};

export default api;
