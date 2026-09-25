// =============================================================
// FILE: test/consistency.test.js
// Run with: npm run test:consistency  (or: node --test test/consistency.test.js)
//
// These are NOT general unit tests of "does the app work" — they exist to
// catch DRIFT: places where two things that must agree (a hardcoded prompt
// price vs. the knowledge table, a worked-example in a comment vs. what the
// formula actually computes, a pricing table vs. a width table) are edited
// independently and silently fall out of sync. Every case here was chosen
// because api/chat.js's own comments explicitly worry about it (see the
// "Glint Table incident", the price-guardrail rationale, and the
// single-source-of-truth notes in knowledge/wallbeds.js).
// =============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    getRelevantKnowledge,
    buildSystemPrompt,
    extractCabinetryDimensions,
    detectSideCabinetCount,
    getCabinetryEstimateFromContext,
    computeCabinetryAllowedAmounts,
    buildCabinetryEstimateBlock,
    hasCabinetryPriceIntent,
    detectMuranoCeilingConflict,
    buildMuranoCeilingWarningBlock,
    convertToFeet,
    findHallucinatedPrices,
    isKnownAmount,
    MASTER_PRICE_LIST,
    KNOWLEDGE_MODULES,
    BASIC_FURNITURE_COMPANION_KEYS,
    MURANO_MIN_CEILING_FT,
    computeDepositOffer,
    ALLOWED_FIXED_DEPOSITS,
    DEPOSIT_TYPE_RESERVATION,
    UNSPECIFIED_PRODUCT_LABEL,
    extractProductLabel,
    getReservationDepositOptions,
    getDepositOptionsForBasis,
    resolveDepositChoiceForBasis,
    DEPOSIT_OPTION_PERCENT,
    getDepositOptions,
    resolveDepositChoice,
    buildDepositCharge,
    getDepositBasisFromContext,
    hasCabinetryIntent,
    hasPurchaseIntent,
    hasPriceIntent,
    DEPOSIT_TYPE_WITH_CABINETRY,
    DEPOSIT_TYPE_WALLBED_ONLY,
    depositIncludesCabinets,
    depositTypeLabel,
    DEPOSIT_PERCENT
} from '../api/chat.js';

import { generateQuoteRef, QUOTE_REF_PATTERN } from '../lib/reference.js';

import { calculateCabinetPrice, getCabinetryKnowledge, SIDE_CABINET_MAX_HEIGHT_FT, resolveSideCabinetHeightFt } from '../knowledge/cabinetry.js';
import { getWallBedKnowledge, WALLBED_MODEL_WIDTHS_FT, WALLBED_MODEL_PRICING, WALLBED_MODEL_HEIGHTS_FT } from '../knowledge/wallbeds.js';
import { getSofaBedKnowledge } from '../knowledge/sofabeds.js';
import { getTableKnowledge } from '../knowledge/tables.js';
import { getKitchenKnowledge } from '../knowledge/kitchen.js';
import { getWardrobeKnowledge } from '../knowledge/wardrobes.js';
import { getShowroomKnowledge } from '../knowledge/showroom.js';
import { getWarrantyKnowledge } from '../knowledge/warranty.js';
import { getRenovationKnowledge } from '../knowledge/renovation.js';
import { getBasicFurnitureKnowledge, BASIC_SOFA_PRICING } from '../knowledge/basicfurniture.js';
import { resolveProductPrice, applyCatalogPricing } from '../lib/productPricing.js';
import { validateInvoiceInput } from '../lib/invoiceInput.js';
import { getBedsheetKnowledge } from '../knowledge/bedsheets.js';
import { PRODUCT_IMAGES, getRelevantImages } from '../knowledge/productImages.js';
import { logDepositToSheet, base64url, normalizePrivateKey, getAccessToken } from '../lib/sheetsLogger.js';
import { buildDepositEmail, UNKNOWN_TYPE_LABEL } from '../lib/depositNotification.js';

import { generateKeyPairSync, createVerify } from 'node:crypto';

function round2(n) {
    return Math.round(n * 100) / 100;
}

// ── KNOWLEDGE_MODULES registry ──────────────────────────────
describe('KNOWLEDGE_MODULES registry', () => {
    test('every key is unique', () => {
        const keys = KNOWLEDGE_MODULES.map(m => m.key);
        assert.equal(new Set(keys).size, keys.length, `duplicate keys found: ${keys}`);
    });

    test('every module fn() returns a non-empty string', () => {
        for (const m of KNOWLEDGE_MODULES) {
            const text = m.fn();
            assert.equal(typeof text, 'string', `${m.key}.fn() did not return a string`);
            assert.ok(text.trim().length > 0, `${m.key}.fn() returned an empty string`);
        }
    });

    test('every BASIC_FURNITURE_COMPANION_KEYS entry is a real KNOWLEDGE_MODULES key', () => {
        const validKeys = new Set(KNOWLEDGE_MODULES.map(m => m.key));
        for (const key of BASIC_FURNITURE_COMPANION_KEYS) {
            assert.ok(validKeys.has(key), `companion key "${key}" does not exist in KNOWLEDGE_MODULES`);
        }
    });

    test('"basicFurniture" itself is a registered module key', () => {
        assert.ok(KNOWLEDGE_MODULES.some(m => m.key === 'basicFurniture'));
    });
});

// ── getRelevantKnowledge routing ────────────────────────────
// Module inclusion is checked by exact full-text substring match (not a
// short header string) because several knowledge files legitimately
// cross-reference each other's headings in prose (e.g. wallbeds.js tells
// the model "see WARDROBE & STORAGE SOLUTIONS instead" inside its OWN
// text). A short marker would false-positive on that mention even when
// the wardrobe module itself was never selected — the full returned
// string is concatenated verbatim only when a module is actually chosen.
describe('getRelevantKnowledge routing', () => {
    test('no keyword match falls back to wall bed + showroom knowledge, unmodified', () => {
        const text = getRelevantKnowledge('hello there', []);
        assert.equal(text, getWallBedKnowledge() + getShowroomKnowledge());
    });

    test('a single obvious match includes that module plus its basicFurniture companion', () => {
        const text = getRelevantKnowledge('Tell me about your wall bed products.', []);
        assert.ok(text.includes(getWallBedKnowledge()), 'wallbed knowledge missing');
        assert.ok(text.includes(getBasicFurnitureKnowledge()), 'basicFurniture companion missing for wallbed');
    });

    test('a message with no companion-category match does NOT pull in basicFurniture', () => {
        const text = getRelevantKnowledge('Where are your showrooms and opening hours?', []);
        assert.ok(text.includes(getShowroomKnowledge()));
        assert.ok(!text.includes(getBasicFurnitureKnowledge()), 'basicFurniture should not appear for a showroom-only query');
    });

    test('MAX_KNOWLEDGE_MODULES cap keeps only the first 3 array-order matches, plus an uncapped basicFurniture companion', () => {
        // Matches (in KNOWLEDGE_MODULES array order): wallbed, table, kitchen,
        // wardrobe, renovation, basicFurniture (6 total) — more than the cap.
        const msg = "I'm doing a home renovation and need a wardrobe, wall bed, and dining table for my kitchen.";
        const text = getRelevantKnowledge(msg, []);

        // Survive the cap (first 3 in KNOWLEDGE_MODULES array order):
        assert.ok(text.includes(getWallBedKnowledge()), 'wallbed should survive the cap (1st match)');
        assert.ok(text.includes(getTableKnowledge()), 'table should survive the cap (2nd match)');
        assert.ok(text.includes(getKitchenKnowledge()), 'kitchen should survive the cap (3rd match)');
        // basicFurniture rides along uncapped because wallbed/table/kitchen are all companion keys:
        assert.ok(text.includes(getBasicFurnitureKnowledge()), 'basicFurniture companion should always ride along');

        // Cut by the cap (matched, but ranked 4th/5th and NOT a companion carve-out):
        assert.ok(!text.includes(getWardrobeKnowledge()), 'wardrobe should be cut by the cap');
        assert.ok(!text.includes(getRenovationKnowledge()), 'renovation should be cut by the cap');
    });

    test('a follow-up with no keywords of its own still pulls knowledge from recent history', () => {
        const history = [
            { role: 'user', content: 'Tell me about your sofa beds' },
            { role: 'assistant', content: 'We have the Orzo Single and Orzo Hori...' }
        ];
        const text = getRelevantKnowledge('what is the price of that?', history);
        assert.ok(text.includes(getSofaBedKnowledge()), 'history-only match should still surface sofabed knowledge');
    });
});

// ── Wall bed width / pricing table cross-consistency ────────
// wallbeds.js explicitly documents these two tables as needing to stay in
// sync (WALLBED_MODEL_PRICING is "intentionally MORE granular than
// WALLBED_MODEL_WIDTHS_FT"), and both feed the cabinetry calculator from
// two different lookup functions (extractSelectedWallBedModel vs.
// extractSelectedWallBedPricing) — if a new model is added to one table
// and not the other, the combined wall-bed-price + cabinetry estimate
// silently breaks for that model.
describe('wall bed width/pricing table consistency', () => {
    test('every WALLBED_MODEL_PRICING label matches at least one WALLBED_MODEL_WIDTHS_FT pattern', () => {
        for (const priced of WALLBED_MODEL_PRICING) {
            const text = priced.label.toLowerCase();
            const matched = WALLBED_MODEL_WIDTHS_FT.some(w => w.pattern.test(text));
            assert.ok(matched, `"${priced.label}" has no matching width entry in WALLBED_MODEL_WIDTHS_FT`);
        }
    });

    test('every WALLBED_MODEL_PRICING entry has sale <= retail', () => {
        for (const p of WALLBED_MODEL_PRICING) {
            assert.ok(p.sale <= p.retail, `${p.label}: sale (${p.sale}) should not exceed retail (${p.retail})`);
        }
    });

    test('no duplicate labels in WALLBED_MODEL_PRICING', () => {
        const labels = WALLBED_MODEL_PRICING.map(p => p.label);
        assert.equal(new Set(labels).size, labels.length, `duplicate labels: ${labels}`);
    });

    test('every WALLBED_MODEL_PRICING price appears in the system-prompt price guardrail\'s MASTER_PRICE_LIST', () => {
        for (const p of WALLBED_MODEL_PRICING) {
            assert.ok(isKnownAmount(p.sale, []), `${p.label} sale price ${p.sale} not recognized by the price guardrail`);
            assert.ok(isKnownAmount(p.retail, []), `${p.label} retail price ${p.retail} not recognized by the price guardrail`);
        }
    });
});

// ── System-prompt hardcoded prices vs. the knowledge table ──
// buildSystemPrompt() (not exported — it's the actual LLM-facing prompt
// text) hardcodes "Study room → Gioco Single with Desk (RM 17,538.11 sale)"
// and "Living room → Murano Queen with Sofa (RM 23,698.11 sale)" under
// PRODUCT RECOMMENDATION RULES. Those literal figures were copied from
// WALLBED_MODEL_PRICING at the time the prompt was written; nothing
// enforces they stay equal if the catalog price changes later. This test
// is the tripwire for that specific drift.
describe('system-prompt product-recommendation prices vs. catalog', () => {
    const promptClaims = [
        { label: 'Gioco Single Desk', promptSale: 17538.11 },
        { label: 'Murano Queen Sofa', promptSale: 23698.11 }
    ];

    for (const claim of promptClaims) {
        test(`"${claim.label}" price quoted in PRODUCT RECOMMENDATION RULES matches WALLBED_MODEL_PRICING`, () => {
            const catalogEntry = WALLBED_MODEL_PRICING.find(p => p.label === claim.label);
            assert.ok(catalogEntry, `${claim.label} no longer exists in WALLBED_MODEL_PRICING`);
            assert.equal(
                catalogEntry.sale,
                claim.promptSale,
                `system prompt says RM ${claim.promptSale} for ${claim.label}, but the catalog now says RM ${catalogEntry.sale} — update buildSystemPrompt()'s PRODUCT RECOMMENDATION RULES text`
            );
        });
    }
});

// ── Cabinetry formula vs. its own documented worked examples ──
// getCabinetryKnowledge() (the LLM-facing prompt text) contains 4 worked
// examples with numbers written out in prose. calculateCabinetPrice() is
// the actual formula. Nothing keeps the prose in sync with the code if
// SIDE_RATE_PER_FT / TOP_RATE_PER_FT / the height caps ever change — a
// silent mismatch there would mean the model is being shown a stale
// worked example that contradicts what the server will actually compute
// and quote to the customer.
describe('cabinetry formula matches its own worked examples', () => {
    test('worked example 1 — 11ft wall, 5.5ft bed, 10ft total width, 2 sides', () => {
        const r = calculateCabinetPrice({ wallHeightFt: 11, wallBedWidthFt: 5.5, totalWallWidthFt: 10, sides: 2 });
        assert.equal(r.sideCabinetWidthFt, 2.25);
        assert.equal(r.sideCostPerSide, 3037.50);
        assert.equal(r.sideCostTotal, 6075);
        assert.equal(r.topCost, 8500);
        assert.equal(r.total, 14575);
        assert.equal(r.overheadCabinetHeightFt, 4);
    });

    test('worked example 2 — 9ft wall (same widths as example 1): same price, shorter overhead cabinet', () => {
        const r = calculateCabinetPrice({ wallHeightFt: 9, wallBedWidthFt: 5.5, totalWallWidthFt: 10, sides: 2 });
        assert.equal(r.total, 14575, 'wall height must not affect price');
        assert.equal(r.overheadCabinetHeightFt, 2, '9ft wall - 7ft fixed side height = 2ft overhead cabinet');
    });

    test('worked example 3 — same as example 1 but only 1 side (corner installation)', () => {
        const r = calculateCabinetPrice({ wallHeightFt: 11, wallBedWidthFt: 5.5, totalWallWidthFt: 10, sides: 1 });
        assert.equal(r.sideCostTotal, 3037.50);
        assert.equal(r.total, 11537.50);
    });

    test('worked example 4 — full wall bed + cabinetry grand total for Murano Queen Sofa', () => {
        const r = calculateCabinetPrice({ wallHeightFt: 11, wallBedWidthFt: 5.48, totalWallWidthFt: 10, sides: 2 });
        assert.equal(r.sideCostPerSide, 3051);
        assert.equal(r.sideCostTotal, 6102);
        assert.equal(r.topCost, 8500);
        assert.equal(r.total, 14602);

        const wallBed = WALLBED_MODEL_PRICING.find(p => p.label === 'Murano Queen Sofa');
        assert.ok(wallBed, 'Murano Queen Sofa missing from WALLBED_MODEL_PRICING');
        const grandTotal = round2(wallBed.sale + r.total);
        assert.equal(grandTotal, 38300.11);
    });

    test('a taller wall never costs more (price is width-driven only)', () => {
        const short = calculateCabinetPrice({ wallHeightFt: 8, wallBedWidthFt: 5.48, totalWallWidthFt: 10, sides: 2 });
        const tall = calculateCabinetPrice({ wallHeightFt: 14, wallBedWidthFt: 5.48, totalWallWidthFt: 10, sides: 2 });
        assert.equal(short.total, tall.total);
    });

    test('rejects a total wall width that leaves no room for side cabinets', () => {
        assert.throws(() => calculateCabinetPrice({ wallHeightFt: 11, wallBedWidthFt: 5.5, totalWallWidthFt: 5.5 }));
    });
});

