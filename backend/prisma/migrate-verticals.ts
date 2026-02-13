// =============================================
// Lead Engine CRE — Vertical Migration Script
// =============================================
// Restructures flat verticals into the canonical SEED_DATA hierarchy.
// - Remaps slug references across ALL tables (Lead, Ask, BuyerProfile, etc.)
// - Creates missing children from SEED_DATA
// - FK-safe: updates VerticalAuction before Vertical slug renames
// - Transaction-wrapped: crash = full rollback
// - Writes rollback log to prisma/migration-logs/
//
// Usage:
//   npm run db:migrate-verticals              # dry-run (default)
//   npm run db:migrate-verticals -- --execute # actually perform migration
//   npm run db:migrate-verticals -- --verbose # show every individual change
//
// SAFETY: Requires TEST_MODE=true.
// =============================================

import { PrismaClient, VerticalStatus, Prisma } from '@prisma/client';
import { SEED_DATA } from './seed-verticals';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// ─── Safety gate ────────────────────────────
if (process.env.TEST_MODE !== 'true') {
    console.error('❌  Migration requires TEST_MODE=true.');
    process.exit(1);
}

// ─── CLI flags ──────────────────────────────
const EXECUTE = process.argv.includes('--execute');
const VERBOSE = process.argv.includes('--verbose');

// ─── Types ──────────────────────────────────
interface RemapEntry {
    oldSlug: string;
    newSlug: string;
    reason: string;
}

interface ChangeLog {
    table: string;
    rowId: string;
    column: string;
    oldValue: string | string[];
    newValue: string | string[];
}

// ─── Phase 1: Build remap table ─────────────
function buildRemapTable(): Map<string, RemapEntry> {
    const remap = new Map<string, RemapEntry>();

    for (const root of SEED_DATA) {
        // Map root aliases → root slug (e.g. "financial" → "financial_services")
        if (root.aliases) {
            for (const alias of root.aliases) {
                if (alias !== root.slug) {
                    remap.set(alias, {
                        oldSlug: alias,
                        newSlug: root.slug,
                        reason: `alias → root "${root.slug}"`,
                    });
                }
            }
        }

        // Map child aliases → child slug (e.g. "plumber" → "home_services.plumbing")
        if (root.children) {
            for (const child of root.children) {
                // Map the bare child name as a potential flat slug
                // e.g. "residential" by itself wouldn't map (too generic),
                // but "plumber", "divorce_lawyer" etc. would via aliases
                if (child.aliases) {
                    for (const alias of child.aliases) {
                        if (alias !== child.slug) {
                            remap.set(alias, {
                                oldSlug: alias,
                                newSlug: child.slug,
                                reason: `alias → child "${child.slug}"`,
                            });
                        }
                    }
                }
            }
        }
    }

    return remap;
}

// ─── Phase 2: Scan existing verticals ───────
async function scanVerticals(remap: Map<string, RemapEntry>) {
    const allVerticals = await prisma.vertical.findMany({
        include: { children: { select: { slug: true } } },
        orderBy: { sortOrder: 'asc' },
    });

    const canonicalRootSlugs = new Set(SEED_DATA.map((v) => v.slug));
    const canonicalChildSlugs = new Set(
        SEED_DATA.flatMap((v) => v.children?.map((c) => c.slug) ?? [])
    );

    const actions: {
        keep: string[];
        reparent: { slug: string; parentSlug: string }[];
        rename: RemapEntry[];
        orphans: string[];
    } = { keep: [], reparent: [], rename: [], orphans: [] };

    for (const v of allVerticals) {
        if (canonicalRootSlugs.has(v.slug) && v.depth === 0) {
            // Already a canonical root
            actions.keep.push(v.slug);
        } else if (canonicalChildSlugs.has(v.slug) && v.parentId) {
            // Already a canonical child with parent
            actions.keep.push(v.slug);
        } else if (canonicalChildSlugs.has(v.slug) && !v.parentId) {
            // Has a child slug but no parent — needs reparenting
            const parentSlug = v.slug.split('.')[0];
            actions.reparent.push({ slug: v.slug, parentSlug });
        } else if (remap.has(v.slug)) {
            // Known alias — rename
            actions.rename.push(remap.get(v.slug)!);
        } else if (!canonicalRootSlugs.has(v.slug) && !canonicalChildSlugs.has(v.slug)) {
            // Unknown slug — orphan
            actions.orphans.push(v.slug);
        }
    }

    return { allVerticals, actions };
}

