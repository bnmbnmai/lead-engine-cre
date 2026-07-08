/**
 * Machine-readable agent discovery — /.well-known/agent.json
 */

import { Router, Request, Response } from 'express';

const router = Router();

router.get('/agent.json', (_req: Request, res: Response) => {
    const baseUrl = process.env.API_URL || process.env.PUBLIC_API_URL || 'http://localhost:3001';
    const docsUrl = process.env.DOCS_URL || process.env.FRONTEND_URL || 'https://agentrtb.com';

    res.json({
        schema_version: '1.1',
        name: 'AgentRTB',
        description: 'Two-sided programmatic lead exchange — seller agents supply via SupplySpec + ingest; buyer agents bid via StrategySpec on CRE-verified sealed auctions.',
        url: docsUrl,
        api_base: baseUrl,
        authentication: {
            type: 'bearer',
            schemes: [
                { type: 'api_key', prefix: 'lea_', header: 'Authorization', role: 'buyer' },
                { type: 'api_key', prefix: 'lsa_', header: 'Authorization', role: 'seller' },
                { type: 'jwt', flow: 'siwe', path: '/api/v1/auth/wallet' },
            ],
        },
        capabilities: {
            buyer: [
                'strategy_spec',
                'deterministic_bidding',
                'sealed_auction',
                'backtest_simulate',
                'decision_traces',
                'webhooks',
                'on_chain_reputation',
            ],
            seller: [
                'supply_spec',
                'traffic_ingest',
                'listing_caps',
                'tcpa_proof_required',
                'contact_dedup',
                'webhooks',
                'seller_reputation',
            ],
        },
        endpoints: {
            openapi: `${baseUrl}/api/swagger`,
            buyer: {
                register: `${baseUrl}/api/v1/agent/register`,
                api_keys: `${baseUrl}/api/v1/agent/api-keys`,
                strategies: `${baseUrl}/api/v1/strategies`,
                simulate: `${baseUrl}/api/v1/agent/simulate`,
                traces: `${baseUrl}/api/v1/agent/traces`,
                leaderboard: `${baseUrl}/api/v1/agent/leaderboard`,
                webhooks: `${baseUrl}/api/v1/agent/webhooks`,
            },
            seller: {
                register: `${baseUrl}/api/v1/seller-agent/register`,
                api_keys: `${baseUrl}/api/v1/seller-agent/api-keys`,
                supply: `${baseUrl}/api/v1/supply`,
                ingest: `${baseUrl}/api/v1/ingest/traffic-platform`,
                leaderboard: `${baseUrl}/api/v1/seller-agent/leaderboard`,
                webhooks: `${baseUrl}/api/v1/seller-agent/webhooks`,
            },
        },
        webhook_events: {
            buyer: ['lead.matched', 'bid.placed', 'strategy.decision', 'auction.won'],
            seller: ['lead.listed', 'auction.closed', 'settlement.paid'],
        },
        fraud_defenses: {
            ingest: ['tcpa_proof', 'phone_email_dedup', 'rate_limits', 'cre_verify', 'min_quality_floor'],
            market: ['strategy_quality_gates', 'reserve_price', 'sealed_bids'],
        },
        sdk: {
            package: '@lead-engine/agent-sdk',
            language: 'typescript',
        },
        integration_flow: {
            buyer: [
                'POST /api/v1/agent/register',
                'POST /api/v1/agent/api-keys (lea_)',
                'POST /api/v1/strategies (StrategySpec JSON)',
                'POST /api/v1/strategies/:id/activate',
                'POST /api/v1/agent/webhooks',
            ],
            seller: [
                'POST /api/v1/seller-agent/register',
                'POST /api/v1/seller-agent/api-keys (lsa_)',
                'POST /api/v1/supply (SupplySpec JSON)',
                'POST /api/v1/supply/:id/activate',
                'POST /api/v1/ingest/traffic-platform',
                'POST /api/v1/seller-agent/webhooks',
            ],
        },
    });
});

export default router;
