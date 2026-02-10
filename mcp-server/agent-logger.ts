import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================
// Agent Action Logger
// ============================================
// Structured logging for all agent tool calls.
// Logs to both console and a rotating file.

const LOG_DIR = join(__dirname, 'logs');
if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

interface AgentLogEntry {
    timestamp: string;
    requestId: string;
    tool: string;
    agentId?: string;
    params: Record<string, unknown>;
    status: 'success' | 'error' | 'retry';
    latencyMs: number;
    response?: unknown;
    error?: { code: string; message: string };
}

export const ERROR_CODES = {
    LEAD_NOT_FOUND: 'LEAD_NOT_FOUND',
    BID_TOO_LOW: 'BID_TOO_LOW',
    RATE_LIMITED: 'RATE_LIMITED',
    AUTH_FAILED: 'AUTH_FAILED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    UPSTREAM_ERROR: 'UPSTREAM_ERROR',
    TIMEOUT: 'TIMEOUT',
} as const;

let requestCounter = 0;

export function generateRequestId(): string {
    return `req_${Date.now()}_${(++requestCounter).toString(36)}`;
}

export function logAgentAction(entry: AgentLogEntry): void {
    const line = JSON.stringify(entry);

    // Console
    const icon = entry.status === 'success' ? '✅' : entry.status === 'retry' ? '🔄' : '❌';
    console.log(`[AGENT] ${icon} ${entry.tool} (${entry.latencyMs}ms) [${entry.requestId}]`);

    // File (daily rotation)
    const dateStr = new Date().toISOString().slice(0, 10);
    const logFile = join(LOG_DIR, `agent-${dateStr}.jsonl`);
    try {
        appendFileSync(logFile, line + '\n');
    } catch {
        // Non-critical — continue if file write fails
    }
}

export function formatErrorResponse(code: string, message: string, retryAfterSec?: number) {
    return {
        error: {
            code,
            message,
            ...(retryAfterSec ? { retry_after_seconds: retryAfterSec, retry_guidance: `Retry this call after ${retryAfterSec}s` } : {}),
        },
    };
}
