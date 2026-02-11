const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

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

    // Analytics
    getOverview: () => apiFetch<any>('/api/v1/analytics/overview'),
    getLeadAnalytics: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<any>(`/api/v1/analytics/leads${query}`);
    },
    getBidAnalytics: () => apiFetch<any>('/api/v1/analytics/bids'),

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
        return apiFetch<{ suggestions: any[]; total: number }>(`/api/v1/verticals/suggestions${query}`);
    },

    activateVertical: (slug: string) =>
        apiFetch<{ activated: boolean; tokenId: number; txHash: string; slug: string }>(
            `/api/v1/verticals/${slug}/activate`, { method: 'PUT' }
        ),

    resaleVertical: (slug: string, buyerAddress: string, salePrice: number) =>
        apiFetch<{ transferred: boolean; tokenId: number; txHash: string; buyer: string; salePrice: number; royalty: { receiver: string; amount: string; bps: number }; priceSource: string }>(
            `/api/v1/verticals/${slug}/resale`, {
            method: 'POST',
            body: JSON.stringify({ buyerAddress, salePrice }),
        }
        ),

    getVerticalNFTs: (params?: Record<string, string>) => {
        const query = params ? `?${new URLSearchParams(params)}` : '';
        return apiFetch<{ verticals: any[]; total: number }>(`/api/v1/verticals/flat${query}`);
    },

    // Demo Panel (dev-only)
    demoStatus: () => apiFetch<{ seeded: boolean; leads: number; bids: number; asks: number }>('/api/v1/demo-panel/status'),
    demoSeed: () => apiFetch<{ success: boolean; leads: number; bids: number; asks: number }>('/api/v1/demo-panel/seed', { method: 'POST' }),
    demoClear: () => apiFetch<{ success: boolean; deleted: { leads: number; bids: number; asks: number } }>('/api/v1/demo-panel/clear', { method: 'POST' }),
    demoInjectLead: (vertical?: string) => apiFetch<{ success: boolean; lead: any }>('/api/v1/demo-panel/lead', { method: 'POST', body: JSON.stringify({ vertical }) }),
    demoStartAuction: (vertical?: string) => apiFetch<{ success: boolean; leadId: string }>('/api/v1/demo-panel/auction', { method: 'POST', body: JSON.stringify({ vertical }) }),

    // Vertical Auctions
    createVerticalAuction: (slug: string, reservePrice: number, durationSecs: number) =>
        apiFetch<{ success: boolean; auctionId?: number; startTime?: string; endTime?: string }>(
            `/api/v1/verticals/${slug}/auction`, {
            method: 'POST',
            body: JSON.stringify({ reservePrice, durationSecs }),
        }),

    placeBidOnAuction: (auctionId: string, bidderAddress: string, amount: number) =>
        apiFetch<{ success: boolean; currentHighBid?: number }>(
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
};

export default api;
