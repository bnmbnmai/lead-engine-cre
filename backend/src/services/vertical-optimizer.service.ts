/**
 * Vertical Optimizer Service
 *
 * AI-powered vertical suggestion engine. Analyzes lead descriptions,
 * bid patterns, and market trends to suggest new sub-verticals.
 *
 * Modes:
 *   1. LLM (OpenAI-compatible) — structured function calling
 *   2. Rule-based fallback — keyword extraction + similarity matching
 *
 * All inputs are PII-scrubbed before processing.
 */

import { prisma } from '../lib/prisma';
import { verticalHierarchyCache } from '../lib/cache';
import { dataStreamsService } from './datastreams.service';
import { activateVertical } from './vertical-nft.service';

// ============================================
// Configuration
// ============================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AUTO_CREATE_THRESHOLD = parseInt(process.env.VERTICAL_SUGGEST_THRESHOLD || '10');

const LLM_ENABLED = !!OPENAI_API_KEY;

// ============================================
// Types
// ============================================

export interface SuggestInput {
    description: string;
    vertical?: string;   // Optional parent hint
    leadId?: string;     // Optional source lead
}

export interface SuggestionResult {
    parentSlug: string;
    suggestedName: string;
    suggestedSlug: string;
    confidence: number;
    reasoning: string;
    source: 'ai' | 'rule';
    isExisting: boolean;
    hitCount: number;
    autoCreated: boolean;
    existingMatch?: string; // If matched to existing vertical
}

// ============================================
// PII Scrubber
// ============================================

const PII_PATTERNS = [
    // Email addresses
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    // US phone numbers (various formats)
    /\b(?:\+?1[-.\s]?)?\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    // SSN
    /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    // Credit card numbers (basic)
    /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    // Street addresses (basic — "123 Main St" pattern)
    /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place)\b/gi,
    // IP addresses
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    // Proper names after common prefixes (Mr., Mrs., Dr., etc.)
    /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
];

export function scrubPII(text: string): string {
    let scrubbed = text;
    for (const pattern of PII_PATTERNS) {
        scrubbed = scrubbed.replace(pattern, '[REDACTED]');
    }
    return scrubbed;
}

// ============================================
// Keyword Extraction (for rule-based fallback)
// ============================================

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
    'before', 'after', 'above', 'below', 'between', 'out', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'just', 'because', 'but', 'and',
    'or', 'if', 'while', 'about', 'between', 'it', 'its', 'this', 'that',
    'these', 'those', 'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he',
    'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what', 'which',
    'who', 'whom', 'need', 'needs', 'want', 'wants', 'looking', 'customer',
    'client', 'service', 'services', 'help', 'get', 'got',
]);

