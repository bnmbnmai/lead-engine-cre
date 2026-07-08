/**
 * AgentRTB SDK — buyer (lea_) + seller (lsa_) programmatic paths.
 * See docs/AGENT_DEVELOPER_GUIDE.md and docs/PATH_TO_LIVE.md
 */

export interface AgentSdkConfig {
    baseUrl: string;
    /** JWT from SIWE login, lea_ buyer key, or lsa_ seller key */
    token: string;
}

export class LeadEngineAgentClient {
    constructor(private cfg: AgentSdkConfig) {}

    private async request<T>(path: string, opts: RequestInit = {}): Promise<T> {
        const res = await fetch(`${this.cfg.baseUrl}${path}`, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.cfg.token}`,
                ...(opts.headers as Record<string, string> || {}),
            },
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error((err as { error?: string }).error || res.statusText);
        }
        return res.json() as Promise<T>;
    }

    async registerAgent(displayName: string, walletAddress?: string) {
        return this.request('/api/v1/agent/register', {
            method: 'POST',
            body: JSON.stringify({ displayName, walletAddress }),
        });
    }

    async createApiKey(label = 'default') {
        return this.request<{ apiKey: string }>('/api/v1/agent/api-keys', {
            method: 'POST',
            body: JSON.stringify({ label }),
        });
    }

    async getDashboard() {
        return this.request('/api/v1/agent/me');
    }

    async listStrategies() {
        return this.request('/api/v1/strategies');
    }

    async createStrategy(spec: unknown) {
        return this.request('/api/v1/strategies', {
            method: 'POST',
            body: JSON.stringify({ spec }),
        });
    }

    async activateStrategy(id: string) {
        return this.request(`/api/v1/strategies/${id}/activate`, { method: 'POST' });
    }

    async simulateStrategy(strategyId: string, days = 30) {
        return this.request('/api/v1/agent/simulate', {
            method: 'POST',
            body: JSON.stringify({ strategyId, days }),
        });
    }

    async draftStrategyFromText(description: string) {
        return this.request<{ spec: unknown }>('/api/v1/strategies/draft', {
            method: 'POST',
            body: JSON.stringify({ description }),
        });
    }

    async getDecisionTraces(limit = 50) {
        return this.request(`/api/v1/agent/traces?limit=${limit}`);
    }

    async getLeaderboard() {
        return this.request('/api/v1/agent/leaderboard');
    }

    async browseMarketplace() {
        return this.request('/api/v1/strategies/marketplace');
    }

    async forkStrategy(id: string) {
        return this.request(`/api/v1/strategies/${id}/fork`, { method: 'POST' });
    }

    async registerWebhook(url: string, events?: string[]) {
        return this.request('/api/v1/agent/webhooks', {
            method: 'POST',
            body: JSON.stringify({ url, events }),
        });
    }

    async listWebhooks() {
        return this.request('/api/v1/agent/webhooks');
    }

    async deleteWebhook(id: string) {
        return this.request(`/api/v1/agent/webhooks/${id}`, { method: 'DELETE' });
    }

    async listWebhookDeliveries(webhookId: string, limit = 50) {
        return this.request(`/api/v1/agent/webhooks/${webhookId}/deliveries?limit=${limit}`);
    }

    async createSandboxApiKey(label = 'sandbox') {
        return this.request<{ apiKey: string }>('/api/v1/agent/api-keys', {
            method: 'POST',
            body: JSON.stringify({ label, sandbox: true }),
        });
    }

    // ── Seller (SupplySpec + ingest) ─────────────────────────────────

    async registerSellerAgent(displayName: string, walletAddress?: string) {
        return this.request('/api/v1/seller-agent/register', {
            method: 'POST',
            body: JSON.stringify({ displayName, walletAddress }),
        });
    }

    async createSellerApiKey(label = 'default', opts?: { sandbox?: boolean; scopes?: string[] }) {
        return this.request<{ apiKey: string }>('/api/v1/seller-agent/api-keys', {
            method: 'POST',
            body: JSON.stringify({ label, sandbox: opts?.sandbox, scopes: opts?.scopes }),
        });
    }

    async getSellerDashboard() {
        return this.request('/api/v1/seller-agent/me');
    }

    async listSupplyStrategies() {
        return this.request('/api/v1/supply');
    }

    async createSupplyStrategy(spec: unknown) {
        return this.request('/api/v1/supply', {
            method: 'POST',
            body: JSON.stringify({ spec }),
        });
    }

    async activateSupplyStrategy(id: string) {
        return this.request(`/api/v1/supply/${id}/activate`, { method: 'POST' });
    }

    async ingestLead(payload: unknown) {
        return this.request('/api/v1/ingest/traffic-platform', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
    }

    async registerSellerWebhook(url: string, events?: string[]) {
        return this.request('/api/v1/seller-agent/webhooks', {
            method: 'POST',
            body: JSON.stringify({ url, events }),
        });
    }

    async getDiscovery() {
        return this.request('/.well-known/agent.json');
    }
}

export function createAgentClient(config: AgentSdkConfig): LeadEngineAgentClient {
    return new LeadEngineAgentClient(config);
}
