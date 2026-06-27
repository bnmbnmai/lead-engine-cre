/**
 * Lead Engine Agent SDK (Phase C6)
 * register → fund vault → author StrategySpec → simulate → deploy → observe
 */

export interface AgentSdkConfig {
    baseUrl: string;
    /** JWT from SIWE login or agent API key (lea_...) */
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
}

export function createAgentClient(config: AgentSdkConfig): LeadEngineAgentClient {
    return new LeadEngineAgentClient(config);
}
