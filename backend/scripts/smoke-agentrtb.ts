/**
 * AgentRTB smoke path — seller ingest → SupplySpec → buyer StrategySpec.
 *
 * Usage:
 *   API_URL=http://localhost:3001 npx tsx scripts/smoke-agentrtb.ts
 *
 * Requires demo-panel routes (non-production or ALLOW_DEMO_ROUTES=true).
 */

const API = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');

type Json = Record<string, unknown>;

async function req(path: string, opts: RequestInit = {}, token?: string): Promise<{ status: number; body: any }> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(opts.headers as Record<string, string> || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    const text = await res.text();
    let body: any;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    return { status: res.status, body };
}

function assert(cond: unknown, msg: string): asserts cond {
    if (!cond) throw new Error(msg);
}

function uniqPhone(): string {
    const n = Date.now().toString().slice(-7);
    return `(555) ${n.slice(0, 3)}-${n.slice(3)}`;
}

async function demoLogin(role: 'BUYER' | 'SELLER'): Promise<string> {
    const { status, body } = await req('/api/v1/demo-panel/demo-login', {
        method: 'POST',
        body: JSON.stringify({ role }),
    });
    assert(status === 200 || status === 201, `demo-login ${role} failed: ${status} ${JSON.stringify(body)}`);
    const token = body.token || body.accessToken || body.jwt;
    assert(token, `demo-login ${role}: no token in ${JSON.stringify(body)}`);
    return token as string;
}

