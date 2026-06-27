/**
 * Vault / settlement reconciliation job (Phase D2).
 * Finds leads stuck in SETTLING or orphaned saga rows and re-triggers recovery.
 */

import { prisma } from '../lib/prisma';
import { recoverStalledSagas } from './settlement-saga.service';

const STUCK_SETTLING_MS = Number(process.env.RECONCILE_STUCK_SETTLING_MS || 10 * 60 * 1000);

export async function runReconciliationSweep(): Promise<{
    stuckSettling: number;
    stalledSagas: number;
}> {
    const cutoff = new Date(Date.now() - STUCK_SETTLING_MS);

    const stuck = await prisma.lead.findMany({
        where: { status: 'SETTLING', createdAt: { lt: cutoff } },
        select: { id: true },
        take: 50,
    });

    for (const row of stuck) {
        console.warn(`[Reconcile] Lead ${row.id} stuck in SETTLING — triggering saga recovery`);
        try {
            const { runSettlementSaga } = await import('./settlement-saga.service');
            await runSettlementSaga(row.id);
        } catch (err: any) {
            console.error(`[Reconcile] Saga recovery failed for ${row.id}: ${err.message}`);
        }
    }

    await recoverStalledSagas();

    const stalledSagas = await prisma.settlementSaga.count({
        where: { state: { in: ['PENDING', 'RUNNING'] }, updatedAt: { lt: cutoff } },
    });

    return { stuckSettling: stuck.length, stalledSagas };
}
