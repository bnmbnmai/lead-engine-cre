/**
 * Strategy Advisor (Phase C1 — LLM in ADVISORY role only)
 * --------------------------------------------------------
 * The LLM's role in the strategy engine is strictly limited to:
 *   1. draftStrategyFromText  — natural language → StrategySpec document
 *   2. explainStrategy        — StrategySpec → plain-English explanation
 *
 * The LLM NEVER executes strategies and NEVER places bids. Every draft is
 * validated against the zod schema before it is shown to the user, and a
 * strategy only spends money after the user saves + activates it — at which
 * point the deterministic executor (executor.ts) is the only thing running.
 */

import { parseStrategySpec, type StrategySpec } from '@lead-engine/rules-engine';

const KIMI_API_KEY = process.env.KIMI_API_KEY || '';
const KIMI_BASE_URL = 'https://api.kimi.com/coding';

const DRAFT_SYSTEM_PROMPT = `You convert a buyer's natural-language description of a lead-buying strategy into a StrategySpec JSON document for the Lead Engine CRE marketplace.

Output ONLY a JSON object (no markdown fences, no commentary) with this exact shape:
{
  "version": 1,
  "name": "<short strategy name>",
  "description": "<one-sentence summary>",
  "gates": {
    "vertical": "<vertical slug like solar, mortgage, roofing — or * for all>",
    "geoCountries": ["US"],
    "geoInclude": ["<2-letter state codes to include, empty array for all>"],
    "geoExclude": [],
    "minQualityScore": <0-100 number or null>,
    "acceptOffSite": true,
    "requireVerified": false,
    "fieldFilters": []
  },
  "bidCurve": <one of:
    {"type":"fixed","base":<usdc>} |
    {"type":"linear","base":<usdc>,"slopePerQualityPoint":<usdc per quality point>,"min":<usdc>,"max":<usdc>} |
    {"type":"floorPlus","floorMultiplier":<e.g. 1.1>,"min":<usdc>,"max":<usdc>}>,
  "budget": {
    "maxBidPerLead": <usdc>,
    "dailyBudget": <usdc or null>,
    "totalBudget": <usdc or null>,
    "maxConcurrentBids": <int or null>
  }
}

Rules:
- Be conservative with budgets when the user is vague: maxBidPerLead defaults to 50, dailyBudget to 500.
- Quality scores in user language ("score above 80") are on the 0-100 scale.
- If the user names states, put their 2-letter codes in geoInclude.
- Never invent fieldFilters unless the user mentions specific lead fields.`;

async function callKimiText(system: string, userMessage: string): Promise<string> {
    if (!KIMI_API_KEY) {
        throw new Error('KIMI_API_KEY not configured — LLM advisory features unavailable');
    }
    const response = await fetch(`${KIMI_BASE_URL}/v1/messages`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': KIMI_API_KEY,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'kimi-k2.5',
            max_tokens: 2048,
            system,
            messages: [{ role: 'user', content: userMessage }],
            temperature: 0.1,
        }),
        signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
        throw new Error(`Kimi API error ${response.status}: ${await response.text()}`);
    }
    const data: any = await response.json();
    const textBlocks = (data.content || []).filter((b: any) => b.type === 'text');
    return textBlocks.map((b: any) => b.text).join('\n').trim();
}

/** Strip accidental markdown fences from an LLM JSON response. */
function extractJson(text: string): string {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    return (fenced ? fenced[1] : text).trim();
}

export interface DraftResult {
    spec: StrategySpec;
    /** Raw LLM output retained for transparency/debugging. */
    raw: string;
}

/**
 * Draft a StrategySpec from natural language. Validates against the zod
 * schema; retries once with the validation error fed back to the model.
 */
export async function draftStrategyFromText(description: string): Promise<DraftResult> {
    const first = await callKimiText(DRAFT_SYSTEM_PROMPT, description);
    try {
        return { spec: parseStrategySpec(JSON.parse(extractJson(first))), raw: first };
    } catch (firstErr: any) {
        // One corrective round-trip: show the model its own output + the error.
        const retry = await callKimiText(
            DRAFT_SYSTEM_PROMPT,
            `${description}\n\nYour previous output:\n${first}\n\nIt failed validation with: ${firstErr.message}\nReturn the corrected JSON only.`,
        );
        return { spec: parseStrategySpec(JSON.parse(extractJson(retry))), raw: retry };
    }
}

/**
 * Explain a StrategySpec in plain English (post-hoc transparency for the
 * strategy author or a marketplace browser).
 */
export async function explainStrategy(spec: StrategySpec): Promise<string> {
    return callKimiText(
        'You explain Lead Engine CRE StrategySpec documents in plain English for lead buyers. Be concise: 3-6 bullet points covering what it targets, how it bids, and its spending limits. No JSON, no headers.',
        JSON.stringify(spec, null, 2),
    );
}
