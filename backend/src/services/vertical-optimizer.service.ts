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
import { dataStreamsService } from './data-feeds.service';
import { activateVertical } from './vertical-nft.service';
import { PII_AUDIT_ENABLED } from '../config/perks.env';

// ============================================
// Configuration
// ============================================

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const AUTO_CREATE_THRESHOLD = parseInt(process.env.VERTICAL_SUGGEST_THRESHOLD || '20');
const AUTO_CREATE_MIN_UNIQUE_USERS = 5; // Anti-spam: require at least 5 distinct users
const JACCARD_DEDUP_THRESHOLD = 0.4; // Suggestion similarity threshold for dedup

// ============================================
// Trademark Blocklist (~200 major brands)
// ============================================

export const TRADEMARK_BLOCKLIST: ReadonlySet<string> = new Set([
    // Tech
    'apple', 'google', 'microsoft', 'amazon', 'meta', 'facebook', 'netflix', 'tesla',
    'nvidia', 'intel', 'amd', 'qualcomm', 'cisco', 'oracle', 'ibm', 'samsung', 'sony',
    'lg', 'huawei', 'xiaomi', 'oppo', 'vivo', 'oneplus', 'lenovo', 'dell', 'hp',
    'adobe', 'salesforce', 'shopify', 'stripe', 'paypal', 'square', 'coinbase',
    'robinhood', 'binance', 'opensea', 'discord', 'slack', 'zoom', 'twitch',
    'spotify', 'tiktok', 'snapchat', 'twitter', 'pinterest', 'linkedin', 'reddit',
    'uber', 'lyft', 'airbnb', 'doordash', 'instacart', 'grubhub',
    // Automotive
    'toyota', 'honda', 'ford', 'chevrolet', 'bmw', 'mercedes', 'audi', 'volkswagen',
    'porsche', 'ferrari', 'lamborghini', 'maserati', 'bentley', 'rolls-royce',
    'hyundai', 'kia', 'nissan', 'mazda', 'subaru', 'lexus', 'acura', 'infiniti',
    'jeep', 'dodge', 'ram', 'chrysler', 'buick', 'cadillac', 'gmc', 'rivian', 'lucid',
    // Energy & Solar
    'sunrun', 'sunpower', 'vivint', 'enphase', 'solaredge', 'generac', 'siemens',
    'schneider', 'abb', 'ge', 'general electric', 'shell', 'bp', 'exxon', 'chevron',
    'totalenergies', 'enel', 'nextera',
    // Real Estate / CRE
    'zillow', 'redfin', 'realtor', 'compass', 'keller williams', 'coldwell banker',
    'century 21', 're/max', 'sothebys', 'cbre', 'jll', 'cushman', 'colliers',
    'marcus millichap', 'newmark', 'savills', 'berkshire hathaway',
    // Finance / Insurance
    'jpmorgan', 'goldman sachs', 'morgan stanley', 'wells fargo', 'bank of america',
    'citibank', 'hsbc', 'barclays', 'ubs', 'credit suisse', 'deutsche bank',
    'state farm', 'allstate', 'geico', 'progressive', 'liberty mutual', 'usaa',
    'nationwide', 'farmers', 'aetna', 'cigna', 'unitedhealth', 'anthem', 'humana',
    'quicken loans', 'rocket mortgage', 'loanDepot', 'better', 'sofi',
    // Retail / Consumer
    'walmart', 'target', 'costco', 'home depot', 'lowes', 'ikea', 'wayfair',
    'nike', 'adidas', 'puma', 'reebok', 'under armour', 'lululemon', 'patagonia',
    'coca-cola', 'pepsi', 'nestle', 'unilever', 'procter gamble',
    'mcdonalds', 'starbucks', 'chipotle', 'subway', 'dominos', 'pizza hut',
    // Telecom
    'verizon', 'at&t', 'tmobile', 't-mobile', 'sprint', 'comcast', 'xfinity',
    'spectrum', 'cox', 'centurylink', 'frontier', 'dish', 'directv',
    // Home Services
    'angi', 'angis list', 'thumbtack', 'taskrabbit', 'handy', 'porch',
    'servpro', 'servicemaster', 'terminix', 'orkin', 'roto-rooter',
    'stanley steemer', 'mr rooter', 'ace hardware',
    // Cloud / SaaS
    'aws', 'azure', 'gcp', 'cloudflare', 'datadog', 'splunk', 'snowflake',
    'databricks', 'confluent', 'hashicorp', 'elastic', 'mongodb', 'redis',
    // Crypto / Web3
    'ethereum', 'bitcoin', 'solana', 'polygon', 'avalanche', 'chainlink',
    'uniswap', 'aave', 'compound', 'makerdao', 'lido', 'metamask',
]);

