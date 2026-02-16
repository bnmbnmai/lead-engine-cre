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