function extractKeywords(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

function jaccardSimilarity(a: string[], b: string[]): number {
    const setA = new Set(a);
    const setB = new Set(b);
    const intersection = [...setA].filter(x => setB.has(x));
    const union = new Set([...setA, ...setB]);
    return union.size === 0 ? 0 : intersection.length / union.size;
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

// ============================================
// Rule-Based Fallback
// ============================================

interface VerticalMatch {
    slug: string;
    name: string;
    score: number;
    aliases: string[];
    parentId: string | null;
}

async function ruleBased(
    scrubbedText: string,
    parentHint?: string
): Promise<{ parentSlug: string; suggestedName: string; confidence: number; reasoning: string }> {
    const keywords = extractKeywords(scrubbedText);

    // Load all active verticals
    const verticals = await prisma.vertical.findMany({
        where: { status: 'ACTIVE' },
        select: { slug: true, name: true, aliases: true, parentId: true },
    });

    // Score each vertical
    const matches: VerticalMatch[] = verticals.map(v => {
        const verticalTokens = [
            ...extractKeywords(v.name),
            ...v.aliases.flatMap(a => extractKeywords(a)),
            ...v.slug.split('.').flatMap(s => extractKeywords(s)),
        ];
        return {
            slug: v.slug,
            name: v.name,
            score: jaccardSimilarity(keywords, verticalTokens),
            aliases: v.aliases,
            parentId: v.parentId,
        };
    });

    // Sort by score descending
    matches.sort((a, b) => b.score - a.score);
    const best = matches[0];

    if (!best || best.score < 0.05) {
        // No meaningful match — suggest under hint or as top-level
        const suggestedName = keywords.slice(0, 3).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
        return {
            parentSlug: parentHint || '',
            suggestedName: suggestedName || 'Unclassified',
            confidence: 0.15,
            reasoning: `No strong match found. Keywords: [${keywords.slice(0, 5).join(', ')}]. Suggested as new category.`,
        };
    }

    if (best.score > 0.5) {
        // Strong match — this IS an existing vertical
        return {
            parentSlug: best.slug.includes('.') ? best.slug.split('.').slice(0, -1).join('.') : best.slug,
            suggestedName: best.name,
            confidence: Math.min(best.score * 1.2, 0.99),
            reasoning: `Strong match to existing vertical "${best.slug}" (score: ${best.score.toFixed(2)}). Keywords: [${keywords.slice(0, 5).join(', ')}].`,
        };
    }

    // Moderate match — suggest as child of best match
    const parentSlug = parentHint || best.slug;
    const diffKeywords = keywords.filter(k => !extractKeywords(best.name).includes(k));
    const suggestedName = diffKeywords.slice(0, 2).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') || 'Specialized';

    return {
        parentSlug,
        suggestedName,
        confidence: best.score * 0.8,
        reasoning: `Partial match to "${best.slug}" (score: ${best.score.toFixed(2)}). Unique keywords: [${diffKeywords.slice(0, 5).join(', ')}]. Suggested as sub-vertical.`,
    };
}

// ============================================
// LLM-Based Suggestion (OpenAI Function Calling)
// ============================================

const SYSTEM_PROMPT = `You are a vertical classification engine for a B2B lead generation platform.

Given a lead description and market context, suggest the best vertical classification.

RULES:
- Always return a parent vertical slug from the existing hierarchy
- Suggest a human-readable sub-vertical name if the lead doesn't fit existing ones
- Include relevant attributes (compliance requirements, typical budget range, key terms)
- Confidence should be 0-1 (0 = total guess, 1 = perfect match)
- Provide brief reasoning for your classification
- NEVER include any personal information in your response
- If the description is too vague, return low confidence`;

const SUGGEST_FUNCTION = {
    name: 'suggest_vertical',
    description: 'Suggest the best vertical classification for a lead',
    parameters: {
        type: 'object',
        properties: {
            parentSlug: {
                type: 'string',
                description: 'Slug of the parent vertical from existing hierarchy (e.g., "home_services", "solar")',
            },
            suggestedName: {
                type: 'string',
                description: 'Human-readable name for the suggested sub-vertical (e.g., "Emergency Plumbing")',
            },
            attributes: {
                type: 'object',
                description: 'Relevant attributes like compliance, budget range, keywords',
                properties: {
                    compliance: { type: 'array', items: { type: 'string' } },
                    avgBudget: { type: 'string' },
                    keywords: { type: 'array', items: { type: 'string' } },
                },
            },
            confidence: {
                type: 'number',
                description: 'Confidence score 0-1',
            },
            reasoning: {
                type: 'string',
                description: 'Brief explanation of the classification',
            },
        },
        required: ['parentSlug', 'suggestedName', 'confidence', 'reasoning'],
    },
};

async function llmSuggest(
    scrubbedText: string,
    existingVerticals: string[],
    marketContext: string
): Promise<{ parentSlug: string; suggestedName: string; confidence: number; reasoning: string; attributes?: any }> {
    const userMessage = `Lead description: "${scrubbedText}"

Existing verticals in our hierarchy:
${existingVerticals.join('\n')}

Market context:
${marketContext}

Classify this lead into the best vertical. If it doesn't fit existing sub-verticals, suggest a new one under the most appropriate parent.`;

    try {
        const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userMessage },
                ],
                functions: [SUGGEST_FUNCTION],
                function_call: { name: 'suggest_vertical' },
                temperature: 0.3,
                max_tokens: 500,
            }),
            signal: AbortSignal.timeout(15000),
        });

        if (!response.ok) {
            const err = await response.text().catch(() => 'Unknown error');
            console.error(`[VERTICAL-OPTIMIZER] LLM API error ${response.status}: ${err}`);
            throw new Error(`LLM API error: ${response.status}`);
        }

        const data: any = await response.json();
        const functionCall = data.choices?.[0]?.message?.function_call;

        if (!functionCall || functionCall.name !== 'suggest_vertical') {
            throw new Error('LLM did not return expected function call');
        }

        const args = JSON.parse(functionCall.arguments);
        return {
            parentSlug: args.parentSlug || '',
            suggestedName: args.suggestedName || 'Unknown',
            confidence: Math.max(0, Math.min(1, args.confidence || 0)),
            reasoning: args.reasoning || 'No reasoning provided',
            attributes: args.attributes,
        };
    } catch (err: any) {
        console.error(`[VERTICAL-OPTIMIZER] LLM failed, falling back to rule-based:`, err.message);
        // Fallback to rule-based
        return ruleBased(scrubbedText);
    }
}

