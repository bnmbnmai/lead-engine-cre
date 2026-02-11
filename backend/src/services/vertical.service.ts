/**
 * Vertical Service
 *
 * Manages hierarchical verticals with CRUD, tree queries,
 * alias resolution, compliance flag merging, and caching.
 */

import { prisma } from '../lib/prisma';
import { verticalHierarchyCache } from '../lib/cache';
import type { VerticalCreate, VerticalUpdate } from '../utils/validation';

const MAX_DEPTH = 3; // 0 = root, max child depth = 3

// ============================================
// Types
// ============================================

export interface VerticalNode {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    parentId: string | null;
    depth: number;
    sortOrder: number;
    attributes: any;
    aliases: string[];
    status: string;
    requiresTcpa: boolean;
    requiresKyc: boolean;
    restrictedGeos: string[];
    children: VerticalNode[];
}

export interface ComplianceFlags {
    requiresTcpa: boolean;
    requiresKyc: boolean;
    restrictedGeos: string[];
    chain: string[]; // slug path from root → leaf
}

// ============================================
// Slug Helper
// ============================================

function slugify(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_|_$/g, '');
}

function buildSlug(parentSlug: string | null, name: string): string {
    const segment = slugify(name);
    return parentSlug ? `${parentSlug}.${segment}` : segment;
}

// ============================================
// Create
// ============================================

export async function createVertical(
    data: VerticalCreate,
    isAdmin: boolean
): Promise<{ vertical: any; error?: string }> {
    // Resolve parent
    let parent: any = null;
    let parentSlug: string | null = null;
    let depth = 0;

    if (data.parentSlug) {
        parent = await prisma.vertical.findUnique({
            where: { slug: data.parentSlug },
        });
        if (!parent) {
            return { vertical: null, error: `Parent vertical "${data.parentSlug}" not found` };
        }
        parentSlug = parent.slug;
        depth = parent.depth + 1;

        if (depth > MAX_DEPTH) {
            return {
                vertical: null,
                error: `Maximum nesting depth is ${MAX_DEPTH}. Parent "${data.parentSlug}" is at depth ${parent.depth}.`,
            };
        }
    }

    const slug = buildSlug(parentSlug, data.name);

    // Check slug uniqueness
    const existing = await prisma.vertical.findUnique({ where: { slug } });
    if (existing) {
        return { vertical: null, error: `Vertical slug "${slug}" already exists` };
    }

    // Check alias collisions
    if (data.aliases && data.aliases.length > 0) {
        const collision = await prisma.vertical.findFirst({
            where: {
                OR: [
                    { slug: { in: data.aliases } },
                    { aliases: { hasSome: data.aliases } },
                ],
            },
        });
        if (collision) {
            return {
                vertical: null,
                error: `Alias collision with existing vertical "${collision.slug}"`,
            };
        }
    }

    const vertical = await prisma.vertical.create({
        data: {
            slug,
            name: data.name,
            description: data.description,
            parentId: parent?.id ?? null,
            depth,
            attributes: data.attributes ?? undefined,
            aliases: data.aliases ?? [],
            status: isAdmin ? 'ACTIVE' : 'PROPOSED',
            requiresTcpa: data.requiresTcpa ?? false,
            requiresKyc: data.requiresKyc ?? false,
            restrictedGeos: data.restrictedGeos ?? [],
        },
        include: { children: true },
    });

    // Bust cache
    verticalHierarchyCache.clear();

    return { vertical };
}

// ============================================
// Update
// ============================================

export async function updateVertical(
    id: string,
    data: VerticalUpdate
): Promise<{ vertical: any; error?: string }> {
    const existing = await prisma.vertical.findUnique({ where: { id } });
    if (!existing) {
        return { vertical: null, error: 'Vertical not found' };
    }

    // Alias collision check
    if (data.aliases && data.aliases.length > 0) {
        const collision = await prisma.vertical.findFirst({
            where: {
                id: { not: id },
                OR: [
                    { slug: { in: data.aliases } },
                    { aliases: { hasSome: data.aliases } },
                ],
            },
        });
        if (collision) {
            return {
                vertical: null,
                error: `Alias collision with existing vertical "${collision.slug}"`,
            };
        }
    }

    const vertical = await prisma.vertical.update({
        where: { id },
        data: {
            name: data.name,
            description: data.description,
            attributes: data.attributes ?? undefined,
            aliases: data.aliases,
            status: data.status as any,
            sortOrder: data.sortOrder,
            requiresTcpa: data.requiresTcpa,
            requiresKyc: data.requiresKyc,
            restrictedGeos: data.restrictedGeos,
        },
        include: { children: true },
    });

    verticalHierarchyCache.clear();
    return { vertical };
}

// ============================================
// Delete (with cascade confirmation)
// ============================================

export async function deleteVertical(
    id: string,
    confirm: boolean
): Promise<{ deleted: boolean; error?: string; childCount?: number }> {
    const vertical = await prisma.vertical.findUnique({
        where: { id },
        include: { _count: { select: { children: true } } },
    });

    if (!vertical) {
        return { deleted: false, error: 'Vertical not found' };
    }

    if (vertical._count.children > 0 && !confirm) {
        return {
            deleted: false,
            error: `This vertical has ${vertical._count.children} children. Pass confirm=true to cascade delete.`,
            childCount: vertical._count.children,
        };
    }

    await prisma.vertical.delete({ where: { id } });
    verticalHierarchyCache.clear();
    return { deleted: true };
}