// ============================================
// Jaccard Similarity (suggestion dedup)
// ============================================

/**
 * Compute Jaccard similarity between two strings using word-level bigrams.
 * Returns 0.0 (no overlap) to 1.0 (identical).
 */
export function jaccardSimilarity(a: string, b: string): number {
    const bigramsOf = (s: string): Set<string> => {
        const words = s.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
        const grams = new Set<string>();
        for (let i = 0; i < words.length - 1; i++) {
            grams.add(`${words[i]} ${words[i + 1]}`);
        }
        // Also add unigrams for short strings
        words.forEach(w => grams.add(w));
        return grams;
    };

    const setA = bigramsOf(a);
    const setB = bigramsOf(b);
    if (setA.size === 0 && setB.size === 0) return 1.0;
    if (setA.size === 0 || setB.size === 0) return 0.0;

    let intersection = 0;
    for (const gram of setA) {
        if (setB.has(gram)) intersection++;
    }
    return intersection / (setA.size + setB.size - intersection);
}

/**
 * Check if a suggested slug is too similar to any existing suggestion.
 */
export function isDuplicateSuggestion(slug: string, existingSlugs: string[]): boolean {
    return existingSlugs.some(existing => jaccardSimilarity(slug, existing) > JACCARD_DEDUP_THRESHOLD);
}

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
    // International phone numbers (+CC followed by 7-12 digits)
    /\+\d{1,3}[-.\s]?\d{7,12}\b/g,
    // SSN
    /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    // Credit card numbers (basic)
    /\b(?:\d{4}[-.\s]?){3}\d{4}\b/g,
    // Street addresses (basic — "123 Main St" pattern)
    /\b\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place)\b/gi,
    // IP addresses
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    // Proper names after common Latin prefixes (Mr., Mrs., Dr., etc.)
    /\b(?:Mr|Mrs|Ms|Dr|Prof)\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
    // CJK names: 2–4 character sequences (Chinese/Japanese/Korean family+given)
    /[\u4E00-\u9FFF\u3400-\u4DBF]{2,4}/g,
    // Japanese honorifics + name: 〜さん, 〜様, 〜先生, etc.
    /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]{1,6}(?:さん|様|先生|殿|氏)/g,
    // Korean names: 2–4 Hangul syllable blocks (common name length)
    /[\uAC00-\uD7AF]{2,4}/g,
    // Devanagari names: 2–6 character sequences (Hindi, Sanskrit names)
    /[\u0900-\u097F]{2,6}/g,
    // Arabic names: 2–8 character sequences
    /[\u0600-\u06FF]{2,8}/g,
    // Thai names: 2–8 character sequences
    /[\u0E00-\u0E7F]{2,8}/g,
    // Cyrillic names: 2–8 character sequences (Russian, Ukrainian, etc.)
    /[\u0400-\u04FF]{2,8}/g,
    // Armenian names: 2–6 character sequences
    /[\u0530-\u058F]{2,6}/g,
    // Georgian names: 2–6 character sequences
    /[\u10A0-\u10FF]{2,6}/g,
    // Unicode title prefixes: Herr, Frau, Señor/a, San/ta, 先生, etc.
    /\b(?:Herr|Frau|Señor|Señora|Monsieur|Madame|San|Santa)\.?\s+\p{L}+(?:\s+\p{L}+)?/gu,
    // IBAN numbers (international bank account)
    /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/g,
    // EU VAT IDs (country prefix + 5-12 digits/letters)
    /\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK)[A-Z0-9]{5,12}\b/g,
    // UK National Insurance numbers
    /\b[A-CEGHJ-PR-TW-Z]{2}\d{6}[A-D]\b/g,
];