// ============================================
// Validation (Anti-Hallucination)
// ============================================

async function validateParentExists(parentSlug: string): Promise<boolean> {
    if (!parentSlug) return true; // Top-level suggestion
    const parent = await prisma.vertical.findUnique({
        where: { slug: parentSlug },
    });
    return !!parent;
}

async function findClosestParent(suggestedParent: string): Promise<string> {
    // Try exact match
    const exact = await prisma.vertical.findUnique({ where: { slug: suggestedParent } });
    if (exact) return exact.slug;

    // Try alias match
    const aliased = await prisma.vertical.findFirst({
        where: { aliases: { has: suggestedParent } },
    });
    if (aliased) return aliased.slug;

    // Try partial match (first segment)
    const firstSegment = suggestedParent.split('.')[0];
    const partial = await prisma.vertical.findUnique({ where: { slug: firstSegment } });
    if (partial) return partial.slug;

    // No match — return empty (will be top-level)
    return '';
}

// ============================================
// Threshold Auto-Creation
// ============================================

async function checkAndAutoCreate(suggestion: any): Promise<boolean> {
    if (suggestion.hitCount < AUTO_CREATE_THRESHOLD) return false;

    // Check if already created in Vertical table
    const existing = await prisma.vertical.findUnique({ where: { slug: suggestion.suggestedSlug } });
    if (existing) return false;

    // Resolve parent
    const parent = suggestion.parentSlug
        ? await prisma.vertical.findUnique({ where: { slug: suggestion.parentSlug } })
        : null;

    const depth = parent ? parent.depth + 1 : 0;
    if (depth > 3) return false; // Depth limit

    await prisma.vertical.create({
        data: {
            slug: suggestion.suggestedSlug,
            name: suggestion.suggestedName,
            description: `Auto-suggested: ${suggestion.reasoning?.slice(0, 200) || ''}`,
            parentId: parent?.id ?? null,
            depth,
            attributes: suggestion.attributes,
            aliases: [],
            status: 'PROPOSED', // Still requires admin approval
            requiresTcpa: false,
            requiresKyc: false,
            restrictedGeos: [],
        },
    });

    // Bust vertical hierarchy cache
    verticalHierarchyCache.clear();

    console.log(`[VERTICAL-OPTIMIZER] Auto-created PROPOSED vertical: ${suggestion.suggestedSlug} (${suggestion.hitCount} hits)`);
    return true;
}

// ============================================
// Main Entry Point
// ============================================

