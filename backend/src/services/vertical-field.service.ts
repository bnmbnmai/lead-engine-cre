/**
 * VerticalField Sync Service
 *
 * Converts formConfig.fields[] → VerticalField rows.
 * Used by:
 *   1. Migration script (backfill existing verticals)
 *   2. PUT /:slug/form-config route (auto-sync on save)
 *
 * Design rules:
 *   - formConfig JSON is NEVER touched — it remains the source for form rendering
 *   - VerticalField is the queryable layer for search + autobid
 *   - PII fields (fullName, email, phone) are marked isPii=true, isFilterable=false, isBiddable=false
 *   - All non-PII SELECT/BOOLEAN/NUMBER fields default to isFilterable=true, isBiddable=true
 *   - TEXT/TEXTAREA fields default to isFilterable=true, isBiddable=false (free-text isn't auto-biddable)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Keys that contain PII — never exposed to buyers
const PII_KEYS = new Set(['fullName', 'email', 'phone']);

// Keys that are geo/identity rather than vertical-specific — filterable but not biddable
const GEO_KEYS = new Set(['zip', 'state', 'country']);

// FieldType enum values (matches schema.prisma FieldType enum)
type FieldTypeValue = 'TEXT' | 'SELECT' | 'BOOLEAN' | 'NUMBER' | 'TEXTAREA' | 'EMAIL' | 'PHONE';

/**
 * Map formConfig field.type string → Prisma FieldType enum value
 */
function mapFieldType(type: string): FieldTypeValue {
    const typeMap: Record<string, FieldTypeValue> = {
        text: 'TEXT',
        select: 'SELECT',
        boolean: 'BOOLEAN',
        number: 'NUMBER',
        textarea: 'TEXTAREA',
        email: 'EMAIL',
        phone: 'PHONE',
    };
    return typeMap[type] || 'TEXT';
}

/**
 * Determine the default filterability and biddability flags for a field.
 */
function getFieldFlags(key: string, type: string) {
    if (PII_KEYS.has(key)) {
        return { isPii: true, isFilterable: false, isBiddable: false };
    }
    if (GEO_KEYS.has(key)) {
        return { isPii: false, isFilterable: true, isBiddable: false };
    }
    // Vertical-specific fields: SELECT, BOOLEAN, NUMBER are great autobid candidates
    const biddableTypes = new Set(['select', 'boolean', 'number']);
    return {
        isPii: false,
        isFilterable: true,
        isBiddable: biddableTypes.has(type),
    };
}

export interface FormConfigField {
    id: string;
    key: string;
    label: string;
    type: string;
    required: boolean;
    placeholder?: string;
    options?: string[];
}

/**
 * Sync VerticalField rows for a vertical based on its formConfig fields.
 *
 * Strategy: delete-and-recreate within a transaction.
 * This is safe because:
 *   - BuyerFieldFilter has onDelete: Cascade from VerticalField
 *   - During migration, no BuyerFieldFilters exist yet
 *   - On subsequent saves, cascading is the correct behavior:
 *     if an admin removes a field from the form, buyer rules targeting it should also be removed
 *
 * @param verticalId  Prisma Vertical.id
 * @param fields      formConfig.fields array
 * @param tx          Optional Prisma transaction client (for use inside existing transactions)
 */
export async function syncVerticalFields(
    verticalId: string,
    fields: FormConfigField[],
    tx?: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>
) {
    const client = tx || prisma;

    // Delete existing fields (cascades to BuyerFieldFilter)
    await (client as any).verticalField.deleteMany({
        where: { verticalId },
    });

    // Create new fields
    if (fields.length === 0) return { synced: 0 };

    const data = fields.map((field, index) => {
        const flags = getFieldFlags(field.key, field.type);
        return {
            verticalId,
            key: field.key,
            label: field.label,
            fieldType: mapFieldType(field.type),
            required: field.required,
            options: field.options || [],
            placeholder: field.placeholder || null,
            sortOrder: index,
            ...flags,
        };
    });

    await (client as any).verticalField.createMany({ data });

    return { synced: fields.length };
}

/**
 * Sync within its own transaction (used by standalone callers like the migration script).
 */
export async function syncVerticalFieldsInTransaction(
    verticalId: string,
    fields: FormConfigField[]
) {
    return prisma.$transaction(async (tx) => {
        return syncVerticalFields(verticalId, fields, tx);
    });
}

// ============================================
// P2-13 — VerticalField Sync Validation
// ============================================

export interface SyncValidationResult {
    inSync: boolean;
    missingFields: string[];  // keys in formConfig but absent from VerticalField rows
    extraFields: string[];  // keys in VerticalField rows but absent from formConfig
    warnings: string[];  // informational notes (type mismatches, PII flag drift, etc.)
}

/**
 * Compare a vertical's formConfig.fields[] against its VerticalField rows.
 *
 * Detects:
 *  - Fields that exist in formConfig but have no corresponding VerticalField row (missing).
 *  - VerticalField rows whose key is absent from formConfig (extra / stale).
 *  - Type mismatches between the formConfig field type and the VerticalField.fieldType.
 *
 * Does NOT write to the database — purely a read-only comparison.
 *
 * @param verticalId  Prisma Vertical.id
 */
export async function validateVerticalFieldSync(
    verticalId: string
): Promise<SyncValidationResult> {
    // 1. Load the vertical to get its formConfig
    const vertical = await (prisma as any).vertical.findUnique({
        where: { id: verticalId },
        select: { id: true, formConfig: true },
    });

    if (!vertical) {
        return {
            inSync: false,
            missingFields: [],
            extraFields: [],
            warnings: [`Vertical '${verticalId}' not found`],
        };
    }

    // 2. Parse formConfig fields
    const formConfig = (vertical.formConfig as any) || {};
    const configFields: FormConfigField[] = Array.isArray(formConfig.fields)
        ? formConfig.fields
        : [];
    const configKeys = new Set(configFields.map((f) => f.key));

    // 3. Load existing VerticalField rows
    const dbFields: Array<{ key: string; fieldType: string }> = await (prisma as any).verticalField.findMany({
        where: { verticalId },
        select: { key: true, fieldType: true },
    });
    const dbKeyToType = new Map(dbFields.map((f) => [f.key, f.fieldType]));

    // 4. Compute diff
    const missingFields: string[] = [];
    const warnings: string[] = [];

    for (const field of configFields) {
        if (!dbKeyToType.has(field.key)) {
            missingFields.push(field.key);
        } else {
            // Type check: compare mapped type
            const expectedType = mapFieldType(field.type);
            const actualType = dbKeyToType.get(field.key);
            if (expectedType !== actualType) {
                warnings.push(
                    `Field '${field.key}': formConfig type '${field.type}' → expected '${expectedType}', DB has '${actualType}'`
                );
            }
        }
    }

    const extraFields: string[] = [];
    for (const [dbKey] of dbKeyToType) {
        if (!configKeys.has(dbKey)) {
            extraFields.push(dbKey);
        }
    }

    const inSync = missingFields.length === 0 && extraFields.length === 0 && warnings.length === 0;

    return { inSync, missingFields, extraFields, warnings };
}