// Script detection patterns for cross-border compliance
const SCRIPT_DETECTORS: [string, RegExp][] = [
    ['latin', /[A-Za-z]{3,}/],
    ['cjk', /[\u4E00-\u9FFF\u3400-\u4DBF]/],
    ['hangul', /[\uAC00-\uD7AF]/],
    ['devanagari', /[\u0900-\u097F]/],
    ['arabic', /[\u0600-\u06FF]/],
    ['thai', /[\u0E00-\u0E7F]/],
    ['cyrillic', /[\u0400-\u04FF]/],
    ['armenian', /[\u0530-\u058F]/],
    ['georgian', /[\u10A0-\u10FF]/],
];

// Geo → compliance framework mapping
const GEO_COMPLIANCE_FLAGS: Record<string, string[]> = {
    'DE': ['EU_GDPR'], 'FR': ['EU_GDPR'], 'IT': ['EU_GDPR'], 'ES': ['EU_GDPR'],
    'NL': ['EU_GDPR'], 'BE': ['EU_GDPR'], 'AT': ['EU_GDPR'], 'PL': ['EU_GDPR'],
    'SE': ['EU_GDPR'], 'FI': ['EU_GDPR'], 'DK': ['EU_GDPR'], 'IE': ['EU_GDPR'],
    'PT': ['EU_GDPR'], 'GR': ['EU_GDPR'], 'CZ': ['EU_GDPR'], 'RO': ['EU_GDPR'],
    'HU': ['EU_GDPR'], 'BG': ['EU_GDPR'], 'HR': ['EU_GDPR'], 'SK': ['EU_GDPR'],
    'SI': ['EU_GDPR'], 'LT': ['EU_GDPR'], 'LV': ['EU_GDPR'], 'EE': ['EU_GDPR'],
    'CY': ['EU_GDPR'], 'LU': ['EU_GDPR'], 'MT': ['EU_GDPR'],
    'GB': ['UK_GDPR'],
    'US': ['CCPA'], 'CA': ['PIPEDA'], 'BR': ['LGPD'],
    'JP': ['APPI'], 'KR': ['PIPA'], 'IN': ['DPDP'],
    'AU': ['APPs'],
};

export interface ScrubResult {
    text: string;
    detectedScripts: string[];
    crossBorderFlags: string[];
}

export function scrubPII(text: string): string {
    let scrubbed = text;
    for (const pattern of PII_PATTERNS) {
        scrubbed = scrubbed.replace(pattern, '[REDACTED]');
    }
    return scrubbed;
}

/**
 * Enhanced PII scrubber returning cross-border metadata.
 * Detects scripts present in text and maps to compliance frameworks.
 */
export function scrubPIIWithMetadata(text: string, geoHint?: string): ScrubResult {
    const scrubbed = scrubPII(text);

    // Detect scripts present in original text
    const detectedScripts: string[] = [];
    for (const [script, pattern] of SCRIPT_DETECTORS) {
        if (pattern.test(text)) detectedScripts.push(script);
    }

    // Determine compliance flags from geo hint
    const crossBorderFlags: string[] = [];
    if (geoHint) {
        const flags = GEO_COMPLIANCE_FLAGS[geoHint.toUpperCase()];
        if (flags) crossBorderFlags.push(...flags);
    }

    // Infer additional flags from detected scripts
    if (detectedScripts.includes('cyrillic')) crossBorderFlags.push('RU_PD_LAW');
    if (detectedScripts.includes('hangul') && !crossBorderFlags.includes('PIPA')) crossBorderFlags.push('PIPA');
    if (detectedScripts.includes('cjk') && !crossBorderFlags.includes('APPI')) crossBorderFlags.push('PIPL');

    return { text: scrubbed, detectedScripts, crossBorderFlags: [...new Set(crossBorderFlags)] };
}