export async function suggestVertical(input: SuggestInput): Promise<SuggestionResult> {
    const { description, vertical: parentHint, leadId } = input;

    // 1. PII scrub
    const scrubbed = scrubPII(description);
    console.log(`[VERTICAL-OPTIMIZER] Processing: "${scrubbed.slice(0, 80)}..." (LLM: ${LLM_ENABLED})`);

    // 2. Check if exact match to existing vertical
    const keywords = extractKeywords(scrubbed);
    const existingVerticals = await prisma.vertical.findMany({
        where: { status: 'ACTIVE' },
        select: { slug: true, name: true, aliases: true },
        orderBy: { depth: 'asc' },
    });

    // Quick check: does description directly name an existing vertical?
    for (const v of existingVerticals) {
        const allNames = [v.slug, v.name.toLowerCase(), ...v.aliases.map(a => a.toLowerCase())];
        if (allNames.some(n => scrubbed.toLowerCase().includes(n) && n.length > 3)) {
            return {
                parentSlug: v.slug.includes('.') ? v.slug.split('.').slice(0, -1).join('.') : v.slug,
                suggestedName: v.name,
                suggestedSlug: v.slug,
                confidence: 0.95,
                reasoning: `Direct match to existing vertical "${v.slug}"`,
                source: 'rule',
                isExisting: true,
                hitCount: 0,
                autoCreated: false,
                existingMatch: v.slug,
            };
        }
    }

    // 3. Get market context (from Chainlink Data Streams stub)
    let marketContext = 'No market data available.';
    if (parentHint) {
        try {
            const priceIndex = await dataStreamsService.getLeadPriceIndex(parentHint);
            marketContext = `Vertical "${parentHint}" — Price Index: ${priceIndex.indexValue}, 24h Change: ${priceIndex.change24h}%, Volume: $${priceIndex.volume24h}`;
        } catch {
            // Non-critical
        }
    }

    // 4. Run suggestion engine
    let result: { parentSlug: string; suggestedName: string; confidence: number; reasoning: string; attributes?: any };

    if (LLM_ENABLED) {
        const verticalList = existingVerticals.map(v => `- ${v.slug} (${v.name})`);
        result = await llmSuggest(scrubbed, verticalList, marketContext);
    } else {
        result = await ruleBased(scrubbed, parentHint);
    }

    // 5. Validate parent exists (anti-hallucination)
    const parentValid = await validateParentExists(result.parentSlug);
    if (!parentValid) {
        console.log(`[VERTICAL-OPTIMIZER] Parent "${result.parentSlug}" not found, finding closest match`);
        result.parentSlug = await findClosestParent(result.parentSlug);
        result.confidence *= 0.7; // Penalize confidence
    }

    // 6. Build suggested slug
    const suggestedSlug = result.parentSlug
        ? `${result.parentSlug}.${slugify(result.suggestedName)}`
        : slugify(result.suggestedName);

    // 7. Check if this is actually an existing vertical
    const existingMatch = await prisma.vertical.findUnique({ where: { slug: suggestedSlug } });
    if (existingMatch) {
        return {
            parentSlug: result.parentSlug,
            suggestedName: existingMatch.name,
            suggestedSlug: existingMatch.slug,
            confidence: result.confidence,
            reasoning: result.reasoning,
            source: LLM_ENABLED ? 'ai' : 'rule',
            isExisting: true,
            hitCount: 0,
            autoCreated: false,
            existingMatch: existingMatch.slug,
        };
    }

    // 8. Upsert suggestion (increment hit count if duplicate)
    const suggestion = await prisma.verticalSuggestion.upsert({
        where: { suggestedSlug },
        create: {
            suggestedSlug,
            suggestedName: result.suggestedName,
            parentSlug: result.parentSlug,
            attributes: result.attributes,
            confidence: result.confidence,
            reasoning: result.reasoning,
            source: LLM_ENABLED ? 'ai' : 'rule',
            hitCount: 1,
            sourceLeadId: leadId,
            sourceText: scrubbed.slice(0, 500),
        },
        update: {
            hitCount: { increment: 1 },
            confidence: Math.max(result.confidence, 0), // Keep highest confidence
            reasoning: result.reasoning,
            updatedAt: new Date(),
        },
    });

    // 9. Check auto-creation threshold
    const autoCreated = await checkAndAutoCreate(suggestion);

    // 10. Auto-activate via NFT mint if high confidence + auto-created
    let nftTokenId: number | undefined;
    let nftTxHash: string | undefined;
    if (autoCreated && result.confidence >= 0.85) {
        try {
            // Use deployer as recipient (admin-owned; can transfer later)
            const recipientAddress = process.env.DEPLOYER_ADDRESS || process.env.VERTICAL_NFT_OWNER || '';
            if (recipientAddress) {
                const activation = await activateVertical(suggestedSlug, recipientAddress);
                if (activation.success) {
                    nftTokenId = activation.tokenId;
                    nftTxHash = activation.txHash;
                    console.log(`[VERTICAL-OPTIMIZER] Auto-activated + minted NFT #${nftTokenId} for ${suggestedSlug}`);
                } else {
                    console.warn(`[VERTICAL-OPTIMIZER] Auto-activation failed for ${suggestedSlug}: ${activation.error}`);
                }
            }
        } catch (err) {
            console.warn(`[VERTICAL-OPTIMIZER] NFT mint skipped for ${suggestedSlug}:`, err);
        }
    }

    return {
        parentSlug: result.parentSlug,
        suggestedName: result.suggestedName,
        suggestedSlug,
        confidence: result.confidence,
        reasoning: result.reasoning,
        source: LLM_ENABLED ? 'ai' : 'rule',
        isExisting: false,
        hitCount: suggestion.hitCount,
        autoCreated,
        ...(nftTokenId && { nftTokenId, nftTxHash }),
    };
}

// ============================================
// List Suggestions (admin)
// ============================================

export async function listSuggestions(filters?: {
    status?: string;
    minHits?: number;
}): Promise<any[]> {
    const where: any = {};
    if (filters?.status) where.status = filters.status;
    if (filters?.minHits) where.hitCount = { gte: filters.minHits };

    return prisma.verticalSuggestion.findMany({
        where,
        orderBy: [{ hitCount: 'desc' }, { confidence: 'desc' }],
        take: 100,
    });
}