// ─── Phase 3: Build list of missing children ─
function findMissingChildren(existingSlugs: Set<string>) {
    const missing: Array<{
        slug: string;
        name: string;
        description: string;
        parentSlug: string;
        sortOrder: number;
        aliases: string[];
        requiresTcpa: boolean;
        requiresKyc: boolean;
        restrictedGeos: string[];
    }> = [];

    for (const root of SEED_DATA) {
        if (root.children) {
            for (const [j, child] of root.children.entries()) {
                if (!existingSlugs.has(child.slug)) {
                    missing.push({
                        slug: child.slug,
                        name: child.name,
                        description: child.description ?? '',
                        parentSlug: root.slug,
                        sortOrder: j,
                        aliases: child.aliases ?? [],
                        requiresTcpa: child.requiresTcpa ?? root.requiresTcpa ?? false,
                        requiresKyc: child.requiresKyc ?? root.requiresKyc ?? false,
                        restrictedGeos: child.restrictedGeos ?? [],
                    });
                }
            }
        }
    }

    return missing;
}

// ─── Slug remapper for a single value ───────
function remapSlug(slug: string, remap: Map<string, RemapEntry>): string {
    return remap.has(slug) ? remap.get(slug)!.newSlug : slug;
}

// ─── Phase 4: Execute migration ─────────────
async function executeMigration(
    remap: Map<string, RemapEntry>,
    actions: Awaited<ReturnType<typeof scanVerticals>>['actions'],
    missingChildren: ReturnType<typeof findMissingChildren>
) {
    const changeLog: ChangeLog[] = [];
    const renameMap = new Map(actions.rename.map((r) => [r.oldSlug, r.newSlug]));

    // Add the alias-based remaps that exist in the remap table
    for (const [old, entry] of remap.entries()) {
        renameMap.set(old, entry.newSlug);
    }

    await prisma.$transaction(async (tx) => {
        // 4a. Update VerticalAuction.verticalSlug (FK — must happen first)
        for (const [oldSlug, newSlug] of renameMap) {
            const auctions = await tx.verticalAuction.findMany({
                where: { verticalSlug: oldSlug },
                select: { id: true },
            });
            if (auctions.length > 0) {
                await tx.verticalAuction.updateMany({
                    where: { verticalSlug: oldSlug },
                    data: { verticalSlug: newSlug },
                });
                for (const a of auctions) {
                    changeLog.push({ table: 'VerticalAuction', rowId: a.id, column: 'verticalSlug', oldValue: oldSlug, newValue: newSlug });
                }
                if (VERBOSE) console.log(`    📎 VerticalAuction: ${auctions.length} rows ${oldSlug} → ${newSlug}`);
            }
        }

        // 4b. Update Lead.vertical
        for (const [oldSlug, newSlug] of renameMap) {
            const result = await tx.lead.updateMany({
                where: { vertical: oldSlug },
                data: { vertical: newSlug },
            });
            if (result.count > 0) {
                changeLog.push({ table: 'Lead', rowId: `${result.count} rows`, column: 'vertical', oldValue: oldSlug, newValue: newSlug });
                if (VERBOSE) console.log(`    📎 Lead: ${result.count} rows ${oldSlug} → ${newSlug}`);
            }
        }

        // 4c. Update Ask.vertical
        for (const [oldSlug, newSlug] of renameMap) {
            const result = await tx.ask.updateMany({
                where: { vertical: oldSlug },
                data: { vertical: newSlug },
            });
            if (result.count > 0) {
                changeLog.push({ table: 'Ask', rowId: `${result.count} rows`, column: 'vertical', oldValue: oldSlug, newValue: newSlug });
                if (VERBOSE) console.log(`    📎 Ask: ${result.count} rows ${oldSlug} → ${newSlug}`);
            }
        }

        // 4d. Update BuyerPreferenceSet.vertical
        for (const [oldSlug, newSlug] of renameMap) {
            const result = await tx.buyerPreferenceSet.updateMany({
                where: { vertical: oldSlug },
                data: { vertical: newSlug },
            });
            if (result.count > 0) {
                changeLog.push({ table: 'BuyerPreferenceSet', rowId: `${result.count} rows`, column: 'vertical', oldValue: oldSlug, newValue: newSlug });
                if (VERBOSE) console.log(`    📎 BuyerPreferenceSet: ${result.count} rows ${oldSlug} → ${newSlug}`);
            }
        }

        // 4e. Update VerticalSuggestion.parentSlug
        for (const [oldSlug, newSlug] of renameMap) {
            const result = await tx.verticalSuggestion.updateMany({
                where: { parentSlug: oldSlug },
                data: { parentSlug: newSlug },
            });
            if (result.count > 0) {
                changeLog.push({ table: 'VerticalSuggestion', rowId: `${result.count} rows`, column: 'parentSlug', oldValue: oldSlug, newValue: newSlug });
                if (VERBOSE) console.log(`    📎 VerticalSuggestion: ${result.count} rows ${oldSlug} → ${newSlug}`);
            }
        }

        // 4f. Update BuyerProfile.verticals[] (array — read-modify-write)
        const buyerProfiles = await tx.buyerProfile.findMany({
            select: { id: true, verticals: true },
        });
        for (const bp of buyerProfiles) {
            const mapped = bp.verticals.map((s) => remapSlug(s, remap));
            const changed = bp.verticals.some((s, i) => s !== mapped[i]);
            if (changed) {
                await tx.buyerProfile.update({
                    where: { id: bp.id },
                    data: { verticals: mapped },
                });
                changeLog.push({ table: 'BuyerProfile', rowId: bp.id, column: 'verticals', oldValue: bp.verticals, newValue: mapped });
                if (VERBOSE) console.log(`    📎 BuyerProfile ${bp.id}: [${bp.verticals}] → [${mapped}]`);
            }
        }

        // 4g. Update SellerProfile.verticals[] (array — read-modify-write)
        const sellerProfiles = await tx.sellerProfile.findMany({
            select: { id: true, verticals: true },
        });
        for (const sp of sellerProfiles) {
            const mapped = sp.verticals.map((s) => remapSlug(s, remap));
            const changed = sp.verticals.some((s, i) => s !== mapped[i]);
            if (changed) {
                await tx.sellerProfile.update({
                    where: { id: sp.id },
                    data: { verticals: mapped },
                });
                changeLog.push({ table: 'SellerProfile', rowId: sp.id, column: 'verticals', oldValue: sp.verticals, newValue: mapped });
                if (VERBOSE) console.log(`    📎 SellerProfile ${sp.id}: [${sp.verticals}] → [${mapped}]`);
            }
        }

        // 4h. Rename Vertical slugs (after FK references are updated)
        for (const entry of actions.rename) {
            const existing = await tx.vertical.findUnique({ where: { slug: entry.oldSlug } });
            if (existing) {
                // Check if the target slug already exists (would be a collision)
                const target = await tx.vertical.findUnique({ where: { slug: entry.newSlug } });
                if (target) {
                    // Target exists — merge: move any children, then delete the old vertical
                    if (VERBOSE) console.log(`    🔀 Merging "${entry.oldSlug}" into existing "${entry.newSlug}"`);
                    await tx.vertical.updateMany({
                        where: { parentId: existing.id },
                        data: { parentId: target.id },
                    });
                    await tx.vertical.delete({ where: { id: existing.id } });
                    changeLog.push({ table: 'Vertical', rowId: existing.id, column: 'slug (merged+deleted)', oldValue: entry.oldSlug, newValue: entry.newSlug });
                } else {
                    // Target doesn't exist — just rename
                    await tx.vertical.update({
                        where: { slug: entry.oldSlug },
                        data: { slug: entry.newSlug },
                    });
                    changeLog.push({ table: 'Vertical', rowId: existing.id, column: 'slug', oldValue: entry.oldSlug, newValue: entry.newSlug });
                    if (VERBOSE) console.log(`    ✏️  Vertical: "${entry.oldSlug}" → "${entry.newSlug}"`);
                }
            }
        }

        // 4i. Reparent verticals that have child slugs but no parent
        for (const { slug, parentSlug } of actions.reparent) {
            const parent = await tx.vertical.findUnique({ where: { slug: parentSlug } });
            if (parent) {
                await tx.vertical.update({
                    where: { slug },
                    data: { parentId: parent.id, depth: parent.depth + 1 },
                });
                changeLog.push({ table: 'Vertical', rowId: slug, column: 'parentId+depth', oldValue: 'null/0', newValue: `${parent.id}/${parent.depth + 1}` });
                if (VERBOSE) console.log(`    🔗 Reparented "${slug}" under "${parentSlug}"`);
            }
        }

        // 4j. Create missing children from SEED_DATA
        let created = 0;
        for (const child of missingChildren) {
            const parent = await tx.vertical.findUnique({ where: { slug: child.parentSlug } });
            if (!parent) {
                console.log(`    ⚠️  Skipping "${child.slug}" — parent "${child.parentSlug}" not found`);
                continue;
            }
            // Double-check slug doesn't exist (may have been created by rename step)
            const exists = await tx.vertical.findUnique({ where: { slug: child.slug } });
            if (exists) continue;

            await tx.vertical.create({
                data: {
                    slug: child.slug,
                    name: child.name,
                    description: child.description,
                    parentId: parent.id,
                    depth: 1,
                    sortOrder: child.sortOrder,
                    aliases: child.aliases,
                    status: VerticalStatus.ACTIVE,
                    requiresTcpa: child.requiresTcpa,
                    requiresKyc: child.requiresKyc,
                    restrictedGeos: child.restrictedGeos,
                },
            });
            changeLog.push({ table: 'Vertical', rowId: child.slug, column: '(created)', oldValue: '', newValue: child.slug });
            if (VERBOSE) console.log(`    ✅ Created "${child.slug}" under "${child.parentSlug}"`);
            created++;
        }
        if (created > 0) console.log(`  📦 Created ${created} missing children`);
    }, { timeout: 30000 });

    return changeLog;
}