/**
 * PII scrubber with GDPR Article 30 audit logging.
 * Wraps scrubPIIWithMetadata and logs a structured JSON record
 * of each scrub operation for compliance auditing.
 */
export function scrubPIIWithAuditLog(
    text: string,
    geoHint?: string,
    context?: { leadId?: string; source?: string },
): ScrubResult {
    const result = scrubPIIWithMetadata(text, geoHint);

    // Count redactions by comparing original vs scrubbed
    const redactionCount = (result.text.match(/\[REDACTED\]/g) || []).length;

    if (PII_AUDIT_ENABLED && redactionCount > 0) {
        console.log(JSON.stringify({
            event: 'PII_SCRUB_AUDIT',
            timestamp: new Date().toISOString(),
            redactionCount,
            detectedScripts: result.detectedScripts,
            crossBorderFlags: result.crossBorderFlags,
            inputLength: text.length,
            outputLength: result.text.length,
            leadId: context?.leadId || 'unknown',
            source: context?.source || 'vertical-optimizer',
        }));
    }

    return result;
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

function tokenJaccard(a: string[], b: string[]): number {
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
            score: tokenJaccard(keywords, verticalTokens),
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

    // Anti-spam: require suggestions from at least N distinct users
    const uniqueUserCount = await prisma.verticalSuggestion.groupBy({
        by: ['sourceLeadId'],
        where: { suggestedSlug: suggestion.suggestedSlug },
    });
    if (uniqueUserCount.length < AUTO_CREATE_MIN_UNIQUE_USERS) {
        console.log(`[VERTICAL-OPTIMIZER] Skipping auto-create for "${suggestion.suggestedSlug}" — only ${uniqueUserCount.length}/${AUTO_CREATE_MIN_UNIQUE_USERS} unique sources`);
        return false;
    }

    // Trademark blocklist check — prevent auto-creating branded verticals
    const slugLower = suggestion.suggestedSlug.toLowerCase().replace(/[_-]/g, ' ');
    if (TRADEMARK_BLOCKLIST.has(slugLower) ||
        [...TRADEMARK_BLOCKLIST].some(brand => slugLower.includes(brand) || brand.includes(slugLower))) {
        console.log(`[VERTICAL-OPTIMIZER] Blocked auto-create for "${suggestion.suggestedSlug}" — matches trademark blocklist`);
        return false;
    }

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

    // 1. PII scrub (with audit logging for GDPR Article 30)
    const scrubResult = scrubPIIWithAuditLog(description, undefined, { leadId, source: 'vertical-optimizer' });
    const scrubbed = scrubResult.text;
    console.log(`[VERTICAL-OPTIMIZER] Processing: "${scrubbed.slice(0, 80)}..." (LLM: ${LLM_ENABLED})`);

    // 2. Check if exact match to existing vertical
    const _keywords = extractKeywords(scrubbed);
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

    // 3. Get market context (from Chainlink Data Feeds)
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
            const activation = await activateVertical(suggestedSlug);
            if (activation.success) {
                nftTokenId = activation.tokenId;
                nftTxHash = activation.txHash;
                console.log(`[VERTICAL-OPTIMIZER] Auto-activated + minted NFT #${nftTokenId} for ${suggestedSlug}`);
            } else {
                console.warn(`[VERTICAL-OPTIMIZER] Auto-activation failed for ${suggestedSlug}: ${activation.error}`);
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
