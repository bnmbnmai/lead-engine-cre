/**
 * Owned integrator bot — continuous seller traffic for Rung 2.
 *
 * Mints (or reuses) an lsa_ path via demo seller login, ensures SupplySpec,
 * then posts unique leads on an interval.
 *
 * Usage:
 *   API_URL=http://localhost:3001 npx tsx scripts/integrator-bot.ts
 *   INTERVAL_MS=15000 MAX_LEADS=20 npx tsx scripts/integrator-bot.ts
 */

const API = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 15000);
const MAX_LEADS = Number(process.env.MAX_LEADS || 20);

async function req(path: string, opts: RequestInit = {}, token?: string) {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(opts.headers as Record<string, string> || {}),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${API}${path}`, { ...opts, headers });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body };
}

function phone(): string {
    const n = `${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(-10);
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
}

async function bootstrap() {
    const login = await req('/api/v1/demo-panel/demo-login', {
        method: 'POST',
        body: JSON.stringify({ role: 'SELLER' }),
    });
    if (login.status >= 400) throw new Error(`demo-login: ${login.status} ${JSON.stringify(login.body)}`);
    const jwt = login.body.token || login.body.accessToken || login.body.jwt;
    if (!jwt) throw new Error('no seller jwt');

    await req('/api/v1/seller-agent/register', {
        method: 'POST',
        body: JSON.stringify({ displayName: 'Owned Integrator Bot' }),
    }, jwt);

    const keyRes = await req('/api/v1/seller-agent/api-keys', {
        method: 'POST',
        body: JSON.stringify({ label: 'integrator-bot', scopes: ['read', 'supply', 'admin'] }),
    }, jwt);
    if (keyRes.status !== 201) throw new Error(`api-key: ${JSON.stringify(keyRes.body)}`);
    const lsa = keyRes.body.apiKey as string;

    const list = await req('/api/v1/supply', {}, lsa);
    let supplyId = (list.body?.strategies || []).find((s: any) => s.status === 'ACTIVE')?.id;
    if (!supplyId) {
        const created = await req('/api/v1/supply', {
            method: 'POST',
            body: JSON.stringify({
                spec: {
                    version: 1,
                    name: 'Integrator bot supply',
                    vertical: 'solar.residential',
                    geoCountries: ['US'],
                    reservePrice: 5,
                    dailyListingCap: 500,
                    hourlyListingCap: 100,
                    requiredFieldKeys: ['email', 'phone'],
                    requireTcpaProof: true,
                },
            }),
        }, lsa);
        if (created.status !== 201) throw new Error(`supply: ${JSON.stringify(created.body)}`);
        supplyId = created.body.id;
        await req(`/api/v1/supply/${supplyId}/activate`, { method: 'POST' }, lsa);
    }

    return { lsa, supplyId };
}

async function postLead(lsa: string, supplyId: string, i: number) {
    const ts = Date.now();
    const { status, body } = await req('/api/v1/ingest/traffic-platform', {
        method: 'POST',
        body: JSON.stringify({
            platform: 'owned_integrator_bot',
            campaignId: `bot-${new Date().toISOString().slice(0, 10)}`,
            vertical: 'solar.residential',
            geo: { country: 'US', state: 'CA', zip: '92101' },
            tcpaConsentAt: new Date().toISOString(),
            tcpaProof: { consentId: `bot-${ts}-${i}`, provider: 'owned_bot' },
            supplyStrategyId: supplyId,
            fields: {
                firstName: 'Bot',
                lastName: `Lead${i}`,
                email: `bot.lead.${ts}.${i}@example.com`,
                phone: phone(),
                roofAge: '5-10 years',
                ownOrRent: 'Own',
            },
        }),
    }, lsa);
    return { status, body };
}

async function main() {
    console.log(`[bot] integrator against ${API} every ${INTERVAL_MS}ms (max ${MAX_LEADS})`);
    const { lsa, supplyId } = await bootstrap();
    console.log(`[bot] supply=${supplyId} key=lsa_…${lsa.slice(-6)}`);

    let i = 0;
    const tick = async () => {
        if (i >= MAX_LEADS) {
            console.log('[bot] done');
            process.exit(0);
        }
        i += 1;
        try {
            const { status, body } = await postLead(lsa, supplyId, i);
            if (status === 201) {
                console.log(`[bot] #${i} listed ${body.lead?.id} qs=${body.lead?.qualityScore}`);
            } else {
                console.log(`[bot] #${i} ${status} ${body.code || body.error || JSON.stringify(body)}`);
            }
        } catch (err: any) {
            console.error(`[bot] #${i} error`, err.message);
        }
    };

    await tick();
    setInterval(tick, INTERVAL_MS);
}

main().catch((err) => {
    console.error('[bot] fatal', err.message);
    process.exit(1);
});