// ============================================
// Hierarchy (full tree)
// ============================================

export async function getHierarchy(): Promise<VerticalNode[]> {
    const cached = verticalHierarchyCache.get('full_tree');
    if (cached) return cached;

    const allVerticals = await prisma.vertical.findMany({
        where: { status: 'ACTIVE' },
        orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });

    // Build tree in memory
    const map = new Map<string, VerticalNode>();
    const roots: VerticalNode[] = [];

    for (const v of allVerticals) {
        map.set(v.id, {
            id: v.id,
            slug: v.slug,
            name: v.name,
            description: v.description,
            parentId: v.parentId,
            depth: v.depth,
            sortOrder: v.sortOrder,
            attributes: v.attributes,
            aliases: v.aliases,
            status: v.status,
            requiresTcpa: v.requiresTcpa,
            requiresKyc: v.requiresKyc,
            restrictedGeos: v.restrictedGeos,
            children: [],
        });
    }

    for (const node of map.values()) {
        if (node.parentId && map.has(node.parentId)) {
            map.get(node.parentId)!.children.push(node);
        } else {
            roots.push(node);
        }
    }

    verticalHierarchyCache.set('full_tree', roots);
    return roots;
}

// ============================================
// Subtree (single vertical + its children)
// ============================================

export async function getSubtree(slug: string): Promise<VerticalNode | null> {
    const cacheKey = `subtree:${slug}`;
    const cached = verticalHierarchyCache.get(cacheKey);
    if (cached) return cached;

    const root = await prisma.vertical.findUnique({ where: { slug } });
    if (!root) return null;

    // Fetch all descendants using slug prefix
    const descendants = await prisma.vertical.findMany({
        where: {
            slug: { startsWith: `${slug}.` },
            status: 'ACTIVE',
        },
        orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
    });

    const all = [root, ...descendants];
    const map = new Map<string, VerticalNode>();

    for (const v of all) {
        map.set(v.id, {
            id: v.id,
            slug: v.slug,
            name: v.name,
            description: v.description,
            parentId: v.parentId,
            depth: v.depth,
            sortOrder: v.sortOrder,
            attributes: v.attributes,
            aliases: v.aliases,
            status: v.status,
            requiresTcpa: v.requiresTcpa,
            requiresKyc: v.requiresKyc,
            restrictedGeos: v.restrictedGeos,
            children: [],
        });
    }

    for (const node of map.values()) {
        if (node.parentId && map.has(node.parentId)) {
            map.get(node.parentId)!.children.push(node);
        }
    }

    const result = map.get(root.id) ?? null;
    if (result) verticalHierarchyCache.set(cacheKey, result);
    return result;
}

// ============================================
// Flat list (with filters)
// ============================================

export async function listFlat(filters: {
    status?: string;
    depth?: number;
    parentSlug?: string;
}): Promise<any[]> {
    const where: any = {};

    if (filters.status) where.status = filters.status;
    if (filters.depth !== undefined) where.depth = filters.depth;

    if (filters.parentSlug) {
        const parent = await prisma.vertical.findUnique({
            where: { slug: filters.parentSlug },
        });
        if (parent) {
            where.parentId = parent.id;
        } else {
            return []; // parent not found → no results
        }
    }

    return prisma.vertical.findMany({
        where,
        orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { children: true } } },
    });
}

// ============================================
// Resolve Slug (check aliases)
// ============================================

export async function resolveSlug(input: string): Promise<any | null> {
    // Try direct slug first
    const direct = await prisma.vertical.findUnique({ where: { slug: input } });
    if (direct) return direct;

    // Try aliases
    const aliased = await prisma.vertical.findFirst({
        where: { aliases: { has: input } },
    });
    return aliased ?? null;
}

// ============================================
// Compliance Flags (merged up ancestor chain)
// ============================================

export async function getComplianceFlags(slug: string): Promise<ComplianceFlags | null> {
    const cacheKey = `compliance:${slug}`;
    const cached = verticalHierarchyCache.get(cacheKey);
    if (cached) return cached;

    const vertical = await resolveSlug(slug);
    if (!vertical) return null;

    // Walk up the ancestor chain
    const chain: string[] = [];
    let requiresTcpa = false;
    let requiresKyc = false;
    const restrictedGeos = new Set<string>();

    let current = vertical;
    while (current) {
        chain.unshift(current.slug);
        if (current.requiresTcpa) requiresTcpa = true;
        if (current.requiresKyc) requiresKyc = true;
        for (const geo of current.restrictedGeos) {
            restrictedGeos.add(geo);
        }

        if (current.parentId) {
            current = await prisma.vertical.findUnique({
                where: { id: current.parentId },
            });
        } else {
            current = null;
        }
    }

    const result: ComplianceFlags = {
        requiresTcpa,
        requiresKyc,
        restrictedGeos: [...restrictedGeos],
        chain,
    };

    verticalHierarchyCache.set(cacheKey, result);
    return result;
}
