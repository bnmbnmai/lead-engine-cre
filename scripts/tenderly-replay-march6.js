/**
 * tenderly-replay-march6.js
 * Replays key transactions from the March-6 certified run
 * into Tenderly for fresh simulation traces.
 *
 * Usage:
 *   node scripts/tenderly-replay-march6.js
 *
 * Required env vars:
 *   TENDERLY_ACCESS_KEY, TENDERLY_ACCOUNT (default: bnm), TENDERLY_PROJECT (default: project)
 */

const TENDERLY_ACCESS_KEY = process.env.TENDERLY_ACCESS_KEY || '5XWrGLaOeeBCvK7pH754TzCYcOZZnA9g';
const TENDERLY_ACCOUNT = process.env.TENDERLY_ACCOUNT || 'bnm';
const TENDERLY_PROJECT = process.env.TENDERLY_PROJECT || 'project';
const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
const NETWORK_ID = '84532';

const API = `https://api.tenderly.co/api/v1/account/${TENDERLY_ACCOUNT}/project/${TENDERLY_PROJECT}`;

// Key transactions from certified-runs/March-6-2026/demo-results-e678990f.json
const TRANSACTIONS = [
    // PoR
    { label: 'PoR Solvency Check (all 6 cycles)', hash: '0x7f70037bbdf8efaa0870f1cedebb2457401b96ebabca13e16ae344d577eb3b87' },
    // NFT Mints #65-#70
    { label: 'NFT #65 mint — mortgage', hash: '0x60497f944474e7204e156eee38989b1cc02dcc97482715949fe92a6179c8a2c1' },
    { label: 'NFT #66 mint — roofing', hash: '0xffc442ff30e7531b4c89e22ca9dad1b219ba4e016d35b0d8567f00d4eaa81c57' },
    { label: 'NFT #67 mint — hvac', hash: '0xbfddd2e7b2621c0ac95cde2de71dc996986e0e7b245b649a84648ce081a3be35' },
    { label: 'NFT #68 mint — mortgage', hash: '0xc1b387d95983793b3d1d843f727948b4444e93f6991d4810fdba87a0fb199ca5' },
    { label: 'NFT #69 mint — solar', hash: '0x1cd6e920a2a13b34829d701efc3b007fe402d35e9325b5a7106e9438ccccafa3' },
    { label: 'NFT #70 mint — real_estate', hash: '0x2563499207fe18bef93a08c33586899631e59f4e370ad5b3c6ea5ac64341ca82' },
    // VRF Tiebreakers
    { label: 'VRF tiebreaker — cycle 1', hash: '0x5f782840c879808cd9253ca87c3c5d3c3572a41955afe49cadad842bcee2b686' },
    { label: 'VRF tiebreaker — cycle 3', hash: '0xf4abc77b372f29988c4313d0d0633cbe969490ccf0e2fa31bafd66b5cb571fcc' },
    // Escrow Settlements
    { label: 'Settle cycle 1 — $27', hash: '0x1022c6ca3a5a675456afff1f1dace7a518c97e0df92995c48a839e63daa23b53' },
    { label: 'Settle cycle 2 — $46', hash: '0xfc85ab0313bd53bb51677ad9398d6d77338639a1465c39654dc2074cb4109c26' },
    { label: 'Settle cycle 3 — $23', hash: '0xea0686e0e22e6205809d790e1288d9140113b8f8e8f3a04b9b9a16d56232c8fb' },
    { label: 'Settle cycle 4 — $50', hash: '0x2eb81eb87b6af57adc272af818a2411be77a62216c72889683e8cf4bdd75c45b' },
    { label: 'Settle cycle 5 — $29', hash: '0x43eed2a316b1f8f04e7aef824c460ef7b771ff5beddad9ad18b895d812875372' },
    { label: 'Settle cycle 6 — $40', hash: '0xa0991cec3f198f918810b17dc4b898957e3d2c03a536d624a709f615578f7185' },
    // Bounty Payouts
    { label: 'Bounty — cycle 1 ($15)', hash: '0xf2079c3973a879018f3182f7f24caced243d7c1c822c3dcafcf289ed192fdf1d' },
    { label: 'Bounty — cycle 2 ($12)', hash: '0x242e834e9f949b8462be0575f79a9017342c22763bb63bedf5d1fce24d9ead2d' },
    { label: 'Bounty — cycle 5 ($15)', hash: '0xac034404f0b9e7957af88381ba7cdd368fc5b80b37974a4a1e206a5e8d8caa67' },
];

async function fetchTx(hash) {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionByHash', params: [hash], id: 1 });
    const res = await fetch(BASE_SEPOLIA_RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const json = await res.json();
    return json.result;
}

async function simulate(label, tx) {
    const payload = {
        network_id: NETWORK_ID,
        from: tx.from,
        to: tx.to,
        input: tx.input,
        gas: parseInt(tx.gas, 16),
        gas_price: tx.gasPrice ? String(parseInt(tx.gasPrice, 16)) : '0',
        value: String(parseInt(tx.value, 16)),
        save: true,
        save_if_fails: true,
        simulation_type: 'full',
        description: `[March-6 Certified Run] ${label}`,
        block_number: parseInt(tx.blockNumber, 16),
    };
    const res = await fetch(`${API}/simulate`, {
        method: 'POST',
        headers: {
            'X-Access-Key': TENDERLY_ACCESS_KEY,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.simulation?.id) {
        return { ok: true, id: json.simulation.id };
    }
    return { ok: false, error: json.error?.message || JSON.stringify(json).slice(0, 120) };
}

async function main() {
    console.log('═══════════════════════════════════════════════');
    console.log('  LeadRTB — Tenderly Replay (March 6, 2026)');
    console.log('  Certified Run: e678990f  •  6 cycles  •  $215 settled');
    console.log('═══════════════════════════════════════════════\n');

    let success = 0, failed = 0;

    for (const { label, hash } of TRANSACTIONS) {
        process.stdout.write(`🔄 ${label} (${hash.slice(0, 10)}…) `);

        const tx = await fetchTx(hash);
        if (!tx) {
            console.log('❌ tx not found on Base Sepolia');
            failed++;
            continue;
        }

        const result = await simulate(label, tx);
        if (result.ok) {
            console.log(`✅ sim:${result.id.slice(0, 8)}`);
            success++;
        } else {
            console.log(`❌ ${result.error}`);
            failed++;
        }

        // Small delay to respect rate limits
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('\n═══════════════════════════════════════════════');
    console.log(`  ✅ ${success} simulated | ❌ ${failed} failed | ${TRANSACTIONS.length} total`);
    console.log(`  View: https://dashboard.tenderly.co/bnm/project/simulator`);
    console.log('═══════════════════════════════════════════════');
}

main().catch(e => { console.error(e); process.exit(1); });
