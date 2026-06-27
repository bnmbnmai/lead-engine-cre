#!/usr/bin/env ts-node
/**
 * seed-agent-buyer.ts — One-shot setup for the Kimi AI agent's buyer account.
 *
 * Run:  npx ts-node src/scripts/seed-agent-buyer.ts
 *
 * What it does (all idempotent — safe to re-run):
 *   1. Upserts a User row for the Kimi agent wallet (Wallet 12)
 *   2. Upserts a BuyerProfile with KYC=VERIFIED
 *   3. Upserts an EscrowVault so vault queries don't fail
 *   4. Creates a signed 7-day JWT + matching Session row (the API_KEY for the MCP server)
 *   5. Prints KIMI_AGENT_JWT and KIMI_AGENT_BUYER_PROFILE_ID — copy to .env files
 */

import { prisma } from '../lib/prisma';
import { generateToken } from '../middleware/auth';

// ── Kimi agent identity (Wallet 10 — already in DEMO_BUYER_WALLETS, pre-funded each run)
const KIMI_WALLET = '0x7be5ce8824d5c1890bC09042837cEAc57a55fdad';
const KIMI_LABEL = 'Kimi AI Agent';

async function main(): Promise<void> {
    console.log('\n🤖  Seeding Kimi AI agent buyer account…\n');

    // 1 — Upsert User
    const user = await prisma.user.upsert({
        where: { walletAddress: KIMI_WALLET },
        update: { role: 'BUYER' },
        create: {
            walletAddress: KIMI_WALLET,
            role: 'BUYER',
            email: 'kimi-agent@lead-engine.internal',
        },
    });
    console.log(`✅ User:          ${user.id}  (${user.walletAddress})`);

    // 2 — Upsert BuyerProfile
    const profile = await prisma.buyerProfile.upsert({
        where: { userId: user.id },
        update: { kycStatus: 'VERIFIED', companyName: KIMI_LABEL },
        create: {
            userId: user.id,
            companyName: KIMI_LABEL,
            verticals: [],       // preference sets hold the per-vertical rules
            kycStatus: 'VERIFIED',
            kycVerifiedAt: new Date(),
        },
    });
    console.log(`✅ BuyerProfile:  ${profile.id}`);

    // 3 — Upsert EscrowVault (balance managed off-chain by the demo pre-fund step)
    await prisma.escrowVault.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
    });
    console.log(`✅ EscrowVault:   created/verified`);

    // 4 — Create a fresh session token
    //     MUST be a real signed JWT: authMiddleware verifies the JWT signature
    //     FIRST (jwt.verify) and only then checks the Session row. A random hex
    //     string fails signature verification and is rejected with 401.
    //     The MCP server sends it as:  Authorization: Bearer <token>
    const token = generateToken({
        userId: user.id,
        walletAddress: user.walletAddress,
        role: user.role,
    });
    // Session validity is bounded by the JWT's own exp (7d) — the Session row
    // simply must not expire before the JWT does.
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days (matches JWT exp)

    const session = await prisma.session.create({
        data: {
            userId: user.id,
            token,
            expiresAt,
            userAgent: 'Kimi-MCP-Agent/1.0',
            ipAddress: '127.0.0.1',
        },
    });
    console.log(`✅ Session:       ${session.id}  (expires ${expiresAt.toISOString()})`);

    // 5 — Print actionable env vars
    console.log('\n─────────────────────────────────────────────────────────');
    console.log('Copy the following into your .env files:\n');
    console.log(`# mcp-server/.env`);
    console.log(`API_KEY=${token}\n`);
    console.log(`# backend/.env`);
    console.log(`KIMI_AGENT_WALLET=${KIMI_WALLET}`);
    console.log(`KIMI_AGENT_BUYER_PROFILE_ID=${profile.id}`);
    console.log(`KIMI_AGENT_USER_ID=${user.id}`);
    console.log('─────────────────────────────────────────────────────────\n');
    console.log('🎉  Done. Re-running this script is safe (idempotent).\n');
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