// ── End-to-end cabinetry extraction -> pricing -> guardrail chain ──
// Exercises the full pipeline the way a real conversation would hit it:
// customer names a model, answers height/width one at a time (including a
// BARE number reply with no context words, which relies on turn-aware
// inference from the assistant's preceding question), and the resulting
// live estimate must (a) match the formula exactly and (b) be recognized
// by the price guardrail so a correct reply is never falsely blocked.
describe('cabinetry context extraction -> pricing -> price guardrail chain', () => {
    const history = [
        { role: 'user', content: 'I want a Murano Queen Sofa with side cabinets around it, how much in total?' },
        { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' },
        { role: 'user', content: '11ft' },
        { role: 'assistant', content: 'Got it. What is the total width of the wall, in feet?' }
    ];
    const message = '10ft';

    test('extracts model + dimensions and computes the same grand total as worked example 4', () => {
        const est = getCabinetryEstimateFromContext(message, history);
        assert.ok(est, 'expected a resolved cabinetry estimate');
        assert.equal(est.heightFt, 11);
        assert.equal(est.totalWidthFt, 10);
        assert.equal(est.wallBedModelLabel, 'Murano Queen Sofa');
        assert.equal(est.total, 14602);
        assert.equal(est.grandTotal, 38300.11);
    });

    test('price intent is detected even though it was asked several turns before the final measurement', () => {
        assert.equal(hasCabinetryPriceIntent(message, history), true);
    });

    test('a correctly-computed grand total reply is never flagged as hallucinated', () => {
        const allowed = computeCabinetryAllowedAmounts(message, history);
        const reply =
            'Wall bed (Murano Queen Sofa): RM 23,698.11. ' +
            'Side cabinets: RM 3,051.00 per side x 2 = RM 6,102.00. ' +
            'Overhead cabinet: RM 8,500.00. ' +
            'Cabinetry subtotal: RM 14,602.00. ' +
            'GRAND TOTAL: RM 38,300.11';
        assert.deepEqual(findHallucinatedPrices(reply, message, allowed), []);
    });

    test('an arithmetically wrong grand total for this SAME context is still caught', () => {
        const allowed = computeCabinetryAllowedAmounts(message, history);
        const wrongReply = 'GRAND TOTAL (wall bed + cabinetry): RM 38,273.11';
        const bad = findHallucinatedPrices(wrongReply, message, allowed);
        assert.deepEqual(bad, ['38273.11']);
    });

    // ── Deposit offer (Stripe integration) — reuses this exact fixture so
    // the deposit amount is checked against the SAME verified grand total
    // as the tests above, rather than a second hand-computed number that
    // could quietly drift from it.
    test('computeDepositOffer returns the full offer once a grand total is actually being shown', () => {
        const offer = computeDepositOffer(message, history);
        assert.ok(offer, 'expected a non-null deposit offer');
        assert.equal(offer.wallBedModelLabel, 'Murano Queen Sofa');
        assert.equal(offer.grandTotal, 38300.11);
        assert.equal(offer.depositPercent, DEPOSIT_PERCENT);
        assert.equal(offer.depositAmount, 3830.01); // 10% of 38300.11, rounded
    });
});

describe('computeDepositOffer gating (must never precede or bypass the price text itself)', () => {
    test('returns null when every measurement is known but price was never actually asked', () => {
        // Same shape as the worked-example-4 fixture above, MINUS any price
        // word anywhere in the conversation — mirrors buildCabinetryEstimateBlock()'s
        // own price-intent gate, which the text breakdown is ALSO subject to.
        const history = [
            { role: 'user', content: 'I want a Murano Queen with side cabinets around it.' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'Got it. What is the total width of the wall, in feet?' }
        ];
        assert.equal(hasCabinetryPriceIntent('10ft', history), false);
        assert.equal(computeDepositOffer('10ft', history), null);
    });

    test('returns null for a blocked (wall-too-short) estimate — there is nothing to deposit against', () => {
        const history = [
            { role: 'user', content: 'I have a Murano Single, can I get side cabinets around it? How much would it cost?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        assert.equal(computeDepositOffer('6ft', history), null);
    });

    test('returns null while a measurement is still outstanding, even with clear price intent', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen with cabinets, how much in total?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        // Height given, total wall width never collected — matches the
        // "keep asking" case getCabinetryEstimateFromContext already covers.
        assert.equal(computeDepositOffer('11ft', history), null);
    });
});

describe('lib/reference.js — quote reference generation', () => {
    test('generateQuoteRef() matches the documented MQS-YYYYMMDD-XXXXXX format', () => {
        const ref = generateQuoteRef();
        assert.match(ref, QUOTE_REF_PATTERN);
    });

    test('embeds the given date (UTC) rather than always using "now"', () => {
        const ref = generateQuoteRef(new Date('2026-08-20T14:14:47Z'));
        assert.match(ref, /^MQS-20260820-/);
    });

    test('two calls produce different references', () => {
        const a = generateQuoteRef();
        const b = generateQuoteRef();
        assert.notEqual(a, b);
    });

    test('never uses visually ambiguous characters (0/O, 1/I) in the suffix', () => {
        for (let i = 0; i < 20; i++) {
            const suffix = generateQuoteRef().split('-')[2];
            assert.doesNotMatch(suffix, /[01OI]/);
        }
    });
});

// ── Price hallucination guardrail ───────────────────────────
describe('price guardrail (findHallucinatedPrices / isKnownAmount)', () => {
    test('MASTER_PRICE_LIST is non-empty', () => {
        assert.ok(MASTER_PRICE_LIST.length > 0);
    });

    test('every real catalog price, individually, is recognized as known', () => {
        for (const val of MASTER_PRICE_LIST) {
            assert.ok(isKnownAmount(val, []), `catalog price RM ${val} is not self-recognized by isKnownAmount`);
        }
    });

    test('a reply that only quotes real catalog prices has zero flagged amounts', () => {
        const samplePrices = MASTER_PRICE_LIST.slice(0, 5);
        const reply = samplePrices.map(v => `RM ${v.toFixed(2)}`).join(', ');
        assert.deepEqual(findHallucinatedPrices(reply, '', []), []);
    });

    test('an invented price far from any real value is flagged', () => {
        const bad = findHallucinatedPrices('That would be RM 88,888.88 in total.', '', []);
        assert.deepEqual(bad, ['88888.88']);
    });

    test('a customer echoing their own stated budget is never flagged, even if not a catalog price', () => {
        const userMessage = 'My budget is RM 45,000';
        const reply = 'Great, RM 45,000 should comfortably cover a Murano Queen Sofa setup.';
        assert.deepEqual(findHallucinatedPrices(reply, userMessage, []), []);
    });

    test('rounding within the RM2 tolerance is not treated as hallucination', () => {
        const realPrice = WALLBED_MODEL_PRICING[0].sale;
        const roundedReply = `The price is RM ${Math.round(realPrice)}.`;
        assert.deepEqual(findHallucinatedPrices(roundedReply, '', []), []);
    });
});

// ── Product image coverage ──────────────────────────────────
// productImages.js explicitly models itself on the pattern used by
// WALLBED_MODEL_WIDTHS_FT ("real image URLs, matched in code, never left
// to the model to invent") — this checks that promise actually holds for
// every priced wall bed model, i.e. no model can be quoted a price by the
// system prompt while having zero matching product photo.
describe('product image coverage', () => {
    test('every PRODUCT_IMAGES entry has a non-empty label and url', () => {
        for (const entry of PRODUCT_IMAGES) {
            assert.ok(entry.label && entry.label.trim().length > 0, 'entry missing a label');
            assert.ok(entry.url && entry.url.trim().length > 0, `"${entry.label}" is missing a url`);
        }
    });

    test('every priced wall bed model matches at least one PRODUCT_IMAGES entry', () => {
        for (const priced of WALLBED_MODEL_PRICING) {
            const text = priced.label.toLowerCase();
            const matched = PRODUCT_IMAGES.some(img => img.pattern.test(text));
            assert.ok(matched, `"${priced.label}" has no matching entry in PRODUCT_IMAGES`);
        }
    });

    test('getRelevantImages returns at most 2 images for a message matching many products', () => {
        const images = getRelevantImages('show me the murano queen sofa and the gioco bunk bed and the erga wardrobe', []);
        assert.ok(images.length <= 2, `expected at most 2 images, got ${images.length}`);
    });

    test('a bare measurement reply (answering a dimension question) does not attach a product photo', () => {
        // Guards the specific bug this logic calls out: "Murano Queen, and the
        // wall is 8ft high" should not attach a photo just because a model name
        // and a number happen to appear in the same message.
        const images = getRelevantImages('Murano Queen, and the wall is 8ft high', []);
        assert.deepEqual(images, []);
    });
});

// ── Phase 3.1: metric (cm/m) input alongside feet ───────────────────────
// The cabinetry extraction regexes now accept cm/m in addition to ft, but
// calculateCabinetPrice() itself is still feet-only by design (untouched by
// this phase) — convertToFeet() is the single place doing that translation,
// so these tests pin down its round-trip behavior against clean values.
describe('convertToFeet — metric-to-feet conversion', () => {
    test('feet passes through unchanged', () => {
        assert.equal(convertToFeet(10, 'ft'), 10);
        assert.equal(convertToFeet(5.5, 'feet'), 5.5);
        assert.equal(convertToFeet(6, "'"), 6);
    });

    test('304.8cm converts to exactly 10ft (30.48cm/ft)', () => {
        assert.equal(convertToFeet(304.8, 'cm'), 10);
        assert.equal(convertToFeet(304.8, 'centimeters'), 10);
        assert.equal(convertToFeet(304.8, 'centimetres'), 10);
    });

    test('3.048m converts to exactly 10ft', () => {
        assert.equal(convertToFeet(3.048, 'm'), 10);
        assert.equal(convertToFeet(3.048, 'meters'), 10);
        assert.equal(convertToFeet(3.048, 'metres'), 10);
    });
});

describe('cabinetry extraction accepts metric measurements end-to-end', () => {
    test('a height given in cm and a width given in m compute the same estimate as example 1 (all-feet)', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen with side cabinets, how much in total?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' },
            { role: 'user', content: '335.28cm' }, // 335.28 / 30.48 = 11ft exactly
            { role: 'assistant', content: 'Got it. What is the total width of the wall, in feet?' }
        ];
        const message = '3.048m'; // 3.048 * (1/0.3048) = 10ft exactly

        const est = getCabinetryEstimateFromContext(message, history);
        assert.ok(est && !est.blocked, 'expected a resolved (non-blocked) cabinetry estimate');
        assert.equal(est.heightFt, 11);
        assert.equal(est.totalWidthFt, 10);
        // Murano Queen's width is 5.48ft (WALLBED_MODEL_WIDTHS_FT), same as
        // worked example 4's real-spec-width variant, not the rounded 5.5ft
        // used in worked example 1 — so compare against calculateCabinetPrice
        // directly rather than hardcoding example 1's numbers here.
        const expected = calculateCabinetPrice({ wallHeightFt: 11, wallBedWidthFt: 5.48, totalWallWidthFt: 10, sides: 2 });
        assert.equal(est.total, expected.total);
    });

    test('a metric bed-width mention ("the wall bed is 167cm wide") is not misread as the total wall width', () => {
        // Mirrors the existing (all-feet) BED_WIDTH_MENTION_GUARD coverage,
        // just in metric — a self-contained bed-width mention should still
        // not get picked up as the total wall width.
        const history = [
            { role: 'user', content: 'I want a Murano Queen, the wall bed is 167cm wide — how much for cabinets?' },
            { role: 'assistant', content: 'Got it. What is the total width of the wall, in feet?' }
        ];
        const { totalWidthFt } = extractCabinetryDimensions(history, '10ft');
        assert.equal(totalWidthFt, 10, 'should resolve to the actual total-width answer, not the earlier bed-width mention');
    });
});