// ─── Phase 5: Write rollback log ────────────
function writeRollbackLog(changeLog: ChangeLog[]) {
    const logDir = path.join(__dirname, 'migration-logs');
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const logPath = path.join(logDir, `verticals-${timestamp}.json`);

    fs.writeFileSync(
        logPath,
        JSON.stringify(
            {
                executedAt: new Date().toISOString(),
                totalChanges: changeLog.length,
                changes: changeLog,
            },
            null,
            2
        )
    );

    return logPath;
}

// ─── Main ───────────────────────────────────
async function main() {
    console.log('');
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║  Lead Engine CRE — Vertical Migration        ║');
    console.log('╠══════════════════════════════════════════════╣');
    console.log(`║  Mode: ${EXECUTE ? '🔥 EXECUTE' : '👀 DRY-RUN'}                             ║`);
    console.log('╚══════════════════════════════════════════════╝');
    console.log('');

    // Phase 1: Build remap table
    console.log('📋 Phase 1: Building remap table from SEED_DATA aliases...');
    const remap = buildRemapTable();
    console.log(`  Found ${remap.size} alias → canonical slug mappings`);
    if (VERBOSE) {
        for (const [alias, entry] of remap) {
            console.log(`    "${alias}" → "${entry.newSlug}" (${entry.reason})`);
        }
    }

    // Phase 2: Scan existing verticals
    console.log('\n🔍 Phase 2: Scanning existing verticals...');
    const { allVerticals, actions } = await scanVerticals(remap);
    const existingSlugs = new Set(allVerticals.map((v) => v.slug));

    console.log(`  Total verticals in DB: ${allVerticals.length}`);
    console.log(`  ✅ Keep as-is: ${actions.keep.length}`);
    console.log(`  🔗 Need reparenting: ${actions.reparent.length}`);
    console.log(`  ✏️  Need renaming: ${actions.rename.length}`);
    console.log(`  ⚠️  Orphans (untouched): ${actions.orphans.length}`);

    if (actions.reparent.length > 0) {
        for (const r of actions.reparent) {
            console.log(`    🔗 "${r.slug}" → attach under "${r.parentSlug}"`);
        }
    }
    if (actions.rename.length > 0) {
        for (const r of actions.rename) {
            console.log(`    ✏️  "${r.oldSlug}" → "${r.newSlug}" (${r.reason})`);
        }
    }
    if (actions.orphans.length > 0) {
        for (const o of actions.orphans) {
            console.log(`    ⚠️  "${o}" — unknown slug, leaving untouched`);
        }
    }

    // Phase 3: Find missing children
    console.log('\n📦 Phase 3: Checking for missing children from SEED_DATA...');
    const missingChildren = findMissingChildren(existingSlugs);
    console.log(`  Missing children to create: ${missingChildren.length}`);
    if (missingChildren.length > 0 && VERBOSE) {
        for (const m of missingChildren) {
            console.log(`    + "${m.slug}" under "${m.parentSlug}"`);
        }
    }

    // Total planned changes
    const totalPlanned = actions.reparent.length + actions.rename.length + missingChildren.length;

    if (totalPlanned === 0) {
        console.log('\n✅ Nothing to do — database already matches SEED_DATA hierarchy.');
        return;
    }

    console.log(`\n📊 Total planned changes: ${totalPlanned}`);

    // Phase 4: Execute or stop
    if (!EXECUTE) {
        console.log('\n👀 DRY-RUN complete. No changes made.');
        console.log('   To apply changes, re-run with --execute flag:');
        console.log('   npm run db:migrate-verticals -- --execute');
        return;
    }

    console.log('\n🔥 Phase 4: Executing migration...');
    const changeLog = await executeMigration(remap, actions, missingChildren);

    // Phase 5: Write rollback log
    const logPath = writeRollbackLog(changeLog);
    console.log(`\n📝 Rollback log written to: ${logPath}`);

    // Phase 6: Verify
    console.log('\n✅ Phase 5: Verification...');
    const roots = await prisma.vertical.findMany({
        where: { depth: 0 },
        include: { children: { select: { slug: true } } },
        orderBy: { sortOrder: 'asc' },
    });

    console.log(`  Roots: ${roots.length}`);
    for (const r of roots) {
        console.log(`    ${r.slug} (${r.children.length} children): ${r.children.map((c) => c.slug).join(', ')}`);
    }

    const totalVerticals = await prisma.vertical.count();
    const orphanCount = await prisma.vertical.count({ where: { depth: 0, NOT: { slug: { in: SEED_DATA.map((s) => s.slug) } } } });
    console.log(`\n  Total verticals: ${totalVerticals}`);
    console.log(`  Orphan roots: ${orphanCount}`);
    console.log(`\n🎉 Migration complete! ${changeLog.length} changes applied.`);
}

main()
    .catch((err) => {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