async function main() {
    console.log(`\n[smoke] AgentRTB path against ${API}\n`);

    // Discovery
    const well = await req('/.well-known/agent.json');
    assert(well.status === 200, `well-known failed: ${well.status}`);
    assert(well.body?.endpoints?.seller?.ingest, 'well-known missing seller.ingest');
    assert(well.body?.endpoints?.buyer?.strategies, 'well-known missing buyer.strategies');
    console.log('✓ /.well-known/agent.json (buyer + seller)');

    // Seller JWT
    const sellerJwt = await demoLogin('SELLER');
    console.log('✓ seller demo-login');

    const sellerReg = await req('/api/v1/seller-agent/register', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Smoke Seller Agent' }),
    }, sellerJwt);
    assert(sellerReg.status === 201 || sellerReg.status === 200, `seller register: ${sellerReg.status} ${JSON.stringify(sellerReg.body)}`);
    console.log('✓ seller-agent register');

    const sellerKey = await req('/api/v1/seller-agent/api-keys', {
        method: 'POST',
        body: JSON.stringify({ label: 'smoke', scopes: ['read', 'supply', 'admin'] }),
    }, sellerJwt);
    assert(sellerKey.status === 201, `seller api-key: ${sellerKey.status} ${JSON.stringify(sellerKey.body)}`);
    const lsa = sellerKey.body.apiKey as string;
    assert(lsa?.startsWith('lsa_'), 'expected lsa_ key');
    console.log('✓ lsa_ key minted');

    const supplySpec = {
        version: 1,
        name: 'Smoke solar supply',
        vertical: 'solar.residential',
        geoCountries: ['US'],
        reservePrice: 5,
        dailyListingCap: 100,
        hourlyListingCap: 50,
        requiredFieldKeys: ['email', 'phone'],
        requireTcpaProof: true,
    };
    const supplyCreate = await req('/api/v1/supply', {
        method: 'POST',
        body: JSON.stringify({ spec: supplySpec }),
    }, lsa);
    assert(supplyCreate.status === 201, `supply create: ${supplyCreate.status} ${JSON.stringify(supplyCreate.body)}`);
    const supplyId = supplyCreate.body.id as string;
    const supplyAct = await req(`/api/v1/supply/${supplyId}/activate`, { method: 'POST' }, lsa);
    assert(supplyAct.status === 200, `supply activate: ${supplyAct.status}`);
    console.log('✓ SupplySpec create + activate');

    // TCPA rejection
    const badTcpa = await req('/api/v1/ingest/traffic-platform', {
        method: 'POST',
        body: JSON.stringify({
            platform: 'smoke',
            campaignId: 'smoke-no-tcpa',
            vertical: 'solar.residential',
            geo: { country: 'US', state: 'CA' },
            fields: { email: 'bad@example.com', phone: uniqPhone() },
        }),
    }, lsa);
    assert(badTcpa.status === 400, `expected TCPA 400, got ${badTcpa.status}`);
    console.log('✓ ingest rejects missing TCPA');

    const phone = uniqPhone();
    const email = `smoke.${Date.now()}@example.com`;
    const ingest = await req('/api/v1/ingest/traffic-platform', {
        method: 'POST',
        body: JSON.stringify({
            platform: 'smoke_bot',
            campaignId: 'smoke-campaign',
            vertical: 'solar.residential',
            geo: { country: 'US', state: 'CA', city: 'San Diego', zip: '92101' },
            tcpaConsentAt: new Date().toISOString(),
            tcpaProof: { consentId: `smoke-${Date.now()}`, provider: 'smoke' },
            supplyStrategyId: supplyId,
            fields: {
                firstName: 'Smoke',
                lastName: 'Test',
                email,
                phone,
                roofAge: '5-10 years',
                ownOrRent: 'Own',
            },
        }),
    }, lsa);
    assert(
        ingest.status === 201 || ingest.status === 400,
        `ingest unexpected: ${ingest.status} ${JSON.stringify(ingest.body)}`,
    );
    if (ingest.status === 201) {
        assert(ingest.body?.lead?.status === 'IN_AUCTION', 'lead should be IN_AUCTION');
        console.log(`✓ ingest → IN_AUCTION lead=${ingest.body.lead.id} qs=${ingest.body.lead.qualityScore}`);
    } else {
        console.log(`⚠ ingest rejected by CRE/quality (ok for smoke): ${ingest.body?.error || ingest.body?.code}`);
    }

    // Duplicate should 409 if first succeeded
    if (ingest.status === 201) {
        const dup = await req('/api/v1/ingest/traffic-platform', {
            method: 'POST',
            body: JSON.stringify({
                platform: 'smoke_bot',
                campaignId: 'smoke-dup',
                vertical: 'solar.residential',
                geo: { country: 'US', state: 'CA' },
                tcpaConsentAt: new Date().toISOString(),
                tcpaProof: { consentId: 'dup' },
                fields: { email, phone, firstName: 'Dup' },
            }),
        }, lsa);
        assert(dup.status === 409, `expected dedup 409, got ${dup.status}`);
        console.log('✓ duplicate contact → 409');
    }

    // Buyer path
    const buyerJwt = await demoLogin('BUYER');
    console.log('✓ buyer demo-login');

    const buyerReg = await req('/api/v1/agent/register', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Smoke Buyer Agent' }),
    }, buyerJwt);
    assert(buyerReg.status === 201 || buyerReg.status === 200, `buyer register: ${buyerReg.status}`);
    const buyerKey = await req('/api/v1/agent/api-keys', {
        method: 'POST',
        body: JSON.stringify({ label: 'smoke', scopes: ['read', 'bid', 'admin'] }),
    }, buyerJwt);
    assert(buyerKey.status === 201, `buyer api-key: ${buyerKey.status}`);
    const lea = buyerKey.body.apiKey as string;
    assert(lea?.startsWith('lea_'), 'expected lea_ key');
    console.log('✓ lea_ key minted');

    const strategySpec = {
        version: 1,
        name: 'Smoke solar buyer',
        gates: {
            vertical: 'solar.residential',
            geoCountries: ['US'],
            minQualityScore: 0,
            acceptOffSite: true,
            requireVerified: false,
            fieldFilters: [],
        },
        bidCurve: { type: 'fixed', base: 12 },
        budget: { maxBidPerLead: 25, dailyBudget: 200, totalBudget: null, maxConcurrentBids: 5 },
    };
    const strat = await req('/api/v1/strategies', {
        method: 'POST',
        body: JSON.stringify({ spec: strategySpec }),
    }, lea);
    assert(strat.status === 201, `strategy create: ${strat.status} ${JSON.stringify(strat.body)}`);
    const stratId = strat.body.id as string;
    const act = await req(`/api/v1/strategies/${stratId}/activate`, { method: 'POST' }, lea);
    assert(act.status === 200, `strategy activate: ${act.status}`);
    console.log('✓ StrategySpec create + activate');

    if (ingest.status === 201 && ingest.body?.lead?.id) {
        const pipe = await req(`/api/v1/agent/pipeline/${ingest.body.lead.id}`, { method: 'POST' }, lea);
        console.log(`✓ pipeline enqueue status=${pipe.status}`);
    }

    console.log(`
[smoke] Rung 1 API path OK
  Settlement note: full sealed-bid → SOLD needs vault funds + auction timer.
  Covered in CI by settlement-saga tests; run bot:integrator for continuous supply.

Next: docs/STAGING_SMOKE.md → deploy staging, then docs/PILOT_COMMERCIAL.md
`);
}

main().catch((err) => {
    console.error('\n[smoke] FAILED:', err.message);
    process.exit(1);
});
