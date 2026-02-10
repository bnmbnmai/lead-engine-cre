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
};

const VERTICALS = ["solar", "mortgage", "roofing", "insurance", "auto", "legal", "home_services", "real_estate", "b2b_saas", "financial"];

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Exported Functions ───────────────────────

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

module.exports = {
    generateLeadPayload,
    generateBidCommitment,
    pickRandomVertical,
    pickRandomCountry,
    validateResponse,
};
