/**
 * Scoped access for lea_ API keys. JWT sessions bypass scope checks (full buyer access).
 */

import { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';

export type AgentScope = 'read' | 'bid' | 'admin' | 'simulate' | 'supply';

export interface AgentAuthContext {
    keyId: string;
    scopes: string[];
    sandboxOnly: boolean;
}

export function getAgentAuth(req: AuthenticatedRequest): AgentAuthContext | null {
    return (req as AuthenticatedRequest & { agentAuth?: AgentAuthContext }).agentAuth ?? null;
}

/** Require one of the scopes when authenticated via lea_ key. */
export function requireAgentScope(...allowed: AgentScope[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const agentAuth = getAgentAuth(req);
        if (!agentAuth) {
            next();
            return;
        }
        const ok = allowed.some((s) => agentAuth.scopes.includes(s));
        if (!ok) {
            res.status(403).json({
                error: 'API key scope insufficient',
                code: 'SCOPE_DENIED',
                required: allowed,
                granted: agentAuth.scopes,
            });
            return;
        }
        next();
    };
}

/** Block sandbox-only keys from mutating/bidding operations. */
export function rejectSandboxKey(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const agentAuth = getAgentAuth(req);
    if (agentAuth?.sandboxOnly) {
        res.status(403).json({
            error: 'Sandbox API keys cannot perform this action',
            code: 'SANDBOX_KEY',
            resolution: 'Use a production lea_ key with bid scope for live operations.',
        });
        return;
    }
    next();
}
