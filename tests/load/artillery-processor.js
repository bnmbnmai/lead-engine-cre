/**
 * Artillery Processor — Custom functions for RTB load testing
 *
 * Generates realistic lead payloads, bid commitments, and
 * random filtering parameters for load test scenarios.
 */

"use strict";

const crypto = require("crypto");

// ─── Geo Configs by Country ───────────────────
const GEO_DATA = {
    US: { states: ["CA", "TX", "FL", "NY", "IL"], zips: ["90210", "77001", "33101", "10001", "60601"], cities: ["LA", "Houston", "Miami", "NYC", "Chicago"] },
    CA: { states: ["ON", "BC", "QC", "AB", "NS"], zips: ["M5V", "V6B", "H2X", "T2P", "B3H"], cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Halifax"] },
    GB: { states: ["ENG", "SCT", "WLS", "NIR"], zips: ["EC1A", "SW1A", "EH1", "CF10"], cities: ["London", "Edinburgh", "Cardiff", "Belfast"] },
    AU: { states: ["NSW", "VIC", "QLD", "WA", "SA"], zips: ["2000", "3000", "4000", "6000", "5000"], cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide"] },
    DE: { states: ["BE", "BY", "HH", "NW", "SN"], zips: ["10115", "80331", "20095", "40210", "01067"], cities: ["Berlin", "Munich", "Hamburg", "Dusseldorf", "Dresden"] },
    BR: { states: ["SP", "RJ", "MG", "BA", "RS"], zips: ["01000-000", "20000-000", "30000-000", "40000-000", "90000-000"], cities: ["São Paulo", "Rio", "BH", "Salvador", "Porto Alegre"] },
    MX: { states: ["CDMX", "JAL", "NL", "YUC", "QRO"], zips: ["06000", "44100", "64000", "97000", "76000"], cities: ["CDMX", "Guadalajara", "Monterrey", "Merida", "Queretaro"] },
    ZA: { states: ["GP", "WC", "KZN", "EC", "FS"], zips: ["2000", "8000", "4000", "6000", "9300"], cities: ["Joburg", "Cape Town", "Durban", "PE", "Bloemfontein"] },
    NG: { states: ["LA", "AB", "KN", "RV", "FC"], zips: ["100001", "200001", "700001", "500001", "900001"], cities: ["Lagos", "Abeokuta", "Kano", "Port Harcourt", "Abuja"] },
    KE: { states: ["NBI", "MBA", "KSM", "NAK", "ELD"], zips: ["00100", "80100", "40100", "20100", "30100"], cities: ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret"] },
    // ─── LATAM additions ───
    AR: { states: ["BA", "CBA", "SF", "MZA", "TUC"], zips: ["C1000", "X5000", "S3000", "M5500", "T4000"], cities: ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "Tucumán"] },
    // ─── APAC additions ───
    JP: { states: ["TK", "OS", "KY", "HK", "AI"], zips: ["100-0001", "530-0001", "812-0011", "060-0001", "460-0001"], cities: ["Tokyo", "Osaka", "Fukuoka", "Sapporo", "Nagoya"] },
    KR: { states: ["SE", "BS", "IC", "DG", "DJ"], zips: ["04524", "48058", "21999", "41585", "34126"], cities: ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon"] },
    SG: { states: ["SG"], zips: ["018956", "238823", "049318", "609609", "179101"], cities: ["Singapore", "Orchard", "CBD", "Jurong", "Marina Bay"] },
    IN: { states: ["MH", "KA", "DL", "TN", "WB"], zips: ["400001", "560001", "110001", "600001", "700001"], cities: ["Mumbai", "Bangalore", "Delhi", "Chennai", "Kolkata"] },
};

const LATAM_COUNTRIES = ["BR", "MX", "AR"];
const APAC_COUNTRIES = ["JP", "KR", "SG", "IN", "AU"];

const VERTICALS = ["solar", "mortgage", "roofing", "insurance", "auto", "legal", "home_services", "real_estate", "b2b_saas", "financial"];

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Core Functions ───────────────────────────

/** Generate a realistic lead payload with matching geo data */
function generateLeadPayload(requestParams, context, ee, next) {
    const country = pick(Object.keys(GEO_DATA));
    const geo = GEO_DATA[country];
    const idx = Math.floor(Math.random() * geo.states.length);

    context.vars.country = country;
    context.vars.state = geo.states[idx];
    context.vars.zip = geo.zips[idx] || "00000";
    context.vars.city = geo.cities[idx] || "TestCity";
    context.vars.vertical = pick(VERTICALS);

    return next();
}

/** Generate a sealed bid commitment (keccak256-style hash) */
function generateBidCommitment(requestParams, context, ee, next) {
    const amount = (Math.floor(Math.random() * 450) + 50); // $50–$500
    const salt = crypto.randomBytes(32).toString("hex");
    const commitment = "0x" + crypto.createHash("sha256")
        .update(`${amount}:${salt}`)
        .digest("hex");

    context.vars.bidAmount = amount;
    context.vars.commitment = commitment;
    context.vars.salt = "0x" + salt;

    return next();
}

/** Pick a random vertical for filtered browsing */
function pickRandomVertical(requestParams, context, ee, next) {
    context.vars.vertical = pick(VERTICALS);
    return next();
}

/** Pick a random country for filtered browsing */
function pickRandomCountry(requestParams, context, ee, next) {
    context.vars.country = pick(Object.keys(GEO_DATA));
    return next();
}

/** Validate response shape and timing */
function validateResponse(requestParams, response, context, ee, next) {
    if (response.statusCode >= 500) {
        ee.emit("counter", "custom.server_errors", 1);
    }
    if (response.timings && response.timings.phases.firstByte > 2000) {
        ee.emit("counter", "custom.slow_responses", 1);
    }
    return next();
}

// ─── Geo Burst Functions ──────────────────────

/** Generate payload locked to LATAM countries (BR/MX/AR) */
function generateLatamPayload(requestParams, context, ee, next) {
    const country = pick(LATAM_COUNTRIES);
    const geo = GEO_DATA[country];
    const idx = Math.floor(Math.random() * geo.states.length);

    context.vars.country = country;
    context.vars.state = geo.states[idx];
    context.vars.zip = geo.zips[idx] || "00000";
    context.vars.city = geo.cities[idx] || "TestCity";
    context.vars.vertical = pick(VERTICALS);

    ee.emit("counter", "custom.latam_leads", 1);
    return next();
}

/** Generate payload locked to APAC countries (JP/KR/SG/IN/AU) */
function generateApacPayload(requestParams, context, ee, next) {
    const country = pick(APAC_COUNTRIES);
    const geo = GEO_DATA[country];
    const idx = Math.floor(Math.random() * geo.states.length);

    context.vars.country = country;
    context.vars.state = geo.states[idx];
    context.vars.zip = geo.zips[idx] || "00000";
    context.vars.city = geo.cities[idx] || "TestCity";
    context.vars.vertical = pick(VERTICALS);

    ee.emit("counter", "custom.apac_leads", 1);
    return next();
}

// ─── Failure Injection Functions ──────────────

/** Simulate escrow payment failure with edge-case bid amounts */
function simulateEscrowFailure(requestParams, context, ee, next) {
    // Use amounts that trigger edge cases: $0 (invalid), $999999 (exceeds cap),
    // or small fractions that stress USDC precision
    const edgeCaseAmounts = [0, 0.001, 999999, -1, 50.555555];
    const amount = pick(edgeCaseAmounts);

    const salt = crypto.randomBytes(32).toString("hex");
    const commitment = "0x" + crypto.createHash("sha256")
        .update(`${amount}:${salt}`)
        .digest("hex");

    context.vars.bidAmount = amount;
    context.vars.commitment = commitment;
    context.vars.salt = "0x" + salt;

    ee.emit("counter", "custom.escrow_attempts", 1);
    return next();
}

/** Generate rapid auto-bid evaluation to exhaust daily budget */
function generateAutoBidBudgetExhaust(requestParams, context, ee, next) {
    // Use a fixed "high-value" lead ID pattern so auto-bid engine
    // repeatedly matches the same buyer's rules and drains budget
    const leadNum = Math.floor(Math.random() * 100) + 1;
    context.vars.leadId = `stress_budget_lead_${leadNum}`;
    context.vars.vertical = "solar";
    context.vars.country = "US";
    context.vars.state = "CA";

    ee.emit("counter", "custom.budget_eval_attempts", 1);
    return next();
}

/** Set context flags for Chainlink stub latency simulation */
function simulateChainlinkLatency(requestParams, context, ee, next) {
    context.vars.stubDelay = 6000; // 6 seconds — above 5s threshold
    context.vars.vertical = "solar";
    context.vars.country = pick(Object.keys(GEO_DATA));

    ee.emit("counter", "custom.chainlink_latency_tests", 1);
    return next();
}

/** Generate a fixed commitment for duplicate bid testing */
function generateDuplicateBid(requestParams, context, ee, next) {
    // Fixed amount + salt so the same commitment is reused
    const amount = 100;
    const fixedSalt = "deadbeef".repeat(8); // 64 hex chars
    const commitment = "0x" + crypto.createHash("sha256")
        .update(`${amount}:${fixedSalt}`)
        .digest("hex");

    context.vars.bidAmount = amount;
    context.vars.commitment = commitment;
    context.vars.salt = "0x" + fixedSalt;

    return next();
}

/** Prepare CRM webhook burst context */
function fireCrmWebhookBurst(requestParams, context, ee, next) {
    // Unique webhook URL per burst to avoid collisions
    const id = Math.floor(Math.random() * 100000);
    context.vars.webhookUrl = `https://httpbin.org/post?burst_id=${id}`;
    ee.emit("counter", "custom.webhook_burst_attempts", 1);
    return next();
}

// ─── Metric Tracking Functions ────────────────

/** Track escrow payment failure metrics */
function trackEscrowMetrics(requestParams, response, context, ee, next) {
    if (response.statusCode === 402) {
        ee.emit("counter", "custom.escrow_payment_required", 1);
    } else if (response.statusCode === 500) {
        ee.emit("counter", "custom.escrow_escrow_failure", 1);
    } else if (response.statusCode === 503) {
        ee.emit("counter", "custom.escrow_service_unavailable", 1);
    } else if (response.statusCode >= 200 && response.statusCode < 300) {
        ee.emit("counter", "custom.escrow_retry_success", 1);
    }
    return next();
}

/** Track auto-bid budget exhaustion metrics */
function trackBudgetMetrics(requestParams, response, context, ee, next) {
    if (response.statusCode === 200) {
        try {
            const body = typeof response.body === "string" ? JSON.parse(response.body) : response.body;
            if (body && body.results) {
                const skipped = body.results.filter(r => r.reason && r.reason.includes("budget"));
                if (skipped.length > 0) {
                    ee.emit("counter", "custom.budget_exceeded", skipped.length);
                }
                ee.emit("counter", "custom.auto_bids_placed", body.bidsPlaced || 0);
            }
        } catch (e) { /* ignore parse errors under load */ }
    }
    return next();
}

/** Track Chainlink latency metrics */
function trackLatencyMetrics(requestParams, response, context, ee, next) {
    if (response.statusCode === 504) {
        ee.emit("counter", "custom.chainlink_timeout", 1);
    }
    if (response.timings && response.timings.phases.firstByte > 5000) {
        ee.emit("counter", "custom.chainlink_slow_5s", 1);
    }
    return next();
}

/** Track webhook delivery metrics */
function trackWebhookMetrics(requestParams, response, context, ee, next) {
    if (response.statusCode === 429) {
        ee.emit("counter", "custom.webhook_rate_limited", 1);
    } else if (response.statusCode >= 500) {
        ee.emit("counter", "custom.webhook_delivery_failure", 1);
    } else if (response.statusCode >= 200 && response.statusCode < 300) {
        ee.emit("counter", "custom.webhook_registered", 1);
    }
    return next();
}

/** Track duplicate bid metrics */
function trackDuplicateMetrics(requestParams, response, context, ee, next) {
    if (response.statusCode === 409) {
        ee.emit("counter", "custom.duplicate_bids_rejected", 1);
    } else if (response.statusCode >= 200 && response.statusCode < 300) {
        ee.emit("counter", "custom.duplicate_bids_accepted", 1);
    }
    return next();
}

/** Track cache bypass response times */
function trackCacheBypassMetrics(requestParams, response, context, ee, next) {
    if (response.timings) {
        const ttfb = response.timings.phases.firstByte;
        ee.emit("counter", "custom.cache_bypass_requests", 1);
        if (ttfb > 2000) {
            ee.emit("counter", "custom.cache_bypass_slow", 1);
        }
    }
    return next();
}

module.exports = {
    // Core
    generateLeadPayload,
    generateBidCommitment,
    pickRandomVertical,
    pickRandomCountry,
    validateResponse,
    // Geo bursts
    generateLatamPayload,
    generateApacPayload,
    // Failure injection
    simulateEscrowFailure,
    generateAutoBidBudgetExhaust,
    simulateChainlinkLatency,
    generateDuplicateBid,
    fireCrmWebhookBurst,
    // Metric tracking
    trackEscrowMetrics,
    trackBudgetMetrics,
    trackLatencyMetrics,
    trackWebhookMetrics,
    trackDuplicateMetrics,
    trackCacheBypassMetrics,
};