// ── Phase 3.2a: wall too short to fit surround cabinetry (<7ft) ─────────
describe('cabinetry — wall below the 7ft minimum', () => {
    test('calculateCabinetPrice() throws a specific, identifiable error', () => {
        assert.throws(
            () => calculateCabinetPrice({ wallHeightFt: 6, wallBedWidthFt: 5.5, totalWallWidthFt: 10 }),
            (err) => {
                assert.equal(err.code, 'WALL_TOO_SHORT_FOR_CABINETRY');
                assert.equal(err.minHeightFt, SIDE_CABINET_MAX_HEIGHT_FT);
                return true;
            }
        );
    });

    test('a wall exactly at the 7ft minimum is still allowed (only strictly-below fails)', () => {
        assert.doesNotThrow(() =>
            calculateCabinetPrice({ wallHeightFt: 7, wallBedWidthFt: 5.5, totalWallWidthFt: 10 })
        );
    });

    test('getCabinetryEstimateFromContext returns a blocked result, not null and not a price', () => {
        const history = [
            { role: 'user', content: 'I have a Murano Single, can I get side cabinets around it?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        const est = getCabinetryEstimateFromContext('6ft', history);
        assert.ok(est, 'expected a non-null result (not "keep asking")');
        assert.equal(est.blocked, true);
        assert.equal(est.reason, 'WALL_TOO_SHORT_FOR_CABINETRY');
        assert.equal(est.heightFt, 6);
        assert.equal(est.minHeightFt, 7);
    });

    test('computeCabinetryAllowedAmounts returns [] for a blocked (too-short) wall', () => {
        const history = [
            { role: 'user', content: 'I have a Murano Single, can I get side cabinets around it?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        assert.deepEqual(computeCabinetryAllowedAmounts('6ft', history), []);
    });

    test('a fabricated price for a blocked (too-short) wall is still caught by the guardrail', () => {
        const history = [
            { role: 'user', content: 'I have a Murano Single, can I get side cabinets around it?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        const allowed = computeCabinetryAllowedAmounts('6ft', history);
        // Deliberately far from any real catalog price (unlike a round number
        // like RM 5,000, which can land within the RM2 tolerance of an
        // unrelated real price purely by coincidence).
        const badReply = 'Sure, that would come to RM 88,888.88 for the cabinetry.';
        assert.deepEqual(findHallucinatedPrices(badReply, '6ft', allowed), ['88888.88']);
    });

    test('buildCabinetryEstimateBlock surfaces the "not possible" message even with no price question asked yet', () => {
        const history = [
            { role: 'user', content: 'I have a Murano Single, can I get side cabinets around it?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        const block = buildCabinetryEstimateBlock('6ft', history);
        assert.match(block, /NOT POSSIBLE/);
        assert.match(block, /6ft/);
        assert.doesNotMatch(block, /PRE-CALCULATED/, 'must not also show a priced breakdown');
    });

    test('buildCabinetryEstimateBlock stays empty (keeps asking) when only height is known and it is a valid (>=7ft) height', () => {
        const history = [
            { role: 'user', content: 'I have a Murano Single, can I get side cabinets around it?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        const block = buildCabinetryEstimateBlock('11ft', history);
        assert.equal(block, '', 'should return empty and keep collecting total width, not error');
    });
});

// ── Phase 3.2b: Murano requires a 2.4m+ (~7ft+) ceiling ──────────────────
describe('detectMuranoCeilingConflict — wall-bed series ceiling restriction', () => {
    test('Murano + a ceiling under 7ft is flagged as a conflict', () => {
        const history = [
            { role: 'assistant', content: "I'd recommend the Murano Queen for your living room." },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        const conflict = detectMuranoCeilingConflict('6ft', history);
        assert.ok(conflict, 'expected a conflict to be detected');
        assert.equal(conflict.heightFt, 6);
        assert.equal(conflict.minCeilingFt, MURANO_MIN_CEILING_FT);
        assert.match(conflict.conflictingLabel, /Murano/);
    });

    // NOTE: the history below must end with the assistant ASKING about height,
    // or extractCabinetryDimensions' bare-number inference has nothing to
    // attribute "7.87ft" to and silently yields no height — which makes a
    // detectMuranoCeilingConflict(...) === null assertion pass for the wrong
    // reason. Every case in this describe block needs that priming turn.
    test('Murano + a ceiling at or above the 2.4m minimum is NOT a conflict', () => {
        const history = [
            { role: 'assistant', content: "I'd recommend the Murano Queen for your living room." },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        assert.equal(detectMuranoCeilingConflict('7.87ft', history), null);
        assert.equal(detectMuranoCeilingConflict('11ft', history), null);
    });

    // The gap this closes: 7ft used to pass because MURANO_MIN_CEILING_FT was
    // aliased to SIDE_CABINET_MAX_HEIGHT_FT. 2.4m is ≈7.87ft, so a 7ft–7.87ft
    // ceiling is genuinely too short for a Murano and must now be flagged.
    test('a ceiling between 7ft and 2.4m is a conflict (this range previously passed)', () => {
        const history = [
            { role: 'assistant', content: "I'd recommend the Murano Queen for your living room." },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        for (const height of ['7ft', '7.5ft', '7.8ft']) {
            const conflict = detectMuranoCeilingConflict(height, history);
            assert.ok(conflict, `expected ${height} to be flagged as below the 2.4m Murano minimum`);
            assert.match(conflict.conflictingLabel, /Murano/);
        }
    });

    // Boundary case that only breaks if the threshold and convertToFeet round
    // differently: a customer answering with the exact stated minimum in the
    // unit the business quotes it in must not be told their ceiling is too low.
    test('a customer answering exactly "2.4m" is not flagged', () => {
        const history = [{ role: 'assistant', content: 'Murano Queen it is. What is the height of the wall?' }];
        assert.equal(convertToFeet(2.4, 'm'), MURANO_MIN_CEILING_FT);
        assert.equal(detectMuranoCeilingConflict('2.4m', history), null);
        assert.equal(detectMuranoCeilingConflict('240cm', history), null);
    });

    test('Gioco + a ceiling under 7ft is NOT a conflict (Gioco is rated for low ceilings)', () => {
        const history = [{ role: 'assistant', content: "I'd recommend the Gioco Single for your study." }];
        assert.equal(detectMuranoCeilingConflict('6ft', history), null);
    });

    test('no conflict when no model has been established yet', () => {
        assert.equal(detectMuranoCeilingConflict('6ft', []), null);
    });

    test('buildMuranoCeilingWarningBlock is empty when there is no conflict, and names the model + heights when there is one', () => {
        // The bare-number reply below only resolves to heightFt because the
        // assistant's own turn here mentions "height" (see extractCabinetryDimensions'
        // turn-aware bare-number inference) — same requirement as the rest of
        // the cabinetry flow.
        const noConflictHistory = [{ role: 'assistant', content: 'Murano Queen it is. What is the total height of the wall, in feet?' }];
        assert.equal(buildMuranoCeilingWarningBlock('11ft', noConflictHistory), '');

        const conflictHistory = [{ role: 'assistant', content: 'Murano Queen it is. What is the total height of the wall, in feet?' }];
        const block = buildMuranoCeilingWarningBlock('6ft', conflictHistory);
        assert.match(block, /CEILING HEIGHT CONFLICT/);
        assert.match(block, /Murano Queen/);
        assert.match(block, /Gioco/);
    });

    test('MURANO_MIN_CEILING_FT is derived from the 2.4m business requirement, not from the cabinetry height', () => {
        assert.equal(MURANO_MIN_CEILING_FT, convertToFeet(2.4, 'm'));
        assert.notEqual(
            MURANO_MIN_CEILING_FT,
            SIDE_CABINET_MAX_HEIGHT_FT,
            'these are unrelated measurements (Murano headroom vs. side-cabinet build height) and must not be re-aliased — doing so under-enforces the 2.4m minimum'
        );
    });

    // The two thresholds are close enough to be confused for each other, so
    // pin the case that distinguishes them: 7.5ft fits cabinetry but not a Murano.
    test('the cabinetry minimum (7ft) and the Murano minimum (2.4m) gate independently', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen with side cabinets around it, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '7.5ft' },
            { role: 'assistant', content: 'And the total width of the wall?' }
        ];
        const est = getCabinetryEstimateFromContext('12ft', history);
        assert.ok(est && !est.blocked, 'a 7.5ft wall is tall enough for cabinetry (>= 7ft)');
        assert.ok(
            detectMuranoCeilingConflict('12ft', history),
            'the same 7.5ft wall is still too short for a Murano (< 2.4m)'
        );
    });
});

describe('buildSystemPrompt — renovation WhatsApp number consistency', () => {
    test('the RENOVATION LEAD COLLECTION completion line uses the renovation WhatsApp number (475), not the general one (568)', () => {
        const prompt = buildSystemPrompt('I want to renovate my condo', []);
        // Deliberately the colon form ("RENOVATION LEAD COLLECTION:\n") to
        // find chat.js's own inline instruction block specifically —
        // knowledge/renovation.js's block (also included in this prompt)
        // shares the same header phrase but with an em-dash, not a colon,
        // right after it ("RENOVATION LEAD COLLECTION — ask ONE...").
        const sectionStart = prompt.indexOf('RENOVATION LEAD COLLECTION:\n');
        assert.notEqual(sectionStart, -1, 'expected to find the chat.js RENOVATION LEAD COLLECTION: block');
        const sectionEnd = prompt.indexOf('\n\n', sectionStart);
        const section = prompt.slice(sectionStart, sectionEnd === -1 ? undefined : sectionEnd);
        assert.match(section, /\+60 12-475 4568/);
        assert.doesNotMatch(section, /\+60 12-568 4568/);
    });
});

// ── Knowledge text sanity (catches accidental truncation / paste errors) ──
describe('knowledge module content sanity', () => {
    const modules = [
        ['wallbeds', getWallBedKnowledge()],
        ['sofabeds', getSofaBedKnowledge()],
        ['tables', getTableKnowledge()],
        ['kitchen', getKitchenKnowledge()],
        ['wardrobes', getWardrobeKnowledge()],
        ['showroom', getShowroomKnowledge()],
        ['warranty', getWarrantyKnowledge()],
        ['renovation', getRenovationKnowledge()],
        ['basicfurniture', getBasicFurnitureKnowledge()],
        ['bedsheets', getBedsheetKnowledge()],
        ['cabinetry', getCabinetryKnowledge()]
    ];

    for (const [name, text] of modules) {
        test(`${name}.js knowledge text is non-trivial and has no unresolved template markers`, () => {
            assert.ok(text.length > 50, `${name} knowledge text looks too short (${text.length} chars)`);
            assert.ok(!/undefined|\[object Object\]|NaN/.test(text), `${name} knowledge text contains a stray runtime artifact`);
        });
    }
});

// ── lib/sheetsLogger.js — deposit logging ───────────────────────
// This module is the one place in the project that hand-rolls a security
// primitive (an RS256 JWT signed with node:crypto instead of googleapis), so
// the JWT assembly is verified against a real generated key pair rather than
// trusted by inspection. Everything here runs offline: global fetch is stubbed,
// so no test ever reaches Google.
describe('lib/sheetsLogger.js — deposit logging', () => {

    // Every test that touches process.env or globalThis.fetch restores both,
    // otherwise leaked Sheets config would silently change the behavior of the
    // no-op tests below depending on execution order.
    const SHEETS_ENV_KEYS = [
        'GOOGLE_SHEETS_SPREADSHEET_ID',
        'GOOGLE_SERVICE_ACCOUNT_EMAIL',
        'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
        'GOOGLE_SHEETS_TAB_NAME'
    ];

    async function withEnv(overrides, fn) {
        const saved = {};
        for (const k of SHEETS_ENV_KEYS) saved[k] = process.env[k];
        const savedFetch = globalThis.fetch;
        try {
            for (const k of SHEETS_ENV_KEYS) delete process.env[k];
            for (const [k, v] of Object.entries(overrides)) process.env[k] = v;
            return await fn();
        } finally {
            for (const k of SHEETS_ENV_KEYS) {
                if (saved[k] === undefined) delete process.env[k];
                else process.env[k] = saved[k];
            }
            globalThis.fetch = savedFetch;
        }
    }

    // A real key pair — createSign() genuinely signs with this, so the
    // signature assertions below are meaningful rather than shape-only.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    const CONFIGURED = {
        GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-abc-123',
        GOOGLE_SERVICE_ACCOUNT_EMAIL: 'svc@mocof.iam.gserviceaccount.com',
        GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey
    };

    // Routes the two calls logDepositToSheet makes (token exchange, then the
    // Sheets append) and records both so they can be asserted on.
    function stubFetch({ tokenOk = true, appendOk = true } = {}) {
        const calls = [];
        globalThis.fetch = async (url, options) => {
            calls.push({ url: String(url), options });
            if (String(url).includes('oauth2.googleapis.com')) {
                return tokenOk
                    ? { ok: true,  json: async () => ({ access_token: 'test-token-xyz' }) }
                    : { ok: false, status: 401, text: async () => 'invalid_grant' };
            }
            return appendOk
                ? { ok: true,  json: async () => ({}) }
                : { ok: false, status: 403, text: async () => 'caller lacks permission' };
        };
        return calls;
    }

    const DETAILS = {
        quoteRef: 'MQS-20260826-ABC234',
        wallBedModel: 'Murano Queen Sofa',
        grandTotal: '31234.56',
        depositPercent: '10',
        depositAmountPaid: '3123.46',
        customerEmail: 'customer@example.com',
        customerName: 'Aisyah Binti Rahman',
        customerPhone: '+60123456789',
        stripeSessionId: 'cs_test_123',
        cabinets: 'Yes',
        depositOptionLabel: 'Fixed RM 2,500.00',
        productLabel: 'Murano Queen Sofa'
    };

    function sheetsCall(calls) {
        const call = calls.find(c => c.url.includes('sheets.googleapis.com'));
        assert.ok(call, 'expected a Sheets append request');
        return call;
    }

    // ── base64url ──
    test('base64url produces URL-safe output with no +, / or = characters', () => {
        // Bytes chosen so the standard base64 encoding actually contains the
        // characters being replaced — otherwise this would pass vacuously.
        const bytes = Buffer.from([0xff, 0xfe, 0xfd, 0xfc, 0x00]);
        assert.match(bytes.toString('base64'), /[+/=]/, 'test input must exercise the replacements');
        assert.doesNotMatch(base64url(bytes), /[+/=]/);
    });

    test('base64url output decodes back to the original value', () => {
        const original = JSON.stringify({ alg: 'RS256', typ: 'JWT' });
        assert.equal(Buffer.from(base64url(original), 'base64url').toString('utf8'), original);
    });

    // ── normalizePrivateKey ──
    // Vercel's env var UI stores multi-line values with literal backslash-n,
    // which createSign() rejects outright — the most likely cause of Sheets
    // logging working locally but failing in production.
    test('normalizePrivateKey restores real newlines from literal \\n escapes', () => {
        const escaped = '-----BEGIN PRIVATE KEY-----\\nMIIabc\\n-----END PRIVATE KEY-----\\n';
        const normalized = normalizePrivateKey(escaped);
        assert.doesNotMatch(normalized, /\\n/, 'no literal backslash-n should survive');
        assert.equal(normalized.split('\n').length, 4);
    });

    test('normalizePrivateKey leaves an already-correct PEM untouched', () => {
        assert.equal(normalizePrivateKey(privateKey), privateKey);
    });

    test('a key mangled by Vercel-style escaping still round-trips to the original PEM', () => {
        const escaped = privateKey.replace(/\n/g, '\\n');
        assert.notEqual(escaped, privateKey, 'the escaped form must actually differ');
        assert.equal(normalizePrivateKey(escaped), privateKey);
    });

    // ── getAccessToken / JWT assembly ──
    test('getAccessToken sends a correctly signed RS256 JWT and returns the token', async () => {
        await withEnv(CONFIGURED, async () => {
            const calls = stubFetch();
            const token = await getAccessToken(CONFIGURED.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey);
            assert.equal(token, 'test-token-xyz');
            assert.equal(calls.length, 1);

            const assertion = new URLSearchParams(calls[0].options.body).get('assertion');
            const [h, c, sig] = assertion.split('.');
            assert.ok(h && c && sig, 'assertion must be a three-part JWT');

            assert.deepEqual(
                JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
                { alg: 'RS256', typ: 'JWT' }
            );

            const claims = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
            assert.equal(claims.iss, CONFIGURED.GOOGLE_SERVICE_ACCOUNT_EMAIL);
            assert.equal(claims.aud, 'https://oauth2.googleapis.com/token');
            assert.equal(claims.scope, 'https://www.googleapis.com/auth/spreadsheets');
            assert.equal(claims.exp - claims.iat, 3600, 'Google rejects a JWT valid for longer than an hour');

            // The signature must verify against the matching public key — this
            // is what proves the hand-rolled signing is actually correct, not
            // merely well-shaped.
            const verifier = createVerify('RSA-SHA256');
            verifier.update(h + '.' + c);
            verifier.end();
            assert.ok(
                verifier.verify(publicKey, Buffer.from(sig, 'base64url')),
                'JWT signature failed to verify against its own key pair'
            );
        });
    });

    test('getAccessToken throws when Google rejects the token exchange', async () => {
        await withEnv(CONFIGURED, async () => {
            stubFetch({ tokenOk: false });
            await assert.rejects(
                () => getAccessToken(CONFIGURED.GOOGLE_SERVICE_ACCOUNT_EMAIL, privateKey),
                /token exchange failed: 401/
            );
        });
    });

    // ── logDepositToSheet: the graceful-no-op contract ──
    test('does nothing and makes no network call when Sheets config is absent', async () => {
        await withEnv({}, async () => {
            const calls = stubFetch();
            await logDepositToSheet(DETAILS);
            assert.equal(calls.length, 0, 'must not attempt any request when unconfigured');
        });
    });

    test('a partially-configured environment is still treated as unconfigured', async () => {
        // All three vars are required; one alone must not trigger a doomed call.
        await withEnv({ GOOGLE_SHEETS_SPREADSHEET_ID: 'sheet-abc-123' }, async () => {
            const calls = stubFetch();
            await logDepositToSheet(DETAILS);
            assert.equal(calls.length, 0);
        });
    });

    // stripe-webhook.js awaits this inside Promise.all — any throw here becomes
    // a 500 and makes Stripe retry an event that was already processed.
    test('never throws, whatever fails downstream', async () => {
        await withEnv(CONFIGURED, async () => {
            stubFetch({ tokenOk: false });
            await assert.doesNotReject(() => logDepositToSheet(DETAILS));
        });
        await withEnv(CONFIGURED, async () => {
            stubFetch({ appendOk: false });
            await assert.doesNotReject(() => logDepositToSheet(DETAILS));
        });
        await withEnv(CONFIGURED, async () => {
            globalThis.fetch = async () => { throw new Error('socket hang up'); };
            await assert.doesNotReject(() => logDepositToSheet(DETAILS));
        });
        await withEnv({ ...CONFIGURED, GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: 'not-a-pem' }, async () => {
            stubFetch();
            await assert.doesNotReject(() => logDepositToSheet(DETAILS));
        });
    });

    // ── logDepositToSheet: the appended row ──
    test('appends the thirteen deposit fields in the documented column order', async () => {
        await withEnv(CONFIGURED, async () => {
            const calls = stubFetch();
            await logDepositToSheet(DETAILS);

            const append = sheetsCall(calls);
            assert.equal(append.options.headers.Authorization, 'Bearer test-token-xyz');

            const [row] = JSON.parse(append.options.body).values;
            assert.equal(row.length, 13);
            assert.ok(!isNaN(Date.parse(row[0])), 'column A must be an ISO timestamp');
            // The three contact fields sit together (G, H, I) — Stripe Session
            // ID and Cabinets follow them, NOT the other way round.
            assert.deepEqual(row.slice(1), [
                DETAILS.quoteRef,
                DETAILS.wallBedModel,
                DETAILS.grandTotal,
                DETAILS.depositPercent,
                DETAILS.depositAmountPaid,
                DETAILS.customerEmail,
                DETAILS.customerName,
                DETAILS.customerPhone,
                DETAILS.stripeSessionId,
                DETAILS.cabinets,
                DETAILS.depositOptionLabel,
                DETAILS.productLabel
            ]);
        });
    });

    // Drift guard, in the spirit of the rest of this file: the row is written
    // into a fixed range. Adding a field without widening that range would let
    // the Sheets API silently truncate it. Deliberately derives the expected
    // width from the range itself rather than hardcoding a number, so it keeps
    // working as columns are added.
    test('the row width matches the range it is written into', async () => {
        await withEnv(CONFIGURED, async () => {
            const calls = stubFetch();
            await logDepositToSheet(DETAILS);

            const append = sheetsCall(calls);
            const range = decodeURIComponent(append.url.match(/values\/(.+?):append/)[1]);
            const [, firstCol, lastCol] = range.match(/!([A-Z]+):([A-Z]+)$/);
            const width = lastCol.charCodeAt(0) - firstCol.charCodeAt(0) + 1;

            const [row] = JSON.parse(append.options.body).values;
            assert.equal(width, row.length, 'range ' + range + ' holds ' + width + ' columns but the row has ' + row.length);
        });
    });

    test('missing optional detail fields become empty strings, never the string "undefined"', async () => {
        await withEnv(CONFIGURED, async () => {
            const calls = stubFetch();
            await logDepositToSheet({ stripeSessionId: 'cs_test_only' });

            const [row] = JSON.parse(sheetsCall(calls).options.body).values;
            assert.equal(row.length, 13);
            assert.deepEqual(row.slice(1, 9), ['', '', '', '', '', '', '', ''],
                'every unset field, contact details included, must be an empty string');
            assert.equal(row[9], 'cs_test_only');
            assert.equal(row[10], '', 'a session with no cabinets metadata logs an empty cell, not "undefined"');
            assert.equal(row[11], '', 'a session with no deposit option metadata logs an empty cell, not "undefined"');
            assert.equal(row[12], '', 'a session with no product metadata logs an empty cell, not "undefined"');
        });
    });

    test('GOOGLE_SHEETS_TAB_NAME overrides the default "Deposits" tab', async () => {
        await withEnv(CONFIGURED, async () => {
            const calls = stubFetch();
            await logDepositToSheet(DETAILS);
            assert.match(decodeURIComponent(sheetsCall(calls).url), /Deposits!A:M/);
        });

        await withEnv({ ...CONFIGURED, GOOGLE_SHEETS_TAB_NAME: 'Live Deposits' }, async () => {
            const calls = stubFetch();
            await logDepositToSheet(DETAILS);
            const url = sheetsCall(calls).url;
            assert.match(decodeURIComponent(url), /Live Deposits!A:M/);
            assert.doesNotMatch(url, /Live Deposits/, 'a tab name with a space must be URL-encoded in the request');
        });
    });
});


// ── Wall-bed-only deposits ──────────────────────────────────────
// A second deposit path: a customer who never raised cabinetry can pay a
// deposit on the wall bed's sale price alone. The gating below is the
// payment-critical part — see getDepositBasisFromContext() in api/chat.js.
describe('wall-bed-only deposit path', () => {

    // An availability question ALONE is not a reason to ask for money — that
    // fixture now lives in INFO_ONLY below and expects null. These fixtures
    // carry the customer actually saying they want the bed.
    const INFO_ONLY = [
        { role: 'user', content: 'Do you have a Murano Queen?' },
        { role: 'assistant', content: 'Yes — the Murano Queen is one of our vertical wall beds.' }
    ];

    const WALLBED_ONLY = [
        ...INFO_ONLY,
        { role: 'user', content: 'I want the Murano Queen' },
        { role: 'assistant', content: 'Great choice — the Murano Queen is RM 23,698.11 sale.' }
    ];

    test('offers a deposit on the wall bed sale price when cabinetry never came up', () => {
        const basis = getDepositBasisFromContext('How much is it?', WALLBED_ONLY);
        assert.ok(basis, 'expected a deposit basis');
        assert.equal(basis.type, DEPOSIT_TYPE_WALLBED_ONLY);
        assert.equal(basis.wallBedModelLabel, 'Murano Queen');

        // Must be the model's own sale price from WALLBED_MODEL_PRICING —
        // never a figure invented here or carried over from a cabinetry quote.
        const priced = WALLBED_MODEL_PRICING.find(m => m.label === 'Murano Queen');
        assert.equal(basis.total, priced.sale);

        // No wall is being surveyed, so there are no measurements to record.
        assert.equal(basis.heightFt, null);
        assert.equal(basis.totalWidthFt, null);
    });

    test('computeDepositOffer surfaces the type and a 10% amount', () => {
        const offer = computeDepositOffer('How much is it?', WALLBED_ONLY);
        assert.ok(offer);
        assert.equal(offer.depositType, DEPOSIT_TYPE_WALLBED_ONLY);
        assert.equal(offer.depositPercent, DEPOSIT_PERCENT);
        assert.equal(offer.depositAmount, round2(offer.grandTotal * DEPOSIT_PERCENT / 100));
    });

    // Price wording is still not required on this path — the bed's sale price is
    // a fixed catalog figure. What IS required is purchase intent, so this
    // fixture supplies it without ever saying "how much".
    test('does not require an explicit price question, only purchase intent', () => {
        assert.equal(hasPriceIntent('I will take it', WALLBED_ONLY), false,
            'fixture must genuinely contain no price wording');
        const basis = getDepositBasisFromContext('I will take it', WALLBED_ONLY);
        assert.ok(basis, 'purchase intent without a price question should still offer');
        assert.equal(basis.type, DEPOSIT_TYPE_WALLBED_ONLY);
    });

    // The regression this gate exists for: asking whether a product exists,
    // even with a price question attached, is not asking to buy it.
    test('an availability or price question alone offers nothing', () => {
        assert.equal(getDepositBasisFromContext('How much is it?', INFO_ONLY), null);
        assert.equal(computeDepositOffer('How much is it?', INFO_ONLY), null);
        assert.equal(getDepositBasisFromContext('I like that one', INFO_ONLY), null,
            'liking a bed is not asking to reserve it');
    });

    test('returns null when no specific model has been established', () => {
        const vague = [{ role: 'user', content: 'Tell me about your wall beds.' }];
        assert.equal(getDepositBasisFromContext('How much are they?', vague), null);
    });

    // The core safety property of this path. Mid-cabinetry-flow the combined
    // estimate is legitimately unavailable while measurements are collected —
    // falling through to a cheaper wall-bed-only deposit there would offer a
    // payment for less than the quote being assembled.
    test('is suppressed the moment cabinetry is mentioned, even before any measurement', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen with cabinets, how much in total?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' }
        ];
        assert.equal(hasCabinetryIntent('11ft', history), true);
        assert.equal(getDepositBasisFromContext('11ft', history), null);
        assert.equal(computeDepositOffer('11ft', history), null);
    });

    test('is suppressed when the ASSISTANT is the one who raised cabinetry', () => {
        const history = [
            { role: 'user', content: 'I like the Murano Queen.' },
            { role: 'assistant', content: 'We can also build surround cabinetry around it. How much storage do you need?' }
        ];
        assert.equal(hasCabinetryIntent('What would that cost?', history), true);
        assert.equal(getDepositBasisFromContext('What would that cost?', history), null);
    });

    // Phrasings the cabinetry ROUTING regex in KNOWLEDGE_MODULES deliberately
    // does not match — it is narrow so a generic "cabinet" can't claim a
    // knowledge slot. This gate must be broader, because here a miss offers the
    // wrong payment rather than merely loading the wrong knowledge module.
    test('catches cabinetry phrasings the narrower routing regex misses', () => {
        const routing = KNOWLEDGE_MODULES.find(m => m.key === 'cabinetry').test;
        for (const phrase of [
            'i want a murano queen with cabinets, how much in total?',
            'can i add cabinets around it',
            'what about some cabinetry too'
        ]) {
            assert.equal(routing.test(phrase), false, 'fixture must be one the routing regex misses: ' + phrase);
            assert.equal(hasCabinetryIntent(phrase, []), true, 'deposit gate must still catch: ' + phrase);
        }
    });

    test('a completed cabinetry estimate still takes precedence and reports the combined type', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen Sofa with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        const basis = getDepositBasisFromContext('10ft', history);
        assert.ok(basis);
        assert.equal(basis.type, DEPOSIT_TYPE_WITH_CABINETRY);

        // Strictly more than the bed alone — the combined total, not a fallback.
        const bed = WALLBED_MODEL_PRICING.find(m => m.label === 'Murano Queen Sofa');
        assert.ok(basis.total > bed.sale, 'combined total must exceed the wall bed price alone');
    });

    // Regression: taking money for a bed that cannot be installed. Applies to
    // BOTH paths — the cabinetry flow only ever blocked walls under the 7ft
    // side-cabinet minimum, so a 7ft-2.4m ceiling with a Murano previously
    // produced a priced estimate and an offered deposit regardless.
    test('never offers a deposit on a Murano below the 2.4m ceiling minimum', () => {
        const wallbedOnly = [
            { role: 'assistant', content: "The Murano Queen would suit that room." },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        assert.ok(detectMuranoCeilingConflict('7.5ft', wallbedOnly), 'fixture must be a real ceiling conflict');
        assert.equal(getDepositBasisFromContext('7.5ft, how much?', wallbedOnly), null);

        const withCabinetry = [
            { role: 'user', content: 'Murano Queen with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '7.5ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        // The cabinetry estimate itself still computes (7.5ft clears the 7ft
        // cabinetry minimum) — it is the deposit that must be withheld.
        const est = getCabinetryEstimateFromContext('12ft', withCabinetry);
        assert.ok(est && !est.blocked, 'cabinetry is still buildable at 7.5ft');
        assert.equal(getDepositBasisFromContext('12ft', withCabinetry), null);
        assert.equal(computeDepositOffer('12ft', withCabinetry), null);
    });

    test('a Gioco at the same low ceiling is unaffected', () => {
        const history = [
            { role: 'assistant', content: 'The Gioco Single suits a low ceiling.' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        const basis = getDepositBasisFromContext('7.5ft, I want to buy it', history);
        assert.ok(basis, 'Gioco is rated for low ceilings and must still be depositable');
        assert.equal(basis.type, DEPOSIT_TYPE_WALLBED_ONLY);
    });

    // Both deposit type values reach Stripe metadata and then the Sheet, so
    // they are a stored format: changing one silently orphans every row
    // already logged under the old value.
    test('deposit type identifiers are the exact strings written to the Sheet', () => {
        assert.equal(DEPOSIT_TYPE_WITH_CABINETRY, 'wallbed_with_cabinetry');
        assert.equal(DEPOSIT_TYPE_WALLBED_ONLY, 'wallbed_only');
    });
});


// Runs logDepositToSheet() against a stubbed fetch and returns the row it tried
// to append. Shares the same offline approach as the sheetsLogger suite above.
async function captureSheetRow(details) {
    const saved = {
        id: process.env.GOOGLE_SHEETS_SPREADSHEET_ID,
        email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        key: process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
    };
    const savedFetch = globalThis.fetch;
    const { privateKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding:  { type: 'spki',  format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    try {
        process.env.GOOGLE_SHEETS_SPREADSHEET_ID = 'sheet-x';
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = 'svc@x.iam.gserviceaccount.com';
        process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey;

        let row = null;
        globalThis.fetch = async (url, options) => {
            if (String(url).includes('oauth2.googleapis.com')) {
                return { ok: true, json: async () => ({ access_token: 't' }) };
            }
            row = JSON.parse(options.body).values[0];
            return { ok: true, json: async () => ({}) };
        };
        await logDepositToSheet(details);
        return row;
    } finally {
        if (saved.id === undefined) delete process.env.GOOGLE_SHEETS_SPREADSHEET_ID; else process.env.GOOGLE_SHEETS_SPREADSHEET_ID = saved.id;
        if (saved.email === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL; else process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = saved.email;
        if (saved.key === undefined) delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY; else process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = saved.key;
        globalThis.fetch = savedFetch;
    }
}


// ── The Sheet's Cabinets column ─────────────────────────────────
// Yes/No is what MOCOF reads in the spreadsheet; it is derived from the
// deposit type rather than tracked separately so the two cannot disagree.
describe('deposit "Cabinets" Yes/No mapping', () => {
    test('maps each deposit type to the value written into the Sheet', () => {
        assert.equal(depositIncludesCabinets(DEPOSIT_TYPE_WITH_CABINETRY), 'Yes');
        assert.equal(depositIncludesCabinets(DEPOSIT_TYPE_WALLBED_ONLY), 'No');
    });

    // A future third deposit type must not be silently recorded as "No" — a
    // confident wrong answer in a business record is worse than a blank cell
    // that visibly needs attention.
    test('an unrecognised or missing type yields a blank cell, never a wrong "No"', () => {
        assert.equal(depositIncludesCabinets('kitchen_only'), '');
        assert.equal(depositIncludesCabinets(undefined), '');
        assert.equal(depositIncludesCabinets(null), '');
        assert.equal(depositIncludesCabinets(''), '');
    });

    // Ties the mapping to what the deposit flow actually produces, so adding a
    // deposit type without extending the mapping fails here rather than in a
    // spreadsheet weeks later.
    test('every deposit type the flow can produce has a Yes/No, not a blank', () => {
        const wallbedOnly = getDepositBasisFromContext('How much is it?', [
            { role: 'user', content: 'Do you have a Murano Queen?' },
            { role: 'assistant', content: 'Yes — the Murano Queen is available.' },
            { role: 'user', content: 'I want the Murano Queen' },
            { role: 'assistant', content: 'Great — it is RM 23,698.11 sale.' }
        ]);
        const withCabinetry = getDepositBasisFromContext('10ft', [
            { role: 'user', content: 'Murano Queen Sofa with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ]);

        for (const basis of [wallbedOnly, withCabinetry]) {
            assert.ok(basis, 'fixture should produce a deposit basis');
            const flag = depositIncludesCabinets(basis.type);
            assert.ok(flag === 'Yes' || flag === 'No', 'unmapped deposit type: ' + basis.type);
        }

        assert.equal(depositIncludesCabinets(wallbedOnly.type), 'No');
        assert.equal(depositIncludesCabinets(withCabinetry.type), 'Yes');
    });

    test('the value reaches the Sheet row in the Cabinets column', async () => {
        // Guards the wiring, not just the mapping: create-deposit.js puts this
        // in Stripe metadata, the webhook reads it back, sheetsLogger writes it
        // to column I.
        const written = await captureSheetRow({ stripeSessionId: 'cs_x', cabinets: 'No' });
        assert.equal(written.length, 13);
        assert.equal(written[10], 'No');
    });
});


// ── Customer contact fields ─────────────────────────────────────
// Name, email and phone all come from Stripe's hosted checkout via
// session.customer_details (see api/create-deposit.js's
// phone_number_collection / billing_address_collection) — the chat widget
// never asks for them. These pin the Sheet side of that.
describe('customer contact columns (name / email / phone)', () => {

    test('the three contact fields are adjacent, in G/H/I order', async () => {
        const row = await captureSheetRow({
            customerEmail: 'buyer@example.com',
            customerName: 'Aisyah Binti Rahman',
            customerPhone: '+60123456789',
            stripeSessionId: 'cs_contact',
            cabinets: 'Yes'
        });
        assert.equal(row.length, 13);
        assert.deepEqual(row.slice(6, 9), ['buyer@example.com', 'Aisyah Binti Rahman', '+60123456789']);

        // Everything after the contact block must have shifted with it.
        assert.equal(row[9], 'cs_contact');
        assert.equal(row[10], 'Yes');
    });

    // Stripe may return no name or phone at all (older sessions, or a method
    // that captured neither). A blank cell is correct; the literal string
    // "undefined" reaching a business record is not.
    test('a session with no name or phone logs blanks, not "undefined"', async () => {
        const row = await captureSheetRow({
            customerEmail: 'buyer@example.com',
            stripeSessionId: 'cs_no_contact'
        });
        assert.equal(row[7], '');
        assert.equal(row[8], '');
        assert.ok(!row.some(cell => String(cell).includes('undefined')), 'no cell may contain "undefined"');
    });

    // A phone number must survive verbatim — Malaysian numbers begin with a
    // leading + that a naive numeric coercion would strip.
    test('a phone number is written verbatim, keeping its leading +', async () => {
        const row = await captureSheetRow({ customerPhone: '+60123456789', stripeSessionId: 'cs_p' });
        assert.equal(row[8], '+60123456789');
        assert.equal(typeof row[8], 'string');
    });
});


// ── Per-model side-cabinet height ───────────────────────────────
// Side cabinets used to be a flat 7ft for every series. That is right for
// Murano (209.5cm bed, 7ft module) but badly wrong for Gioco, which is the
// horizontal-fold series and mounts far shorter — and it is not one height
// across Gioco either, so this has to be per-model rather than per-series.
describe('side-cabinet height is per wall bed model', () => {

    const GIOCO_WIDTH_FT = 6.71; // all Gioco variants share one width

    test('the height table matches the cm figures printed in the wall bed prose', () => {
        const prose = getWallBedKnowledge();
        for (const model of WALLBED_MODEL_HEIGHTS_FT) {
            // Only models that actually print a Height: line can be checked.
            const line = new RegExp('Height:\\s*' + String(model.heightCm).replace('.', '\\.') + 'cm');
            if (!line.test(prose)) continue;
            const expectedFt = Math.round((model.heightCm / 30.48) * 100) / 100;
            assert.equal(model.heightFt, expectedFt,
                model.label + ': ' + model.heightCm + 'cm should be ' + expectedFt + 'ft, table says ' + model.heightFt);
        }
    });

    test('every priced model resolves to a height entry', () => {
        for (const priced of WALLBED_MODEL_PRICING) {
            const match = WALLBED_MODEL_HEIGHTS_FT.find(h => h.pattern.test(priced.label));
            assert.ok(match, 'no height entry matches priced model: ' + priced.label);
        }
    });

    // Murano must be untouched by this change.
    test('every Murano model keeps the flat 7ft side cabinet', () => {
        for (const label of ['Murano Queen', 'Murano Queen Sofa', 'Murano Queen Desk', 'Murano Queen Shelves', 'Murano Single', 'Murano King']) {
            assert.equal(resolveSideCabinetHeightFt(label), SIDE_CABINET_MAX_HEIGHT_FT, label + ' must stay at the flat 7ft');
        }
    });

    // The heart of the fix: Gioco heights differ BETWEEN Gioco models, so a
    // single blanket "Gioco height" would be wrong for most of them.
    test('each Gioco model gets its own height, not one shared series value', () => {
        assert.equal(resolveSideCabinetHeightFt('Gioco Single'), 3.44);
        assert.equal(resolveSideCabinetHeightFt('Gioco Single Desk'), 3.44);
        assert.equal(resolveSideCabinetHeightFt('Gioco Queen'), 5.58);
        assert.equal(resolveSideCabinetHeightFt('Gioco Bunk Bed'), 6.92);

        const distinct = new Set(['Gioco Single', 'Gioco Queen', 'Gioco Bunk Bed'].map(resolveSideCabinetHeightFt));
        assert.equal(distinct.size, 3, 'these three Gioco models must NOT collapse to one height');
    });

    // A bare "Gioco" is what the coarse WALLBED_MODEL_WIDTHS_FT table yields;
    // it cannot identify the variant, so the safe answer is the old constant.
    test('an unidentifiable model falls back to the flat 7ft, not a guess', () => {
        assert.equal(resolveSideCabinetHeightFt('Gioco'), SIDE_CABINET_MAX_HEIGHT_FT);
        assert.equal(resolveSideCabinetHeightFt(null), SIDE_CABINET_MAX_HEIGHT_FT);
        assert.equal(resolveSideCabinetHeightFt(''), SIDE_CABINET_MAX_HEIGHT_FT);
        assert.equal(resolveSideCabinetHeightFt('Some Future Bed'), SIDE_CABINET_MAX_HEIGHT_FT);
    });

    test('worked example 5 — Gioco Single, 9ft wall, 12ft total width', () => {
        const r = calculateCabinetPrice({
            wallHeightFt: 9, wallBedWidthFt: GIOCO_WIDTH_FT, totalWallWidthFt: 12,
            sideCabinetHeightFt: resolveSideCabinetHeightFt('Gioco Single')
        });
        assert.equal(r.sideCabinetWidthFt, 2.65);
        assert.equal(r.sideCostPerSide, 3577.5);
        assert.equal(r.sideCostTotal, 7155);
        assert.equal(r.topCost, 10200);
        assert.equal(r.total, 17355);
        assert.equal(r.sideCabinetMaxHeightFt, 3.44);
        assert.equal(r.overheadCabinetHeightFt, 4);      // hits the cap
        assert.equal(r.uncoveredWallHeightFt, 1.56);     // bare wall above
    });

    test('worked example 6 — Gioco Queen, same wall: same price, different heights', () => {
        const r = calculateCabinetPrice({
            wallHeightFt: 9, wallBedWidthFt: GIOCO_WIDTH_FT, totalWallWidthFt: 12,
            sideCabinetHeightFt: resolveSideCabinetHeightFt('Gioco Queen')
        });
        assert.equal(r.total, 17355, 'price must be identical to the Gioco Single case');
        assert.equal(r.sideCabinetMaxHeightFt, 5.58);
        assert.equal(r.overheadCabinetHeightFt, 3.42);   // under the cap
        assert.equal(r.uncoveredWallHeightFt, 0);
    });

    // Price is width-driven, so the whole per-model change must move no money.
    test('changing the side-cabinet height never changes the price', () => {
        const base = { wallHeightFt: 9, wallBedWidthFt: GIOCO_WIDTH_FT, totalWallWidthFt: 12 };
        const totals = [3.44, 5.58, 6.92, 7].map(h =>
            calculateCabinetPrice({ ...base, sideCabinetHeightFt: h }).total);
        assert.equal(new Set(totals).size, 1, 'totals diverged across heights: ' + totals.join(', '));
    });

    test('omitting sideCabinetHeightFt keeps the original flat-7ft behaviour', () => {
        const base = { wallHeightFt: 11, wallBedWidthFt: 5.5, totalWallWidthFt: 10 };
        const implicit = calculateCabinetPrice(base);
        const explicit = calculateCabinetPrice({ ...base, sideCabinetHeightFt: SIDE_CABINET_MAX_HEIGHT_FT });
        assert.deepEqual(implicit, explicit);
        assert.equal(implicit.sideCabinetMaxHeightFt, 7);
    });

    test('rejects a non-positive side-cabinet height', () => {
        const base = { wallHeightFt: 9, wallBedWidthFt: GIOCO_WIDTH_FT, totalWallWidthFt: 12 };
        assert.throws(() => calculateCabinetPrice({ ...base, sideCabinetHeightFt: 0 }), /sideCabinetHeightFt/);
        assert.throws(() => calculateCabinetPrice({ ...base, sideCabinetHeightFt: -1 }), /sideCabinetHeightFt/);
    });
});

// ── Ripple: the "wall too short" gate is per-model too ───────────
// Gating this on the flat 7ft rejected walls that comfortably fit a short
// Gioco — the same bug as the pricing side, in the opposite direction.
describe('WALL_TOO_SHORT_FOR_CABINETRY uses the per-model minimum', () => {

    const GIOCO_WIDTH_FT = 6.71;

    test('a 5ft wall is fine for a Gioco Single but too short for a Murano', () => {
        const gioco = calculateCabinetPrice({
            wallHeightFt: 5, wallBedWidthFt: GIOCO_WIDTH_FT, totalWallWidthFt: 12,
            sideCabinetHeightFt: resolveSideCabinetHeightFt('Gioco Single')
        });
        assert.equal(gioco.total, 17355);
        assert.equal(gioco.overheadCabinetHeightFt, 1.56);

        assert.throws(
            () => calculateCabinetPrice({
                wallHeightFt: 5, wallBedWidthFt: 5.48, totalWallWidthFt: 12,
                sideCabinetHeightFt: resolveSideCabinetHeightFt('Murano Queen')
            }),
            (err) => err.code === 'WALL_TOO_SHORT_FOR_CABINETRY' && err.minHeightFt === 7
        );
    });

    test('the reported minimum is that model own height, not the flat constant', () => {
        try {
            calculateCabinetPrice({
                wallHeightFt: 3, wallBedWidthFt: GIOCO_WIDTH_FT, totalWallWidthFt: 12,
                sideCabinetHeightFt: resolveSideCabinetHeightFt('Gioco Queen')
            });
            assert.fail('expected a too-short error');
        } catch (err) {
            assert.equal(err.code, 'WALL_TOO_SHORT_FOR_CABINETRY');
            assert.equal(err.minHeightFt, 5.58);
        }
    });

    // End-to-end through the conversation wiring, which is where the model
    // has to be resolved off the GRANULAR pricing table — the coarse width
    // table labels every Gioco variant just "Gioco" and cannot tell them apart.
    test('getCabinetryEstimateFromContext prices a 5ft wall for a Gioco Single', () => {
        const history = [
            { role: 'user', content: 'I want a Gioco Single with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '5ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        const est = getCabinetryEstimateFromContext('12ft', history);
        assert.ok(est, 'expected an estimate');
        assert.ok(!est.blocked, 'a 5ft wall must NOT be blocked for a 3.44ft Gioco Single');
        assert.equal(est.sideCabinetMaxHeightFt, 3.44);
        assert.equal(est.total, 17355);
    });

    test('the same 5ft wall is still blocked for a Murano', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '5ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        const est = getCabinetryEstimateFromContext('12ft', history);
        assert.ok(est && est.blocked, 'expected a blocked result');
        assert.equal(est.reason, 'WALL_TOO_SHORT_FOR_CABINETRY');
        assert.equal(est.minHeightFt, 7);
    });
});


// ── When the deposit offer surfaces ─────────────────────────────
// The trigger was broadened from "only after a full wall bed + cabinetry
// estimate" to "after any specific wall bed has been discussed". The risk that
// creates is downgrading a cabinetry customer to the cheaper bed-only deposit,
// so most of these tests exist to pin that it does NOT happen.
describe('deposit offer trigger', () => {

    // An availability question and its priced answer — informational only, and
    // deliberately NOT enough to offer a deposit on its own.
    const PLAIN_WALLBED_INFO = [
        { role: 'user', content: 'Do you have a Murano Queen?' },
        { role: 'assistant', content: 'Yes — the Murano Queen is RM 19,102.22 retail | RM 14,371.55 sale.' }
    ];

    // The same conversation, once the customer says they actually want it.
    const PLAIN_WALLBED = [
        ...PLAIN_WALLBED_INFO,
        { role: 'user', content: 'I want the Murano Queen' },
        { role: 'assistant', content: 'Great choice.' }
    ];

    // (a) the new behaviour
    test('a plain wall-bed conversation surfaces a wallbed_only offer', () => {
        const offer = computeDepositOffer('Sounds good', PLAIN_WALLBED);
        assert.ok(offer, 'expected a deposit offer after discussing a specific model');
        assert.equal(offer.depositType, DEPOSIT_TYPE_WALLBED_ONLY);
        assert.equal(offer.wallBedModelLabel, 'Murano Queen');

        const priced = WALLBED_MODEL_PRICING.find(m => m.label === 'Murano Queen');
        assert.equal(offer.grandTotal, priced.sale, 'must charge against the bed sale price');
        assert.equal(offer.depositAmount, round2(priced.sale * DEPOSIT_PERCENT / 100));
    });

    test('no offer until a specific model is actually settled', () => {
        const browsing = [
            { role: 'user', content: 'Tell me about your wall beds.' },
            { role: 'assistant', content: 'We have two series to choose from. What is your ceiling height?' }
        ];
        assert.equal(computeDepositOffer('Around 9ft', browsing), null,
            'a browsing conversation with no model chosen must not offer a deposit');
    });

    // (b) the cabinetry path must be untouched by the broadened trigger
    test('a mid-cabinetry customer is never downgraded to wallbed_only', () => {
        const midFlow = [
            { role: 'user', content: 'I want a Murano Queen Sofa with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        // Height known, total width still outstanding -> no combined estimate yet.
        assert.equal(getCabinetryEstimateFromContext('11ft', midFlow), null);
        assert.equal(computeDepositOffer('11ft', midFlow), null,
            'must offer nothing rather than fall back to the cheaper bed-only deposit');
    });

    test('cabinetry intent suppresses the bed-only offer even with no price question', () => {
        const cabinetryNoPrice = [
            { role: 'user', content: 'Can I add cabinets around a Murano Queen?' },
            { role: 'assistant', content: 'Yes, surround cabinetry can be built around it.' }
        ];
        assert.equal(hasPriceIntent('ok great', cabinetryNoPrice), false);
        assert.equal(hasCabinetryIntent('ok great', cabinetryNoPrice), true);
        assert.equal(computeDepositOffer('ok great', cabinetryNoPrice), null);
    });

    test('a completed cabinetry estimate still offers the combined total', () => {
        const done = [
            { role: 'user', content: 'Murano Queen Sofa with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        const offer = computeDepositOffer('10ft', done);
        assert.ok(offer);
        assert.equal(offer.depositType, DEPOSIT_TYPE_WITH_CABINETRY);

        const bed = WALLBED_MODEL_PRICING.find(m => m.label === 'Murano Queen Sofa');
        assert.ok(offer.grandTotal > bed.sale, 'combined total must exceed the bed alone');
    });

    // The cabinetry path keeps its own price-intent gate — only the bed-only
    // path was broadened. This is what stops the button preceding the estimate.
    test('the cabinetry path still waits for an explicit price question', () => {
        const noPriceAsked = [
            { role: 'user', content: 'I want a Murano Queen Sofa with side cabinets around it.' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        assert.equal(hasPriceIntent('10ft', noPriceAsked), false);
        assert.equal(computeDepositOffer('10ft', noPriceAsked), null,
            'every measurement is known but no price was ever asked — offer nothing');
    });

    test('an uninstallable Murano is still refused on the broadened trigger', () => {
        const lowCeiling = [
            { role: 'assistant', content: 'The Murano Queen would suit that room.' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        assert.ok(detectMuranoCeilingConflict('7.5ft', lowCeiling), 'fixture must be a real conflict');
        assert.equal(computeDepositOffer('7.5ft', lowCeiling), null);
    });
});

// ── The prompt-side half of the same change ─────────────────────
describe('system prompt — reservation deposit instruction', () => {
    const prompt = buildSystemPrompt('Tell me about the Murano Queen', []);

    test('tells the model to invite a deposit once a specific model is settled', () => {
        assert.match(prompt, /RESERVATION DEPOSIT:/);
        assert.match(prompt, new RegExp(DEPOSIT_PERCENT + '% reservation deposit'));
        assert.match(prompt, /SPECIFIC wall bed model/);
    });

    test('states it applies without cabinetry, and must use the grand total when cabinetry is in play', () => {
        assert.match(prompt, /do not need to wait for cabinetry to come up/i);
        assert.match(prompt, /GRAND TOTAL/);
        assert.match(prompt, /never against the wall bed price alone/i);
    });

    // The model must never author payment instructions — the widget renders the
    // button from the structured deposit field, and any RM figure the model
    // invents would be caught by the price guardrail as a hallucination.
    test('bars the model from writing links or stating the deposit amount', () => {
        assert.match(prompt, /NEVER write a payment link/);
        assert.match(prompt, /never\s+state the deposit amount in RM yourself/i);
    });

    // PART C: the model's words have to match the button's gating. If the prompt
    // still said "do not wait for them to ask about paying", the bot would write
    // "would you like to reserve?" on an availability question while the code
    // correctly withheld the button — worse than either behaviour alone.
    test('requires buy/reserve intent, not merely a priced model', () => {
        assert.match(prompt, /signalled they want to buy or reserve/i);
        assert.doesNotMatch(prompt, /Do not wait for them to ask about paying/i,
            'the old always-offer directive must be gone');
    });

    test('tells the model to stay silent about deposits on an info question', () => {
        assert.match(prompt, /only asking whether a product exists/i);
        assert.match(prompt, /Do NOT mention\s+deposits or reserving/i);
    });
});


// ── Purchase intent (PART A) ────────────────────────────────────
// The gate that separates "tell me about the Murano" from "I want the Murano".
// Its bias is deliberately toward under-matching: a missed offer costs a
// customer one extra question, a false one puts a checkout button in front of
// somebody who only asked whether a product exists.
describe('hasPurchaseIntent', () => {

    const BUY = [
        'I want the Murano Single',
        "I'd like the Gioco Queen",
        'I want to buy it',
        'I want to order the Murano',
        'I want to reserve',
        'I want to get one',
        'can I buy it',
        'Can I reserve the Murano Queen?',
        'how do I buy one',
        'How do I reserve?',
        "I'll take it",
        "I'll get it",
        "let's reserve",
        'reserve it',
        'book it',
        'put down a deposit',
        'sign me up',
        'I want this one',
        "I'm ready to buy"
    ];

    // "I want to <informational verb>" is the case a bare /want/ gets wrong, and
    // the reason this pattern is curated rather than a keyword list.
    const INFO = [
        'do you have a Murano Single',
        'is there a Murano Single',
        'do you sell wall beds',
        'is the Murano Single available',
        'tell me about the Murano Single',
        'what is the Murano Single',
        'how much is the Murano Single',
        "what's the price",
        'can you show me the Murano Single',
        'I want to know more',
        'I want to see the Murano Single',
        'I want to learn about wall beds',
        'I want to ask something',
        'I want to compare the Murano and Gioco',
        'I want to check the dimensions',
        'I want to get a quote',
        'I want the price',
        'I want a quote',
        'Sounds good',
        'I like that one'
    ];

    for (const phrase of BUY) {
        test(`matches buy intent: "${phrase}"`, () => {
            assert.equal(hasPurchaseIntent(phrase, []), true);
        });
    }

    for (const phrase of INFO) {
        test(`does not match info question: "${phrase}"`, () => {
            assert.equal(hasPurchaseIntent(phrase, []), false);
        });
    }

    test('scans recent user turns, not just the current message', () => {
        const history = [
            { role: 'user', content: 'I want the Murano Queen' },
            { role: 'assistant', content: 'Great choice.' }
        ];
        assert.equal(hasPurchaseIntent('ok', history), true);
    });

    // The assistant asking "would you like to reserve it?" is not the customer
    // agreeing to — otherwise the bot could talk itself into a deposit offer.
    test('ignores assistant turns', () => {
        const history = [
            { role: 'assistant', content: 'Would you like to reserve it with a 10% deposit?' }
        ];
        assert.equal(hasPurchaseIntent('hmm', history), false);
    });
});


// ── Deposit offers require purchase intent (PART B) ─────────────
// The regression: "Is there a Murano Single?" returned a priced model, and a
// priced model alone used to be enough to render a payment button.
describe('deposit offer requires purchase intent', () => {

    const PRICED = [
        { role: 'user', content: 'Is there a Murano Single?' },
        { role: 'assistant', content: 'Yes — the Murano Single is RM 16,083.40 retail | RM 12,062.55 sale.' }
    ];

    test('an availability question about a priced model offers nothing', () => {
        assert.equal(computeDepositOffer('Is there a Murano Single?', PRICED), null);
        assert.equal(getDepositBasisFromContext('Is there a Murano Single?', PRICED), null);
    });

    // Pins that the fixture is otherwise complete — the null above is caused by
    // the intent gate, not by the model failing to resolve. Without this the
    // test could pass for entirely the wrong reason.
    test('the same fixture DOES offer once intent is expressed', () => {
        const offer = computeDepositOffer('I want the Murano Single', PRICED);
        assert.ok(offer, 'purchase intent should unlock the offer');
        assert.equal(offer.depositType, DEPOSIT_TYPE_WALLBED_ONLY);
        assert.equal(offer.wallBedModelLabel, 'Murano Single');

        const priced = WALLBED_MODEL_PRICING.find(m => m.label === 'Murano Single');
        assert.equal(offer.grandTotal, priced.sale);
    });

    test('intent arriving several turns after the info question still offers', () => {
        const later = [
            ...PRICED,
            { role: 'user', content: 'What colours does it come in?' },
            { role: 'assistant', content: 'Champagne Luxe, Walnut Cocoa and Glacier Mirror.' }
        ];
        assert.equal(computeDepositOffer('ok', later), null, 'still only browsing');

        const offer = computeDepositOffer("I'll take it", later);
        assert.ok(offer, 'expected an offer once the customer commits');
        assert.equal(offer.depositType, DEPOSIT_TYPE_WALLBED_ONLY);
    });

    // PART B explicitly leaves this path alone: assembling a cabinetry grand
    // total already requires a price request plus the customer's own wall
    // measurements, which is a stronger buy signal than any phrase match.
    test('the cabinetry path still offers without an explicit buy phrase', () => {
        const history = [
            { role: 'user', content: 'Murano Queen Sofa with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        assert.equal(hasPurchaseIntent('10ft', history), false,
            'fixture must contain no buy wording, or this proves nothing');

        const offer = computeDepositOffer('10ft', history);
        assert.ok(offer, 'cabinetry path must be unaffected by the new gate');
        assert.equal(offer.depositType, DEPOSIT_TYPE_WITH_CABINETRY);
    });
});


// ── Deposit notification email ──────────────────────────────────
// The email must say, unambiguously and up front, whether a payment covers a
// wall bed alone or a wall bed plus cabinetry. It reads that from the same
// charge-time field as the Sheet's Cabinets column, never from the chat.
describe('deposit notification email', () => {

    const BASE = {
        quoteRef: 'MQS-20260901-ABC234',
        depositPercent: '10',
        depositAmountPaid: '1437.16',
        customerName: 'Aisyah Binti Rahman',
        customerEmail: 'buyer@example.com',
        customerPhone: '+60123456789',
        stripeSessionId: 'cs_test_123',
        recordedAt: '2026-09-01T08:15:00.000Z'
    };

    const wallbedOnly = () => buildDepositEmail({
        ...BASE,
        depositTypeLabel: depositTypeLabel(DEPOSIT_TYPE_WALLBED_ONLY),
        wallBedModel: 'Murano Queen',
        grandTotal: '14371.55',
        wallHeightFt: null,
        totalWallWidthFt: null
    });

    const withCabinetry = () => buildDepositEmail({
        ...BASE,
        depositTypeLabel: depositTypeLabel(DEPOSIT_TYPE_WITH_CABINETRY),
        wallBedModel: 'Murano Queen Sofa',
        grandTotal: '38300.11',
        depositAmountPaid: '3830.01',
        wallHeightFt: '11',
        totalWallWidthFt: '10'
    });

    // (a) wallbed_only
    test('a wallbed_only deposit is labelled "Wall Bed Only" in subject and body', () => {
        const { subject, text } = wallbedOnly();
        assert.equal(subject, 'New Deposit — Wall Bed Only (Murano Queen)');
        assert.match(text, /^Deposit type: Wall Bed Only$/m);
        assert.doesNotMatch(text, /Wall Bed \+ Cabinetry/);
    });

    // (b) wallbed_with_cabinetry
    test('a wallbed_with_cabinetry deposit is labelled "Wall Bed + Cabinetry" in subject and body', () => {
        const { subject, text } = withCabinetry();
        assert.equal(subject, 'New Deposit — Wall Bed + Cabinetry (Murano Queen Sofa)');
        assert.match(text, /^Deposit type: Wall Bed \+ Cabinetry$/m);
    });

    test('the deposit type is the FIRST line of the body', () => {
        for (const { text } of [wallbedOnly(), withCabinetry()]) {
            assert.match(text.split('\n')[0], /^Deposit type: /);
        }
    });

    // Requirement: measurements for the cabinetry case, nothing at all for
    // bed-only — not a section full of blanks.
    test('cabinetry measurements appear only for the with-cabinetry deposit', () => {
        const cab = withCabinetry().text;
        assert.match(cab, /Wall height: 11ft/);
        assert.match(cab, /Total wall width: 10ft/);

        const only = wallbedOnly().text;
        assert.doesNotMatch(only, /Wall height/);
        assert.doesNotMatch(only, /Total wall width/);
        assert.doesNotMatch(only, /Cabinetry estimate/);
    });

    test('all pre-existing body content is retained', () => {
        for (const { text } of [wallbedOnly(), withCabinetry()]) {
            assert.match(text, /Quote ref: MQS-20260901-ABC234/);
            assert.match(text, /Wall bed model: /);
            assert.match(text, /Grand total: RM /);
            assert.match(text, /Deposit paid: RM /);
            assert.match(text, /Customer name: Aisyah Binti Rahman/);
            assert.match(text, /Customer email: buyer@example\.com/);
            assert.match(text, /Customer phone: \+60123456789/);
            assert.match(text, /Stripe session: cs_test_123/);
            assert.match(text, /Recorded at: 2026-09-01T08:15:00\.000Z/);
        }
    });

    // Sessions created before deposit_type existed carry no type. Saying so is
    // correct; picking one of the two labels would be a confident lie in a
    // record someone acts on.
    test('an unknown deposit type is stated as unrecorded, not guessed', () => {
        const { subject, text } = buildDepositEmail({ ...BASE, depositTypeLabel: '', wallBedModel: 'Murano King' });
        assert.equal(subject, 'New Deposit — ' + UNKNOWN_TYPE_LABEL + ' (Murano King)');
        assert.match(text, new RegExp('^Deposit type: ' + UNKNOWN_TYPE_LABEL + '$', 'm'));
        assert.doesNotMatch(text, /Wall Bed Only/);
        assert.doesNotMatch(text, /Wall Bed \+ Cabinetry/);
    });

    test('a missing model is omitted from the subject rather than rendered blank', () => {
        const { subject } = buildDepositEmail({ ...BASE, depositTypeLabel: 'Wall Bed Only', wallBedModel: null });
        assert.equal(subject, 'New Deposit — Wall Bed Only');
        assert.doesNotMatch(subject, /\(\)|\(none\)|undefined|null/);
    });

    test('no field ever renders as "undefined" or "null"', () => {
        const { subject, text } = buildDepositEmail({});
        assert.doesNotMatch(subject + text, /undefined|null/);
    });

    // ── HTML rendering ──────────────────────────────────────────
    // Management reads the HTML table; the plain text above stays as the
    // fallback for clients that don't render HTML. Both must always show the
    // same data, so these mirror the text assertions rather than replacing them.
    test('both renderings are returned, and the html is a table', () => {
        for (const built of [wallbedOnly(), withCabinetry()]) {
            assert.equal(typeof built.html, 'string');
            assert.ok(built.html.length > 0, 'html should not be empty');
            assert.match(built.html, /<table[\s>]/, 'html should contain a table');
            assert.match(built.html, /<\/table>/);
            assert.ok(built.text.length > 0, 'text fallback must survive alongside the html');
        }
    });

    // Email clients strip <style> blocks and <head>, so a class-based layout
    // would silently arrive unstyled. Styling has to be inline to survive.
    test('the html styles inline and pulls in no external resources', () => {
        const { html } = withCabinetry();
        assert.match(html, /style="/, 'expected inline styles');
        assert.doesNotMatch(html, /<style/i, 'a <style> block would be stripped by Gmail/Outlook');
        assert.doesNotMatch(html, /class=/, 'CSS classes have nothing to resolve against in email');
        assert.doesNotMatch(html, /<img|<script|@import|https?:\/\//i, 'no external images, fonts, or JS');
    });

    // Customer-supplied values reach this template straight from Stripe
    // metadata. An unescaped "&" or "<" would corrupt the table at best and
    // inject markup at worst.
    test('html-special characters in customer fields are escaped', () => {
        const { html } = buildDepositEmail({
            ...BASE,
            depositTypeLabel: 'Wall Bed Only',
            wallBedModel: 'Murano <Queen> & Co',
            customerName: 'Tan & Sons <script>alert(1)</script>',
            customerEmail: 'a"b@example.com'
        });

        assert.doesNotMatch(html, /<script>/, 'raw script tag must never survive into the markup');
        assert.ok(html.includes('Tan &amp; Sons'), 'ampersand should be escaped');
        assert.ok(html.includes('&lt;script&gt;'), 'angle brackets should be escaped');
        assert.ok(html.includes('Murano &lt;Queen&gt; &amp; Co'), 'model should be escaped too');
        assert.ok(html.includes('a&quot;b@example.com'), 'double quotes should be escaped');
        // The escaping must not double-encode: "&amp;amp;" would display literally.
        assert.doesNotMatch(html, /&amp;(amp|lt|gt|quot);/, 'values must not be double-escaped');
    });

    test('the deposit type is prominent in the html, not buried', () => {
        assert.match(wallbedOnly().html, /Deposit type:\s*Wall Bed Only/);
        assert.match(withCabinetry().html, /Deposit type:\s*Wall Bed \+ Cabinetry/);
    });

    // Same conditional rule as the text version: omit the section, never
    // render blank rows for a deposit that has no wall being surveyed.
    test('cabinetry rows appear in the html only for the with-cabinetry deposit', () => {
        const cab = withCabinetry().html;
        assert.match(cab, /Wall height/);
        assert.match(cab, /11ft/);
        assert.match(cab, /Total wall width/);
        assert.match(cab, /10ft/);

        const only = wallbedOnly().html;
        assert.doesNotMatch(only, /Wall height/);
        assert.doesNotMatch(only, /Total wall width/);
        assert.doesNotMatch(only, /Cabinetry estimate/);
    });

    test('the html carries the same values and RM formatting as the text', () => {
        const { html } = withCabinetry();
        assert.match(html, /MQS-20260901-ABC234/);
        assert.match(html, /Murano Queen Sofa/);
        assert.match(html, /RM 38300\.11/);
        assert.match(html, /RM 3830\.01/);
        assert.match(html, /Aisyah Binti Rahman/);
        assert.match(html, /buyer@example\.com/);
        assert.match(html, /\+60123456789/);
        assert.match(html, /cs_test_123/);
    });

    test('missing fields fall back in the html exactly as they do in the text', () => {
        const { html } = buildDepositEmail({});
        assert.match(html, /\(none\)/, 'expected the (none) fallback');
        assert.match(html, /\(not provided\)/, 'expected the (not provided) fallback');
        assert.doesNotMatch(html, />\s*undefined\s*</, 'no field should render as undefined');
        assert.doesNotMatch(html, />\s*null\s*</, 'no field should render as null');
    });

    // The two renderings are stamped from one resolved timestamp, so a payment
    // cannot appear to have been recorded at two different times.
    test('text and html agree on the recorded-at timestamp when none is supplied', () => {
        const { text, html } = buildDepositEmail({ depositTypeLabel: 'Wall Bed Only' });
        const stamp = text.match(/Recorded at: (.+)$/m);
        assert.ok(stamp, 'text should carry a recorded-at timestamp');
        assert.ok(html.includes(stamp[1]), 'html should carry the identical timestamp');
    });
});

// ── The label mapping itself ────────────────────────────────────
describe('depositTypeLabel — single source shared with the Sheet column', () => {
    test('maps each deposit type to its display name', () => {
        assert.equal(depositTypeLabel(DEPOSIT_TYPE_WALLBED_ONLY), 'Wall Bed Only');
        assert.equal(depositTypeLabel(DEPOSIT_TYPE_WITH_CABINETRY), 'Wall Bed + Cabinetry');
    });

    test('an unrecognised type yields no label, matching the Yes/No rule', () => {
        for (const bad of ['kitchen_only', undefined, null, '']) {
            assert.equal(depositTypeLabel(bad), '');
            assert.equal(depositIncludesCabinets(bad), '');
        }
    });

    // The email label and the Sheet column are two renderings of one field, so
    // they must always agree about whether cabinetry is included.
    test('the email label and the Sheet Cabinets column never disagree', () => {
        for (const type of [DEPOSIT_TYPE_WALLBED_ONLY, DEPOSIT_TYPE_WITH_CABINETRY]) {
            const includesCabinetry = depositIncludesCabinets(type) === 'Yes';
            const labelSaysCabinetry = depositTypeLabel(type).includes('+ Cabinetry');
            assert.equal(labelSaysCabinetry, includesCabinetry, 'mismatch for ' + type);
        }
    });

    // Ties the label to what the deposit flow actually produces, so adding a
    // type without extending the mapping fails here rather than in an inbox.
    test('every deposit type the flow can produce has a label', () => {
        const only = getDepositBasisFromContext('Sounds good, I will take it', [
            { role: 'user', content: 'Do you have a Murano Queen?' },
            { role: 'assistant', content: 'Yes — the Murano Queen is RM 14,371.55 sale.' }
        ]);
        const cab = getDepositBasisFromContext('10ft', [
            { role: 'user', content: 'Murano Queen Sofa with side cabinets, how much in total?' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ]);
        for (const basis of [only, cab]) {
            assert.ok(basis, 'fixture should produce a deposit basis');
            assert.notEqual(depositTypeLabel(basis.type), '', 'unlabelled deposit type: ' + basis.type);
        }
    });
});

describe('cabinetry: keeps asking when a measurement answer is unusable', () => {
    const priceIntentHistory = (lastUser) => ([
        { role: 'user', content: 'I want a Murano Queen with surround cabinets, how much?' },
        { role: 'assistant', content: 'Sure! What is the height of your wall?' },
        { role: 'user', content: lastUser }
    ]);

    test('a non-measurement reply re-prompts instead of going silent', () => {
        const out = buildCabinetryEstimateBlock('not sure, quite tall lah', priceIntentHistory('not sure, quite tall lah'));
        assert.match(out, /KEEP ASKING/);
        assert.match(out, /HEIGHT/);
        assert.match(out, /TOTAL WALL WIDTH/);
    });

    test('once height is given, it keeps asking only for the still-missing width', () => {
        const history = [
            { role: 'user', content: 'Murano Queen with cabinets, how much?' },
            { role: 'assistant', content: 'What is the height of your wall?' },
            { role: 'user', content: '9ft' },
            { role: 'assistant', content: 'And the total wall width?' },
            { role: 'user', content: 'dunno' }
        ];
        const out = buildCabinetryEstimateBlock('dunno', history);
        assert.match(out, /KEEP ASKING/);
        assert.match(out, /TOTAL WALL WIDTH/);
        assert.doesNotMatch(out, /the wall\/ceiling HEIGHT/); // height already collected
    });

    test('no keep-asking noise when there is no cabinetry price intent', () => {
        const out = buildCabinetryEstimateBlock('do you sell wall beds?', [
            { role: 'user', content: 'do you sell wall beds?' }
        ]);
        assert.equal(out, '');
    });
});
describe('cabinetry: dimension parsing handles both measurements in one message', () => {
    const dims = (text) => extractCabinetryDimensions([{ role: 'user', content: text }], text);

    // Regression: customer gives height AND width in one natural sentence.
    // Previously the width silently failed to parse, leaving totalWidthFt null,
    // which produced an empty price allow-list and forced the WhatsApp fallback.
    test('"...height is 9ft and width is 12 ft" parses both', () => {
        assert.deepEqual(dims('total height of the wall is 9ft and width is 12 ft'), { heightFt: 9, totalWidthFt: 12 });
    });
    test('"the wall is 9ft high and 12ft wide" parses both', () => {
        assert.deepEqual(dims('the wall is 9ft high and 12ft wide'), { heightFt: 9, totalWidthFt: 12 });
    });
    test('"9ft height, 12ft width" does not mistake width for height', () => {
        assert.deepEqual(dims('9ft height, 12ft width'), { heightFt: 9, totalWidthFt: 12 });
    });
    test('"width is 12 ft" alone parses the width', () => {
        assert.equal(dims('width is 12 ft').totalWidthFt, 12);
    });
    test('bed width mention is NOT taken as wall width', () => {
        assert.equal(dims('the wall bed is 5ft wide').totalWidthFt, null);
    });
});
describe('purchase intent: affirmative reply to a reservation invitation counts', () => {
    const invite = 'Would you like to reserve your Murano King with a 10% deposit?';
    const modelChoiceQ = 'Are you looking for a queen size, or would you prefer a Murano King?';

    test('"Yes" after the bot invites a reservation is purchase intent', () => {
        assert.equal(hasPurchaseIntent('Yes', [{ role: 'assistant', content: invite }]), true);
    });
    test('"Yes" with no preceding reservation invite is NOT purchase intent', () => {
        assert.equal(hasPurchaseIntent('Yes', [{ role: 'assistant', content: 'We recommend the Murano Queen.' }]), false);
    });
    test('"Yes Murano King" answering a model-choice question is NOT purchase intent', () => {
        assert.equal(hasPurchaseIntent('Yes Murano King', [{ role: 'assistant', content: modelChoiceQ }]), false);
    });
    test('affirming a reservation invite yields a wall-bed deposit offer', () => {
        const history = [
            { role: 'user', content: 'Yes Murano King' },
            { role: 'assistant', content: 'The Murano King ... Sale: RM 15,285.45 ... ' + invite },
            { role: 'user', content: 'Yes' }
        ];
        const offer = computeDepositOffer('Yes', history);
        assert.ok(offer, 'expected a deposit offer');
        assert.equal(offer.depositType, 'wallbed_only');
        assert.equal(offer.wallBedModelLabel, 'Murano King');
    });
});

describe('deposit: declining cabinetry unblocks the bed-only reservation', () => {
    const declinedThenReserve = [
        { role: 'user', content: 'Murano Queen' },
        { role: 'assistant', content: 'Explore adding custom surround cabinetry, or reserve your Murano Queen with a 10% deposit?' },
        { role: 'user', content: 'Yes' },
        { role: 'assistant', content: 'Adding custom surround cabinetry — what is the wall height and width?' },
        { role: 'user', content: "I don't want to add cabinets" },
        { role: 'assistant', content: 'Got it, just the Murano Queen. Would you like to reserve it with a 10% deposit?' },
        { role: 'user', content: 'yes I want to reserve' }
    ];

    test('declining cabinets then reserving yields a wall-bed-only offer', () => {
        const offer = computeDepositOffer('yes I want to reserve', declinedThenReserve);
        assert.ok(offer, 'expected a deposit offer after the customer declined cabinets and asked to reserve');
        assert.equal(offer.depositType, 'wallbed_only');
        assert.equal(offer.wallBedModelLabel, 'Murano Queen');
    });

    test('anti-downgrade still blocks a customer actively pricing cabinets (no decline)', () => {
        const active = [
            { role: 'user', content: 'how much for a murano queen with surround cabinets?' },
            { role: 'assistant', content: 'What is your wall height?' },
            { role: 'user', content: 'I want to reserve it' }
        ];
        assert.equal(computeDepositOffer('I want to reserve it', active), null);
    });

    test('re-engaging cabinetry after a decline re-arms the anti-downgrade guard', () => {
        const reengage = [
            { role: 'user', content: 'murano queen' },
            { role: 'assistant', content: 'reserve or add cabinets?' },
            { role: 'user', content: 'no cabinets' },
            { role: 'assistant', content: 'ok' },
            { role: 'user', content: 'actually add surround cabinets please' }
        ];
        assert.equal(computeDepositOffer('actually add surround cabinets please', reengage), null);
    });
});

// ── Deposit suppression diagnostics ────────────────────
// These logs are how MOCOF finds out WHY a customer got no deposit button.
// The tests pin two things: that the highest-signal case is distinguishable
// from routine ones, and that logging changed no return value.
describe('deposit suppression diagnostics', () => {

    // Captures console output around one call without leaking the patch if
    // the call throws.
    function capture(message, history) {
        const warns = [];
        const errors = [];
        const realWarn = console.warn;
        const realError = console.error;
        console.warn = (...a) => warns.push(a.join(' '));
        console.error = (...a) => errors.push(a.join(' '));
        let result;
        try {
            result = getDepositBasisFromContext(message, history);
        } finally {
            console.warn = realWarn;
            console.error = realError;
        }
        return { result, warns, errors };
    }

    const PRICED = [
        { role: 'user', content: 'Is there a Murano Single?' },
        { role: 'assistant', content: 'Yes — the Murano Single is RM 16,083.40 retail | RM 12,062.55 sale.' }
    ];

    // Requirement: a conversation with no wall-bed context must not log. This
    // gate is hit on every turn of every unrelated chat, so logging it would
    // bury the lines that matter.
    test('a conversation with no wall bed in it logs nothing', () => {
        const { result, warns, errors } = capture('hi', []);
        assert.equal(result, null);
        assert.deepEqual(warns, []);
        assert.deepEqual(errors, []);
    });

    test('a wall bed with no specific model resolved warns, without a model label', () => {
        const { result, warns, errors } = capture('tell me about wall beds', [
            { role: 'user', content: 'do you sell wall beds?' },
            { role: 'assistant', content: 'Yes, we carry several wall bed ranges.' }
        ]);
        assert.equal(result, null);
        assert.equal(errors.length, 0, 'routine suppression must not raise the severity');
        assert.equal(warns.length, 1);
        assert.match(warns[0], /^\[deposit\] suppressed: no specific wall bed model resolved$/);
    });

    test('a priced model without buy intent warns and names the model', () => {
        const { result, warns, errors } = capture('Is there a Murano Single?', PRICED);
        assert.equal(result, null);
        assert.equal(errors.length, 0);
        assert.equal(warns.length, 1);
        assert.match(warns[0], /\[deposit\] suppressed: model resolved but no purchase-intent signal/);
        assert.match(warns[0], /\| model: Murano Single/);
    });

    // The alarm. A customer who named a model AND said they want it, getting
    // nothing, is the shape every deposit bug in this project has taken.
    test('a ceiling conflict with buy intent raises the WITHHELD alarm', () => {
        const { result, warns, errors } = capture('I want the Murano Queen', [
            { role: 'user', content: 'My ceiling is 7ft, do you have a Murano Queen?' },
            { role: 'assistant', content: 'What is your ceiling height?' },
            { role: 'user', content: '7ft' },
            { role: 'assistant', content: 'The Murano Queen is RM 14,371.55 sale.' }
        ]);
        assert.equal(result, null, 'behaviour must be unchanged — still no offer');
        assert.equal(warns.length, 0, 'this case must NOT be a routine warn');
        assert.equal(errors.length, 1);
        assert.match(errors[0], /^\[deposit\] WITHHELD despite buy intent: ceiling conflict/);
        assert.match(errors[0], /\| model: Murano Queen/);
    });

    test('cabinetry in progress with buy intent raises the WITHHELD alarm', () => {
        const { result, warns, errors } = capture('I want to buy the Murano Queen', [
            { role: 'user', content: 'Murano Queen with side cabinets please' },
            { role: 'assistant', content: 'The Murano Queen is RM 14,371.55 sale. What is the wall height?' }
        ]);
        assert.equal(result, null);
        assert.equal(warns.length, 0);
        assert.equal(errors.length, 1);
        assert.match(errors[0], /^\[deposit\] WITHHELD despite buy intent: cabinetry in progress/);
    });

    // A produced offer is not a suppression, so it must be silent on both
    // channels — otherwise the logs report a problem that did not happen.
    test('a successful offer logs nothing', () => {
        const { result, warns, errors } = capture('I want the Murano Single', PRICED);
        assert.ok(result, 'fixture must actually produce an offer');
        assert.equal(result.type, DEPOSIT_TYPE_WALLBED_ONLY);
        assert.deepEqual(warns, []);
        assert.deepEqual(errors, []);
    });

    // Requirement 4: logging only. Every gate returns exactly what it did
    // before, and the one success path still produces its offer.
    test('logging changed no return value at any gate', () => {
        assert.equal(capture('hi', []).result, null);
        assert.equal(capture('Is there a Murano Single?', PRICED).result, null);
        assert.ok(capture('I want the Murano Single', PRICED).result);
    });
});


// ── Stuck measurement flow escalates to a human ─────────
// "Keep asking" has its own dead end: a customer who cannot produce the
// number in chat gets asked forever. Past a couple of failed attempts the
// prompt must stop re-asking and offer a person instead.
describe('cabinetry: escalates to a human when the measurement loop is stuck', () => {

    const OPEN = { role: 'user', content: 'Murano Queen Sofa with side cabinets, how much in total?' };

    // The requirement is explicit that ONE failed ask is still just
    // conversation — escalating here would pull customers out of a flow that
    // was about to succeed on the retry.
    test('a single failed ask keeps asking and does NOT escalate', () => {
        const history = [
            OPEN,
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        const out = buildCabinetryEstimateBlock('not sure', history);
        assert.match(out, /KEEP ASKING/);
        assert.doesNotMatch(out, /HAND OFF TO A HUMAN/);
        assert.doesNotMatch(out, /12-568 4568/);
    });

    test('after 2 failed asks it escalates to the WhatsApp handoff', () => {
        const history = [
            OPEN,
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: 'not sure' },
            { role: 'assistant', content: 'No problem — what height is the wall, in feet?' }
        ];
        const out = buildCabinetryEstimateBlock('I really dont know', history);
        assert.match(out, /STUCK, HAND OFF TO A HUMAN/);
        assert.match(out, /\+60 12-568 4568/, 'must carry the product WhatsApp number');
        assert.match(out, /STOP asking for it again/i);

        // The two instructions contradict each other, so the escalation has to
        // REPLACE the keep-asking block, not sit alongside it.
        assert.doesNotMatch(out, /KEEP ASKING/,
            'must not tell the model to keep asking and stop asking at once');
    });

    // Counted per dimension: a height answered first time must not be dragged
    // into an escalation caused by the width.
    test('escalates on the width alone when the height was answered fine', () => {
        const history = [
            OPEN,
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' },
            { role: 'user', content: 'dunno' },
            { role: 'assistant', content: 'Roughly what total width is the wall, in feet?' }
        ];
        const out = buildCabinetryEstimateBlock('no idea sorry', history);
        assert.match(out, /STUCK, HAND OFF TO A HUMAN/);
        assert.match(out, /total wall width/i);
        assert.doesNotMatch(out, /wall height and/i, 'height was answered — do not claim to be stuck on it');
    });

    // An assistant turn that MENTIONS a dimension without asking for one is not
    // an ask, or quoting a bed spec twice would trigger a handoff.
    test('non-question mentions of height do not count as asks', () => {
        const history = [
            OPEN,
            { role: 'assistant', content: 'The Murano Queen has a height of 209.5cm.' },
            { role: 'user', content: 'ok' },
            { role: 'assistant', content: 'Its height suits most ceilings.' }
        ];
        const out = buildCabinetryEstimateBlock('ok', history);
        assert.doesNotMatch(out, /HAND OFF TO A HUMAN/);
    });

    // Only the BOT's asks count. A customer asking their own questions about
    // height ("does height matter?") is not the bot failing to get an answer, and
    // counting their turns would hand off a customer who was merely curious.
    test('the customer\'s own height questions do not count as asks', () => {
        const history = [
            OPEN,
            { role: 'user', content: 'does the height matter for this?' },
            { role: 'assistant', content: 'It does — taller walls allow a full overhead cabinet.' },
            { role: 'user', content: 'what height do most people have?' },
            { role: 'assistant', content: 'Usually around 9 to 10 feet. What is the height of your wall, in feet?' }
        ];
        const out = buildCabinetryEstimateBlock('not sure', history);
        assert.match(out, /KEEP ASKING/, 'only one real ask has been made');
        assert.doesNotMatch(out, /HAND OFF TO A HUMAN/);
    });

    // Escalation must never become a way to state a price without measurements.
    test('the escalation still forbids quoting a cabinetry price', () => {
        const history = [
            OPEN,
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: 'not sure' },
            { role: 'assistant', content: 'What height is the wall, in feet?' }
        ];
        const out = buildCabinetryEstimateBlock('no clue', history);
        assert.match(out, /do NOT state any cabinetry price/i);
    });
});


// ── System prompt: human handoff (PART A) ───────────────
describe('system prompt — when to hand off to a human', () => {
    const prompt = buildSystemPrompt('Tell me about the Murano Queen', []);

    test('has a dedicated handoff section with both numbers', () => {
        assert.match(prompt, /WHEN TO HAND OFF TO A HUMAN:/);
        assert.match(prompt, /\+60 12-568 4568 for products/);
        assert.match(prompt, /\+60 12-475 4568 for renovation/);
    });

    test('names all four handoff triggers', () => {
        assert.match(prompt, /confused or frustrated, or are repeating themselves/i);
        assert.match(prompt, /failed to help with the SAME thing/i);
        assert.match(prompt, /outside the catalog/i);
        assert.match(prompt, /explicitly ask for a person/i);
    });

    // The tone requirement is the point of the section — a handoff that reads
    // as a brush-off is worse than none.
    test('frames the handoff as help arriving, and keeps answering meanwhile', () => {
        assert.match(prompt, /never as a dead end/i);
        assert.match(prompt, /Let me\s+connect you with a colleague/i);
        assert.match(prompt, /Keep helping in the meantime/i);
        assert.match(prompt, /never reply with only a phone number/i);
    });

    // The pre-existing rule bans the WhatsApp number outside renovation. Without
    // an explicit carve-out the model gets two contradictory instructions.
    test('carves the handoff out of the renovation-only WhatsApp restriction', () => {
        assert.match(prompt, /The ONE exception is a genuine human handoff/i);
    });
});


// ── Price intent from agreeing to the bot's offer ───────
// The bug: the bot offers "Would you like an estimate for adding surround
// cabinetry?", the customer says "yes", and because their turn carries no
// price keyword, hasPriceIntent said false. That suppressed the
// pre-calculated estimate block, left the model to derive the figure from raw
// rates, and the guardrail then swapped the whole reply for the WhatsApp
// fallback — the customer asked for an estimate and got a phone number.
describe('hasPriceIntent — agreeing to the bot\'s own estimate offer', () => {

    test('"yes" after an estimate offer counts as price intent', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen with surround cabinets' },
            { role: 'assistant', content: 'Would you like an estimate for adding surround cabinetry?' }
        ];
        assert.equal(hasPriceIntent('yes', history), true);
    });

    test('other affirmative phrasings work the same way', () => {
        const history = [
            { role: 'assistant', content: 'Shall I calculate the cabinetry for you?' }
        ];
        for (const reply of ['yes', 'yes please', 'sure', 'ok', 'go ahead', 'sounds good']) {
            assert.equal(hasPriceIntent(reply, history), true, 'should accept: ' + reply);
        }
    });

    // The gate that keeps this from firing everywhere. Without the preceding-turn
    // check, any "yes" in any context would silently become a price request.
    test('a bare "yes" with no estimate offer before it is NOT price intent', () => {
        assert.equal(hasPriceIntent('yes', []), false);
        assert.equal(hasPriceIntent('yes', [
            { role: 'assistant', content: 'Yes — the Murano Queen is one of our vertical wall beds.' }
        ]), false);
        assert.equal(hasPriceIntent('yes', [
            { role: 'assistant', content: 'Would you like to see our showroom?' }
        ]), false);
    });

    // The reservation invite has its own affirmative path in hasPurchaseIntent.
    // These two must not bleed into each other: agreeing to reserve is a buy
    // signal, not a request to be quoted something new.
    test('"yes" to a RESERVATION invite is not price intent', () => {
        assert.equal(hasPriceIntent('yes', [
            { role: 'assistant', content: 'Would you like to reserve your Murano Queen with a 10% deposit?' }
        ]), false);
    });

    test('an ordinary price question still counts, unchanged', () => {
        assert.equal(hasPriceIntent('how much for cabinets?', []), true);
        assert.equal(hasPriceIntent('what is the total?', []), true);
        assert.equal(hasPriceIntent('can I get a quote?', []), true);
        assert.equal(hasPriceIntent('do you deliver?', []), false);
    });

    // hasCabinetryPriceIntent is an alias of the same implementation, so the fix
    // must reach it too — the deposit path reads it under that name.
    test('the hasCabinetryPriceIntent alias inherits the fix', () => {
        const history = [
            { role: 'assistant', content: 'Would you like an estimate for adding surround cabinetry?' }
        ];
        assert.equal(hasCabinetryPriceIntent('yes', history), true);
    });

    // End to end: the whole point of the fix. Same conversation that used to
    // produce an empty block and therefore the WhatsApp fallback.
    test('the full estimate block is produced after agreeing with "yes"', () => {
        const history = [
            { role: 'user', content: 'I want a Murano Queen' },
            { role: 'assistant', content: 'The Murano Queen is RM 14,371.55 sale. Would you like an estimate for adding surround cabinetry?' },
            { role: 'user', content: 'yes' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        const out = buildCabinetryEstimateBlock('10ft', history);

        assert.notEqual(out, '', 'the estimate block must no longer be suppressed');
        assert.match(out, /GRAND TOTAL/);
        assert.match(out, /PRE-CALCULATED WALL BED \+ CABINETRY ESTIMATE/);
        assert.match(out, /Murano Queen/);
    });
});

describe('deposit: cabinetry deposit follows the presented estimate, not a price keyword', () => {
    // The reported bug: customer says "Murano Queen with cabinets", gives measurements,
    // the estimate (grand total) is shown, then agrees with a bare "yes" — no price
    // keyword anywhere, yet the button must appear because the price is on screen.
    test('estimate already presented + agreement yields a with-cabinetry offer', () => {
        const history = [
            { role: 'user', content: 'Murano Queen with cabinets' },
            { role: 'assistant', content: 'To help calculate the custom surround cabinetry estimate, what is the wall height and width?' },
            { role: 'user', content: '15ft high and 7ft wide' },
            { role: 'assistant', content: 'Here is the breakdown ... Grand Total: RM 22,373.55. Would you like to reserve your Murano Queen with a 10% deposit?' },
            { role: 'user', content: 'yes' }
        ];
        const offer = computeDepositOffer('yes', history);
        assert.ok(offer, 'expected a deposit offer once the estimate has been presented');
        assert.equal(offer.depositType, DEPOSIT_TYPE_WITH_CABINETRY);
        assert.equal(offer.wallBedModelLabel, 'Murano Queen');
    });

    // Guard the invariant from the other side: no estimate presented yet => no button.
    test('no offer while still collecting measurements (estimate not yet shown)', () => {
        const history = [
            { role: 'user', content: 'Murano Queen with cabinets' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' },
            { role: 'user', content: '15ft' },
            { role: 'assistant', content: 'And the total width of the wall, in feet?' }
        ];
        assert.equal(computeDepositOffer('7ft', history), null);
    });
});


// ── Deposit amount options ──────────────────────────────────────
// A customer may put down 10% of the grand total or one of a few fixed amounts.
// The security property these pin: the client only ever SELECTS among amounts
// the server generated for a server-computed total. No client value is parsed
// into an amount, and nothing outside ALLOWED_FIXED_DEPOSITS (or the computed
// 10%) can reach Stripe.
describe('deposit amount options', () => {

    // Priced model + explicit buy intent -> a wallbed_only basis (the fixture
    // the purchase-intent suite already relies on).
    const BED_ONLY_HISTORY = [
        { role: 'user', content: 'Is there a Murano Single?' },
        { role: 'assistant', content: 'Yes — the Murano Single is RM 16,083.40 retail | RM 12,062.55 sale.' }
    ];
    const BED_ONLY_MESSAGE = 'I want the Murano Single';
    const bedOnlyTotal = () => WALLBED_MODEL_PRICING.find(m => m.label === 'Murano Single').sale;

    // Worked example 4 — the cabinetry fixture whose grand total (RM 38,300.11)
    // is verified against the formula earlier in this file.
    const CAB_HISTORY = [
        { role: 'user', content: 'I want a Murano Queen Sofa with side cabinets around it, how much in total?' },
        { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' },
        { role: 'user', content: '11ft' },
        { role: 'assistant', content: 'Got it. What is the total width of the wall, in feet?' }
    ];
    const CAB_MESSAGE = '10ft';

    test('the allowed fixed amounts are exactly the four agreed values, and frozen', () => {
        assert.deepEqual([...ALLOWED_FIXED_DEPOSITS], [1500, 2500, 3500, 4500]);
        assert.ok(Object.isFrozen(ALLOWED_FIXED_DEPOSITS));
        assert.throws(() => ALLOWED_FIXED_DEPOSITS.push(99999), TypeError,
            'nothing at runtime may add a chargeable amount');
    });

    // ── Requirement: a fixed amount not in ALLOWED_FIXED_DEPOSITS is rejected ──
    test('a fixed amount not in ALLOWED_FIXED_DEPOSITS is rejected', () => {
        const total = 50000;
        for (const bogus of ['fixed_1000', 'fixed_2000', 'fixed_5000', 'fixed_1', 'fixed_0', 'fixed_-1500', 'fixed_99999']) {
            const r = resolveDepositChoice(total, bogus);
            assert.equal(r.ok, false, 'must reject ' + bogus);
            assert.equal(r.option, undefined, 'a rejection must carry no amount to charge');
        }
    });

    // The client value is a lookup key, never parsed. Every shape a tampered
    // request body can carry must fail to match rather than be coerced.
    test('tampered or malformed choices never resolve to an amount', () => {
        const total = 50000;
        const tampered = [
            1500, '1500', 'fixed_1500 ', ' fixed_1500', 'FIXED_1500', 'Fixed_1500',
            'fixed_1500.00', 'fixed_01500', 'fixed_1500 ', 'percent ', 'PERCENT', '10%', '10',
            '', true, false, 0, NaN, ['fixed_1500'], { id: 'fixed_1500' }, { amount: 1500 },
            '__proto__', 'constructor', 'toString', 'hasOwnProperty'
        ];
        for (const choice of tampered) {
            const r = resolveDepositChoice(total, choice);
            assert.equal(r.ok, false, 'must reject ' + JSON.stringify(choice) + ' (' + typeof choice + ')');
        }
    });

    // ── Requirement: each of the four is accepted when below the grand total ──
    test('each of the four fixed amounts is accepted when below the grand total', () => {
        const total = 50000;
        for (const amount of ALLOWED_FIXED_DEPOSITS) {
            const r = resolveDepositChoice(total, 'fixed_' + amount);
            assert.equal(r.ok, true, 'must accept fixed_' + amount);
            assert.equal(r.option.kind, 'fixed');
            assert.equal(r.option.amount, amount, 'the amount must come from the constant');
        }
    });

    // ── Requirement: the 10% option still equals 10% of the server total ──
    test('the 10% option equals 10% of the server-computed grand total', () => {
        const total = bedOnlyTotal();
        const r = resolveDepositChoice(total, DEPOSIT_OPTION_PERCENT);
        assert.equal(r.ok, true);
        assert.equal(r.option.kind, 'percent');
        assert.equal(r.option.percent, DEPOSIT_PERCENT);
        assert.equal(r.option.amount, round2(total * DEPOSIT_PERCENT / 100));
    });

    // A widget loaded before options existed sends no choice; it must still get
    // the 10% deposit it always did. Only an ABSENT choice may default.
    test('an absent choice resolves to the 10% deposit; a present invalid one does not', () => {
        const total = 38300.11;
        for (const absent of [undefined, null]) {
            const r = resolveDepositChoice(total, absent);
            assert.equal(r.ok, true);
            assert.equal(r.option.id, DEPOSIT_OPTION_PERCENT);
            assert.equal(r.option.amount, 3830.01);
        }
        assert.equal(resolveDepositChoice(total, '').ok, false,
            'a present-but-empty choice is invalid, not a request for the default');
    });

    // ── Requirement: a fixed option >= grand total is not offered ──
    test('a fixed option at or above the grand total is not offered', () => {
        const ids = total => getDepositOptions(total).map(o => o.id);

        assert.deepEqual(ids(3000), ['percent', 'fixed_1500', 'fixed_2500']);
        // Boundary: EQUAL to the total is not a deposit either.
        assert.deepEqual(ids(2500), ['percent', 'fixed_1500']);
        assert.deepEqual(ids(2500.01), ['percent', 'fixed_1500', 'fixed_2500']);
        assert.deepEqual(ids(1500), ['percent']);
        assert.deepEqual(ids(1000), ['percent'], 'the 10% option is always kept');
        assert.deepEqual(ids(50000), ['percent', 'fixed_1500', 'fixed_2500', 'fixed_3500', 'fixed_4500']);
    });

    // Hiding an option is presentation. The security boundary is that the same
    // filter applies at charge time, so a crafted request for a hidden option is
    // refused rather than charged.
    test('a fixed option at or above the grand total cannot be charged either', () => {
        assert.equal(resolveDepositChoice(3000, 'fixed_3500').ok, false);
        assert.equal(resolveDepositChoice(3000, 'fixed_4500').ok, false);
        assert.equal(resolveDepositChoice(2500, 'fixed_2500').ok, false);
        assert.equal(resolveDepositChoice(3000, 'fixed_2500').ok, true);
    });

    test('no options exist for a missing or nonsensical grand total', () => {
        for (const total of [0, -100, NaN, Infinity, null, undefined, '38300.11']) {
            assert.deepEqual(getDepositOptions(total), [], 'no options for ' + String(total));
            assert.equal(resolveDepositChoice(total, undefined).ok, false);
        }
    });

    // ── The offer carried in the chat response ──
    test('computeDepositOffer keeps its 10% fields and lists the options for a real conversation', () => {
        const offer = computeDepositOffer(CAB_MESSAGE, CAB_HISTORY);
        assert.ok(offer, 'fixture must produce an offer');
        assert.equal(offer.grandTotal, 38300.11);
        assert.equal(offer.depositPercent, DEPOSIT_PERCENT);
        assert.equal(offer.depositAmount, 3830.01);
        assert.deepEqual(offer.depositOptions.map(o => o.id),
            ['percent', 'fixed_1500', 'fixed_2500', 'fixed_3500', 'fixed_4500']);
        assert.equal(offer.depositOptions[0].amount, offer.depositAmount,
            'the 10% option is the same amount the legacy fields carry');
    });

    // ── End to end at the charge step: raw client input -> sen ──
    test('buildDepositCharge charges 10% of the re-derived total, in sen', () => {
        const charge = buildDepositCharge(BED_ONLY_MESSAGE, BED_ONLY_HISTORY, 'percent');
        assert.equal(charge.ok, true);
        const expected = round2(bedOnlyTotal() * DEPOSIT_PERCENT / 100);
        assert.equal(charge.depositAmount, expected);
        assert.equal(charge.unitAmountCents, Math.round(expected * 100));
        assert.equal(charge.productName, DEPOSIT_PERCENT + '% Deposit — Murano Single',
            'the percentage line item keeps its existing name');
        assert.equal(charge.metadata.deposit_percent, String(DEPOSIT_PERCENT));
        assert.equal(charge.metadata.deposit_option, 'percent');
        assert.equal(charge.metadata.deposit_option_kind, 'percent');
    });

    test('buildDepositCharge charges a chosen fixed amount exactly, and records the choice', () => {
        const charge = buildDepositCharge(CAB_MESSAGE, CAB_HISTORY, 'fixed_2500');
        assert.equal(charge.ok, true);
        assert.equal(charge.grandTotal, 38300.11, 'the grand total is still the server-computed one');
        assert.equal(charge.depositAmount, 2500);
        assert.equal(charge.unitAmountCents, 250000);
        assert.equal(charge.productName, 'RM 2,500.00 Deposit — Murano Queen Sofa + Cabinetry');
        assert.equal(charge.metadata.deposit_option, 'fixed_2500');
        assert.equal(charge.metadata.deposit_option_kind, 'fixed');
        assert.equal(charge.metadata.deposit_option_label, 'Fixed RM 2,500.00');
        assert.equal(charge.metadata.deposit_percent, '', 'no percentage was applied — do not claim one');
        assert.equal(charge.metadata.grand_total, '38300.11');
        assert.equal(charge.metadata.cabinets, 'Yes');
        assert.equal(charge.metadata.wall_height_ft, '11');
        assert.equal(charge.metadata.total_wall_width_ft, '10');
    });

    test('buildDepositCharge rejects an invalid choice with a 400 and nothing to charge', () => {
        for (const bogus of ['fixed_2000', 1500, 'fixed_99999', '']) {
            const charge = buildDepositCharge(BED_ONLY_MESSAGE, BED_ONLY_HISTORY, bogus);
            assert.equal(charge.ok, false, 'must reject ' + JSON.stringify(bogus));
            assert.equal(charge.status, 400);
            assert.equal(charge.rejectedOption, true);
            assert.equal(charge.unitAmountCents, undefined);
            assert.equal(charge.metadata, undefined);
        }
    });

    test('buildDepositCharge refuses when the conversation has no payable basis, whatever the choice', () => {
        const charge = buildDepositCharge('hello', [], 'fixed_1500');
        assert.equal(charge.ok, false);
        assert.equal(charge.status, 400);
        assert.equal(charge.rejectedOption, undefined, 'a missing quote is not a bad option');
        assert.equal(charge.unitAmountCents, undefined);
    });

    // create-deposit.js imports `stripe`, so its handler isn't run here. These
    // pin its wiring: the charge must come from buildDepositCharge(), and no
    // amount may be read off the request body.
    test('api/create-deposit.js charges only what buildDepositCharge() returns', () => {
        const src = readFileSync(new URL('../api/create-deposit.js', import.meta.url), 'utf8');
        assert.match(src, /buildDepositCharge\(message, history, depositOption\)/);
        assert.match(src, /unit_amount:\s*charge\.unitAmountCents/);
        assert.match(src, /const \{ message, history, depositOption \} = req\.body \|\| \{\};/,
            'depositOption must be the only deposit field read from the body');
        assert.doesNotMatch(src, /req\.body\.\w*(?:amount|total|deposit)/i, 'no amount may be read off the body');
        assert.doesNotMatch(src, /DEPOSIT_PERCENT|round2|\*\s*100\b/,
            'create-deposit.js must do no deposit arithmetic of its own');
    });

    // Every field written at charge time must be read back by the webhook, or it
    // sits in Stripe and never reaches the Sheet or the email.
    test('every metadata field buildDepositCharge writes is read by the webhook', () => {
        const webhook = readFileSync(new URL('../api/stripe-webhook.js', import.meta.url), 'utf8');
        const charge = buildDepositCharge(CAB_MESSAGE, CAB_HISTORY, 'fixed_1500');
        assert.equal(charge.ok, true);
        for (const key of ['quote_ref', ...Object.keys(charge.metadata)]) {
            assert.ok(webhook.includes('meta.' + key), 'stripe-webhook.js never reads metadata.' + key);
        }
    });

    // ── Staff-facing record ──
    test('the email records a fixed-amount choice without claiming a percentage', () => {
        const { text, html } = buildDepositEmail({
            depositTypeLabel: 'Wall Bed Only',
            wallBedModel: 'Murano Single',
            grandTotal: '12062.55',
            depositPercent: '',
            depositOption: 'fixed_1500',
            depositOptionKind: 'fixed',
            depositOptionLabel: 'Fixed RM 1,500.00',
            depositAmountPaid: '1500.00'
        });
        assert.match(text, /^Deposit option: Fixed RM 1,500\.00$/m);
        assert.match(text, /A fixed-amount deposit has been paid\./);
        assert.doesNotMatch(text, /\?%/, 'must not print a placeholder percentage');
        assert.match(html, /Deposit option/);
        assert.match(html, /Fixed RM 1,500\.00/);
        assert.doesNotMatch(html, /Deposit %/, 'no percentage row for a fixed deposit');
        assert.doesNotMatch(html, /\?%/);
    });

    test('the email keeps its 10% wording for a percentage choice', () => {
        const { text, html } = buildDepositEmail({
            depositTypeLabel: 'Wall Bed Only',
            depositPercent: '10',
            depositOption: 'percent',
            depositOptionKind: 'percent',
            depositOptionLabel: '10% of total',
            depositAmountPaid: '1206.26'
        });
        assert.match(text, /A 10% deposit has been paid\./);
        assert.match(text, /^Deposit option: 10% of total$/m);
        assert.match(html, /Deposit %/);
    });

    test('an email for a session from before options existed is honest about it', () => {
        const { text } = buildDepositEmail({ depositTypeLabel: 'Wall Bed Only', depositPercent: '10' });
        assert.match(text, /A 10% deposit has been paid\./, 'legacy wording unchanged');
        assert.match(text, /^Deposit option: \(not recorded\)$/m);
    });
});


// ── Fixed reservation deposits (any product) ────────────────────
// Deposits used to work only for wall beds, because the amount was derived from
// a trusted price table and most of the catalog has no structured price. A
// reservation deposit is a FIXED amount instead, so it needs no price at all —
// which is what these pin: the amount comes only from ALLOWED_FIXED_DEPOSITS,
// and the product label, however it is guessed, can never change it.
describe('product reservation deposits', () => {

    const SOFA_HISTORY = [
        { role: 'user', content: 'Do you have the Solaris Sofa?' },
        { role: 'assistant', content: 'Yes — the Solaris Sofa is one of our premium sofas.' }
    ];
    const SOFA_MESSAGE = 'I want the Solaris Sofa';
    const RESERVATION_IDS = ALLOWED_FIXED_DEPOSITS.map(a => 'fixed_' + a);

    function reservationBasis() {
        const basis = getDepositBasisFromContext(SOFA_MESSAGE, SOFA_HISTORY);
        assert.ok(basis, 'fixture should produce a deposit basis');
        return basis;
    }

    test('wanting a non-wall-bed product produces a reservation basis with no total', () => {
        const basis = reservationBasis();
        assert.equal(basis.type, DEPOSIT_TYPE_RESERVATION);
        assert.equal(basis.total, null, 'a reservation is decoupled from price on purpose');
        assert.equal(basis.wallBedModelLabel, null);
        assert.equal(basis.productLabel, 'Solaris Sofa');
    });

    // Same gate as the wall bed path: asking about a product is not asking to buy it.
    test('asking about a product without buy intent offers nothing', () => {
        assert.equal(getDepositBasisFromContext('Do you have the Solaris Sofa?', SOFA_HISTORY), null);
        assert.equal(computeDepositOffer('How much is the Solaris Sofa?', SOFA_HISTORY), null);
    });

    // ── Only ALLOWED_FIXED_DEPOSITS may be charged ──
    test('a reservation accepts every allowed fixed amount, taken from the constant', () => {
        const basis = reservationBasis();
        for (const amount of ALLOWED_FIXED_DEPOSITS) {
            const r = resolveDepositChoiceForBasis(basis, 'fixed_' + amount);
            assert.equal(r.ok, true, 'must accept fixed_' + amount);
            assert.equal(r.option.kind, 'fixed');
            assert.equal(r.option.amount, amount);
        }
    });

    test('a reservation rejects any amount not in ALLOWED_FIXED_DEPOSITS', () => {
        const basis = reservationBasis();
        const bogus = ['percent', 'fixed_1000', 'fixed_2000', 'fixed_5000', 'fixed_1', 'fixed_99999',
            1500, '1500', 'FIXED_1500', 'fixed_1500 ', '', '__proto__', ['fixed_1500'], { amount: 1500 }];
        for (const choice of bogus) {
            const r = resolveDepositChoiceForBasis(basis, choice);
            assert.equal(r.ok, false, 'must reject ' + JSON.stringify(choice));
            assert.equal(r.option, undefined, 'a rejection must carry no amount to charge');
        }
    });

    // There is no percentage to fall back on, so a missing choice is refused
    // rather than charged an amount the customer never picked.
    test('a reservation with no choice at all is rejected, not defaulted', () => {
        const basis = reservationBasis();
        for (const absent of [undefined, null]) {
            assert.equal(resolveDepositChoiceForBasis(basis, absent).ok, false);
        }
    });

    test('the offered options are exactly the four fixed amounts, with no percentage', () => {
        const offer = computeDepositOffer(SOFA_MESSAGE, SOFA_HISTORY);
        assert.ok(offer);
        assert.equal(offer.depositType, DEPOSIT_TYPE_RESERVATION);
        assert.deepEqual(offer.depositOptions.map(o => o.id), RESERVATION_IDS);
        assert.ok(offer.depositOptions.every(o => o.kind === 'fixed'), 'no percentage option exists here');
        assert.equal(offer.grandTotal, null);
        assert.equal(offer.depositAmount, null);
        assert.equal(offer.depositPercent, null);
        assert.equal(offer.productLabel, 'Solaris Sofa');
    });

    // ── End to end at the charge step ──
    test('buildDepositCharge charges the chosen fixed amount and records the product', () => {
        const charge = buildDepositCharge(SOFA_MESSAGE, SOFA_HISTORY, 'fixed_2500');
        assert.equal(charge.ok, true);
        assert.equal(charge.depositAmount, 2500);
        assert.equal(charge.unitAmountCents, 250000);
        assert.equal(charge.metadata.deposit_type, DEPOSIT_TYPE_RESERVATION);
        assert.equal(charge.metadata.product_label, 'Solaris Sofa');
        assert.equal(charge.metadata.grand_total, '', 'a reservation has no order total to record');
        assert.equal(charge.metadata.deposit_percent, '', 'no percentage was applied');
        assert.equal(charge.metadata.cabinets, 'No');
        assert.equal(charge.metadata.wall_bed_model, '');
        assert.match(charge.productName, /Reservation Deposit — Solaris Sofa/);
    });

    test('buildDepositCharge refuses a reservation amount outside the allow-list', () => {
        for (const bogus of ['fixed_2000', 'percent', 1500, undefined]) {
            const charge = buildDepositCharge(SOFA_MESSAGE, SOFA_HISTORY, bogus);
            assert.equal(charge.ok, false, 'must reject ' + JSON.stringify(bogus));
            assert.equal(charge.status, 400);
            assert.equal(charge.unitAmountCents, undefined);
            assert.equal(charge.metadata, undefined);
        }
    });

    // ── Product identification is loose, and never gates the charge ──
    test('an unidentifiable product still reserves, logged as "(unspecified product)"', () => {
        const charge = buildDepositCharge('I will take it', [], 'fixed_1500');
        assert.equal(charge.ok, true, 'an unknown product must not block a fixed deposit');
        assert.equal(charge.depositAmount, 1500);
        assert.equal(charge.unitAmountCents, 150000);
        assert.equal(charge.metadata.product_label, UNSPECIFIED_PRODUCT_LABEL);
        assert.equal(UNSPECIFIED_PRODUCT_LABEL, '(unspecified product)');
    });

    test('extractProductLabel prefers a named product, then a category, then the placeholder', () => {
        assert.equal(extractProductLabel('I want the Solaris Sofa', []), 'Solaris Sofa');
        assert.equal(extractProductLabel('ok', [{ role: 'assistant', content: 'The Ottoman Bed is available.' }]), 'Ottoman Bed');
        // Generic wording still yields something more useful than the placeholder.
        assert.match(extractProductLabel('I want to reserve a sofa', []), /sofa/i);
        assert.notEqual(extractProductLabel('I want to reserve a duvet set', []), UNSPECIFIED_PRODUCT_LABEL);
        assert.equal(extractProductLabel('I will take it', []), UNSPECIFIED_PRODUCT_LABEL);
    });

    test('the most recently mentioned product is the one recorded', () => {
        const label = extractProductLabel('I want that one', [
            { role: 'user', content: 'tell me about the Solaris Sofa' },
            { role: 'assistant', content: 'It is one of our premium sofas.' },
            { role: 'user', content: 'what about the Ottoman Bed?' },
            { role: 'assistant', content: 'The Ottoman Bed is also available.' }
        ]);
        assert.equal(label, 'Ottoman Bed');
    });

    // ── The wall bed flows must not regress ──
    test('wall bed deposits still offer 10% plus the fixed amounts', () => {
        const offer = computeDepositOffer('10ft', [
            { role: 'user', content: 'I want a Murano Queen Sofa with side cabinets around it, how much in total?' },
            { role: 'assistant', content: 'Sure! What is the total height of the wall, in feet?' },
            { role: 'user', content: '11ft' },
            { role: 'assistant', content: 'Got it. What is the total width of the wall, in feet?' }
        ]);
        assert.ok(offer);
        assert.equal(offer.depositType, DEPOSIT_TYPE_WITH_CABINETRY);
        assert.notEqual(offer.depositType, DEPOSIT_TYPE_RESERVATION);
        assert.equal(offer.grandTotal, 38300.11);
        assert.equal(offer.depositAmount, 3830.01);
        assert.deepEqual(offer.depositOptions.map(o => o.id), ['percent', ...RESERVATION_IDS]);
        assert.equal(offer.productLabel, 'Murano Queen Sofa', 'the model is mirrored for the Product column');
    });

    test('a priced wall bed with buy intent is still wallbed_only, not a reservation', () => {
        const basis = getDepositBasisFromContext('I want the Murano Single', [
            { role: 'user', content: 'Is there a Murano Single?' },
            { role: 'assistant', content: 'Yes — the Murano Single is RM 16,083.40 retail | RM 12,062.55 sale.' }
        ]);
        assert.ok(basis);
        assert.equal(basis.type, DEPOSIT_TYPE_WALLBED_ONLY);
        assert.equal(basis.productLabel, 'Murano Single');
        assert.ok(basis.total > 0, 'wall bed deposits keep their computed total');
    });

    // A customer mid-cabinetry must not be handed a cheap fixed reservation
    // instead of the combined quote being assembled.
    test('a cabinetry conversation in progress is not downgraded to a reservation', () => {
        const midFlow = [
            { role: 'user', content: 'Murano Queen with surround cabinets please' },
            { role: 'assistant', content: 'What is the total height of the wall, in feet?' }
        ];
        assert.equal(getDepositBasisFromContext('I want it', midFlow), null);
    });

    // ── Type labelling and the Sheet row ──
    test('the reservation type has a label and a Cabinets value, like the others', () => {
        assert.equal(depositTypeLabel(DEPOSIT_TYPE_RESERVATION), 'Product Reservation');
        assert.equal(depositIncludesCabinets(DEPOSIT_TYPE_RESERVATION), 'No');
    });

    test('a reservation row carries the product in column M and the right type', async () => {
        const row = await captureSheetRow({
            stripeSessionId: 'cs_reservation',
            cabinets: depositIncludesCabinets(DEPOSIT_TYPE_RESERVATION),
            depositOptionLabel: 'Fixed RM 2,500.00',
            depositAmountPaid: '2500.00',
            productLabel: 'Solaris Sofa'
        });
        assert.equal(row.length, 13, 'the row must be exactly as wide as the A:M range');
        assert.equal(row[12], 'Solaris Sofa', 'column M holds the product');
        assert.equal(row[2], '', 'column C is not repurposed — it stays the wall bed model');
        assert.equal(row[5], '2500.00');
        assert.equal(row[10], 'No');
        assert.equal(row[11], 'Fixed RM 2,500.00');
    });

    test('a wall bed row mirrors its model into the product column', async () => {
        const row = await captureSheetRow({
            stripeSessionId: 'cs_wallbed',
            wallBedModel: 'Murano Queen Sofa',
            productLabel: 'Murano Queen Sofa',
            cabinets: 'Yes'
        });
        assert.equal(row[2], 'Murano Queen Sofa');
        assert.equal(row[12], 'Murano Queen Sofa', 'Product means "the product" on every row');
    });

    // ── Notification ──
    test('the email names the product and the reservation type', () => {
        const { subject, text, html } = buildDepositEmail({
            depositTypeLabel: depositTypeLabel(DEPOSIT_TYPE_RESERVATION),
            depositType: DEPOSIT_TYPE_RESERVATION,
            productLabel: 'Solaris Sofa',
            depositOptionKind: 'fixed',
            depositOptionLabel: 'Fixed RM 2,500.00',
            depositAmountPaid: '2500.00',
            quoteRef: 'MQS-20260916-AB12'
        });
        assert.equal(subject, 'New Deposit — Product Reservation (Solaris Sofa)');
        assert.match(text, /^Deposit type: Product Reservation$/m);
        assert.match(text, /^Product: Solaris Sofa$/m);
        assert.match(text, /not applicable — fixed reservation deposit/);
        assert.doesNotMatch(text, /Grand total: RM \?/, 'must not imply a total exists');
        assert.match(html, /Solaris Sofa/);
        assert.match(html, /Product/);
    });

    test('the email still names the wall bed model for wall bed deposits', () => {
        const { subject, text } = buildDepositEmail({
            depositTypeLabel: 'Wall Bed Only',
            wallBedModel: 'Murano Queen',
            productLabel: 'Murano Queen',
            depositPercent: '10',
            grandTotal: '14371.55',
            depositAmountPaid: '1437.16'
        });
        assert.equal(subject, 'New Deposit — Wall Bed Only (Murano Queen)');
        assert.match(text, /Wall bed model: Murano Queen/);
        assert.match(text, /Grand total: RM 14371\.55/);
    });
});

// =============================================================
// Corner installations — the side-cabinet COUNT must reach the formula.
//
// This is a documented past incident: calculateCabinetPrice() has always
// accepted `sides`, and knowledge/cabinetry.js has always told the bot to use
// sides = 1 for a corner, but the api/chat.js call site quietly stopped passing
// it, so every quote silently defaulted to 2. Nothing failed when that
// happened, which is exactly why the money assertions below exist: they pin
// that changing the count actually changes what the customer is quoted.
// =============================================================
describe('cabinetry: corner installs price one side cabinet, not two', () => {
    // Assistant phrasing matters — extractCabinetryDimensions() reads the
    // preceding bot turn to interpret a bare "9ft", and keys on "height".
    const measured = [
        { role: 'user', content: 'I want a Murano Queen with surround cabinets' },
        { role: 'assistant', content: 'What is the height of your wall?' },
        { role: 'user', content: '9ft' },
        { role: 'assistant', content: 'And the total wall width?' },
        { role: 'user', content: '12ft' }
    ];
    const asked = [...measured, { role: 'assistant', content: 'Are both sides open or only one?' }];

    describe('detectSideCabinetCount', () => {
        const sides = (msg, history = []) => detectSideCabinetCount(msg, history);
        const AFTER_QUESTION = [{ role: 'assistant', content: 'Are both sides open or only one?' }];

        test('defaults to 2 with no signal at all', () => {
            assert.equal(sides('My wall is 9ft high and 12ft wide'), 2);
            assert.equal(sides('how much for a Murano Queen with cabinets?'), 2);
        });

        test('reads an unprompted corner or one-side statement as 1', () => {
            for (const text of [
                'it sits in the corner of the room',
                'the bed is in a corner',
                'one side is against the wall',
                'only one side is open',
                'I only want one cabinet',
                'just one cabinet please',
                'cabinets only on the left',
                'right side only'
            ]) {
                assert.equal(sides(text), 1, `expected 1 side for: ${text}`);
            }
        });

        test('reads the answer to the bot own both-sides-or-one question', () => {
            for (const [reply, expected] of [
                ['one', 1], ['just one', 1], ['only one', 1], ['one side', 1],
                ['left only', 1], ['right only', 1],
                ['both', 2], ['both sides', 2], ['two', 2], ['2', 2]
            ]) {
                assert.equal(sides(reply, AFTER_QUESTION), expected, `reply "${reply}"`);
            }
        });

        test('an unrelated reply to that question does not drop to 1', () => {
            // A measurement, or a plain "no", carries no side information —
            // staying at 2 is the safe reading.
            assert.equal(sides('12ft', AFTER_QUESTION), 2);
            assert.equal(sides('no, it is on an open wall', [
                { role: 'assistant', content: 'Is it going into a corner?' }
            ]), 2);
        });

        test('only the customer words count — the bot saying "corner" is not a signal', () => {
            // Otherwise the bot explaining what a corner install means would
            // re-price the quote all by itself.
            assert.equal(sides('what is the total then?', [
                { role: 'assistant', content: 'A corner install only needs one side cabinet, so it costs less.' },
                { role: 'user', content: 'ok' }
            ]), 2);
        });

        test('a later correction wins over an earlier one', () => {
            assert.equal(sides('actually both sides are open', [
                { role: 'user', content: 'it is in a corner' }
            ]), 2);
        });

        test('a catalog product named "Corner" is not a corner install', () => {
            // "Axil Corner Bookshelf" lives in knowledge/basicfurniture.js.
            assert.equal(sides('do you have the Axil Corner Bookshelf?'), 2);
        });

        test('"two" in ordinary prose is a measurement, not a side count', () => {
            // Only trusted as a direct answer to the sides question, which is
            // why this must not flip anything on its own.
            assert.equal(sides('there is two metres of wall left over'), 2);
        });
    });

    describe('the count reaches the formula and the money moves', () => {
        const twoSides = getCabinetryEstimateFromContext('how much would that cost?', measured);
        const oneSide = getCabinetryEstimateFromContext('only one side', asked);

        test('both conversations actually produce an estimate', () => {
            // Guards the fixtures themselves: a null here would make every
            // assertion below vacuous rather than failing loudly.
            assert.ok(twoSides && !twoSides.blocked, 'two-side fixture produced no estimate');
            assert.ok(oneSide && !oneSide.blocked, 'corner fixture produced no estimate');
        });

        test('a normal conversation still prices two sides', () => {
            assert.equal(twoSides.sides, 2);
            assert.equal(twoSides.sideCostTotal, twoSides.sideCostPerSide * 2);
        });

        test('a corner conversation prices exactly one side', () => {
            assert.equal(oneSide.sides, 1);
            assert.equal(oneSide.sideCostTotal, oneSide.sideCostPerSide,
                'one side must cost one side, not two');
        });

        test('the corner grand total is genuinely lower', () => {
            // The whole point of the bug: a corner customer was over-quoted.
            assert.ok(oneSide.grandTotal < twoSides.grandTotal);
            assert.equal(
                Math.round((twoSides.grandTotal - oneSide.grandTotal) * 100) / 100,
                twoSides.sideCostPerSide,
                'the saving is exactly one side cabinet'
            );
        });

        test('the leftover-width geometry is deliberately unchanged', () => {
            // Documented decision: `sides` scales the COUNT only. Whether a true
            // corner should instead put the FULL leftover width on the one open
            // side is an open business question with MOCOF — if that is ever
            // answered "yes", this is the assertion that should fail and force
            // the change to be deliberate.
            assert.equal(oneSide.sideCabinetWidthFt, twoSides.sideCabinetWidthFt);
            assert.equal(oneSide.sideCostPerSide, twoSides.sideCostPerSide);
            assert.equal(oneSide.topCost, twoSides.topCost, 'the overhead cabinet is priced by wall width');
        });

        test('the price guardrail allows the corner total it just computed', () => {
            // Without this the bot would state the correct corner price and the
            // guardrail would flag it as hallucinated, replacing a right answer
            // with the WhatsApp fallback.
            const allowed = computeCabinetryAllowedAmounts('only one side', asked);
            assert.ok(allowed.includes(oneSide.grandTotal), 'corner grand total must be allow-listed');
            assert.ok(allowed.includes(oneSide.total));
            assert.ok(allowed.includes(oneSide.sideCostTotal));
        });
    });
});

// =============================================================
// Staff invoice tool — catalog price resolution.
//
// The money-safety rule for this repo is that prices come from code, never from
// the model. The staff tool now leans on that directly: the model returns only
// product NAMES, and lib/productPricing.js resolves the figure. Two things
// therefore need pinning — that the lookup is right, and that it refuses to
// guess, because a wrong price here goes straight onto a customer's invoice.
//
// The BASIC_SOFA_PRICING block below is a drift guard in the same spirit as the
// wall-bed table checks above: that array and the prose in
// getBasicFurnitureKnowledge() are two copies of one fact, and the prose is the
// source of truth.
// =============================================================
describe('staff invoice tool: catalog pricing', () => {
    describe('BASIC_SOFA_PRICING matches the knowledge prose', () => {
        const prose = getBasicFurnitureKnowledge();

        test('every tabulated sofa appears in the prose with the same two figures', () => {
            for (const sofa of BASIC_SOFA_PRICING) {
                // Prose shape: "* Theta Sofa — RM 3,699.00 (retail) | RM 2,589.30 (sale)"
                const line = prose.split('\n').find(l => l.includes(`* ${sofa.label} —`));
                assert.ok(line, `${sofa.label} is tabulated but missing from the prose`);

                const figures = [...line.matchAll(/RM\s*([\d,]+\.\d{2})/g)]
                    .map(m => Number(m[1].replace(/,/g, '')));
                assert.ok(figures.length >= 2, `${sofa.label}: expected retail and sale in "${line}"`);
                assert.equal(figures[0], sofa.retail, `${sofa.label} retail drifted from the prose`);
                assert.equal(figures[1], sofa.sale, `${sofa.label} sale drifted from the prose`);
            }
        });

        test('no priced sofa in the prose was left out of the table', () => {
            // Otherwise a sofa staff can sell silently falls back to manual
            // entry, which looks like the tool simply not knowing the product.
            const prosed = [...prose.matchAll(/^\* (\w[\w ]*?Sofa) — RM/gm)].map(m => m[1]);
            const tabulated = new Set(BASIC_SOFA_PRICING.map(s => s.label));
            for (const label of prosed) {
                assert.ok(tabulated.has(label), `${label} is priced in the prose but not in BASIC_SOFA_PRICING`);
            }
            assert.equal(BASIC_SOFA_PRICING.length, prosed.length);
        });

        test('sale is below retail for every entry', () => {
            for (const sofa of BASIC_SOFA_PRICING) {
                assert.ok(sofa.sale > 0 && sofa.sale < sofa.retail, `${sofa.label}: sale must be below retail`);
            }
        });
    });

    describe('resolveProductPrice', () => {
        test('resolves a wall bed, including staff shorthand', () => {
            assert.deepEqual(resolveProductPrice('murano q'), { label: 'Murano Queen', salePrice: 14371.55 });
            assert.deepEqual(resolveProductPrice('Murano Queen'), { label: 'Murano Queen', salePrice: 14371.55 });
            assert.equal(resolveProductPrice('gioco single desk').salePrice, 17538.11);
            // The negative lookaheads in WALLBED_MODEL_PRICING are what keep
            // these three apart — a bare "Murano Queen" must not win here.
            assert.equal(resolveProductPrice('murano queen sofa').label, 'Murano Queen Sofa');
            assert.equal(resolveProductPrice('gioco single').label, 'Gioco Single');
        });

        test('resolves a Basic sofa from its bare model name', () => {
            assert.deepEqual(resolveProductPrice('lumina'), { label: 'Lumina Sofa', salePrice: 7069.30 });
            assert.equal(resolveProductPrice('theta sofa').salePrice, 2589.30);
            assert.equal(resolveProductPrice('Cozelle Sofa').salePrice, 16729.30);
        });

        test('always returns the SALE price, never retail', () => {
            // An invoice quoting retail would contradict the price the customer
            // was already given in chat, where sale prices are what get quoted.
            for (const model of WALLBED_MODEL_PRICING) {
                assert.equal(resolveProductPrice(model.label).salePrice, model.sale);
            }
            for (const sofa of BASIC_SOFA_PRICING) {
                assert.equal(resolveProductPrice(sofa.label).salePrice, sofa.sale);
            }
        });

        test('returns null for anything the catalog cannot price', () => {
            for (const name of [
                'delivery charge', 'custom cabinetry job', 'site survey fee',
                'balance payment', 'bedsheets', 'sofa', '', '   '
            ]) {
                assert.equal(resolveProductPrice(name), null, `expected null for "${name}"`);
            }
        });

        test('never throws on a non-string', () => {
            for (const bad of [null, undefined, 42, {}, [], true]) {
                assert.equal(resolveProductPrice(bad), null);
            }
        });

        test('a near-miss product name does not borrow another product\'s price', () => {
            // "Nebulatte" is a Basic coffee table; "Nebula Sofa" is a sofa. The
            // \b anchor is the only thing keeping them apart.
            assert.equal(resolveProductPrice('nebulatte'), null);
            assert.equal(resolveProductPrice('Nebula Sofa').label, 'Nebula Sofa');
            assert.equal(resolveProductPrice('Axil Corner Bookshelf'), null);
        });
    });

    describe('applyCatalogPricing', () => {
        test('fills the sale price and canonical label, overriding the model', () => {
            // The model is told not to send an amount; if it sends one anyway it
            // must not survive next to a real catalog figure.
            const [line] = applyCatalogPricing([{ description: 'murano q', amount: 99 }]);
            assert.equal(line.description, 'Murano Queen');
            assert.equal(line.amount, 14371.55);
            assert.equal(line.pricedFromCatalog, true);
        });

        test('leaves a custom line untouched for manual entry', () => {
            const [line] = applyCatalogPricing([{ description: 'custom cabinetry job', amount: null }]);
            assert.equal(line.description, 'custom cabinetry job');
            assert.equal(line.amount, null, 'staff must type this one in');
            assert.equal(line.pricedFromCatalog, undefined, 'an unpriced line is not flagged as catalog-priced');
        });

        test('handles a mixed invoice one line at a time', () => {
            const priced = applyCatalogPricing([
                { description: 'murano q', amount: null },
                { description: 'lumina', amount: null },
                { description: 'delivery charge', amount: null }
            ]);
            assert.deepEqual(priced.map(l => l.amount), [14371.55, 7069.30, null]);
            assert.deepEqual(priced.map(l => l.description), ['Murano Queen', 'Lumina Sofa', 'delivery charge']);
        });

        test('survives junk without throwing', () => {
            assert.deepEqual(applyCatalogPricing([]), []);
            assert.equal(applyCatalogPricing(null), null);
            const rows = applyCatalogPricing([null, 'nope', { description: 'murano q', amount: null }]);
            assert.equal(rows[0], null);
            assert.equal(rows[1], 'nope');
            assert.equal(rows[2].amount, 14371.55);
        });

        test('what it produces still passes validateInvoiceInput', () => {
            // The whole point is that this feeds the existing review card and
            // the unchanged create-invoice contract. The extra display flag
            // must not trip the validator.
            const result = validateInvoiceInput({
                customerName: 'Ahmad',
                customerEmail: 'ahmad@example.com',
                currency: 'myr',
                lineItems: applyCatalogPricing([{ description: 'murano q', amount: null }])
            });
            assert.equal(result.ok, true, result.ok ? '' : result.error);
            assert.equal(result.value.lineItems[0].description, 'Murano Queen');
            assert.equal(result.value.lineItems[0].amountCents, 1437155);
        });
    });
});
