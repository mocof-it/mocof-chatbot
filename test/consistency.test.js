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

import {
    getRelevantKnowledge,
    buildSystemPrompt,
    extractCabinetryDimensions,
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
    DEPOSIT_PERCENT
} from '../api/chat.js';

import { generateQuoteRef, QUOTE_REF_PATTERN } from '../lib/reference.js';

import { calculateCabinetPrice, getCabinetryKnowledge, SIDE_CABINET_MAX_HEIGHT_FT } from '../knowledge/cabinetry.js';
import { getWallBedKnowledge, WALLBED_MODEL_WIDTHS_FT, WALLBED_MODEL_PRICING } from '../knowledge/wallbeds.js';
import { getSofaBedKnowledge } from '../knowledge/sofabeds.js';
import { getTableKnowledge } from '../knowledge/tables.js';
import { getKitchenKnowledge } from '../knowledge/kitchen.js';
import { getWardrobeKnowledge } from '../knowledge/wardrobes.js';
import { getShowroomKnowledge } from '../knowledge/showroom.js';
import { getWarrantyKnowledge } from '../knowledge/warranty.js';
import { getRenovationKnowledge } from '../knowledge/renovation.js';
import { getBasicFurnitureKnowledge } from '../knowledge/basicfurniture.js';
import { PRODUCT_IMAGES, getRelevantImages } from '../knowledge/productImages.js';

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

    test('Murano + a ceiling at or above 7ft is NOT a conflict', () => {
        const history = [{ role: 'assistant', content: "I'd recommend the Murano Queen." }];
        assert.equal(detectMuranoCeilingConflict('7ft', history), null);
        assert.equal(detectMuranoCeilingConflict('11ft', history), null);
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

    test('MURANO_MIN_CEILING_FT is the same constant as the cabinetry side-cabinet height, by construction', () => {
        assert.equal(MURANO_MIN_CEILING_FT, SIDE_CABINET_MAX_HEIGHT_FT);
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
        ['cabinetry', getCabinetryKnowledge()]
    ];

    for (const [name, text] of modules) {
        test(`${name}.js knowledge text is non-trivial and has no unresolved template markers`, () => {
            assert.ok(text.length > 50, `${name} knowledge text looks too short (${text.length} chars)`);
            assert.ok(!/undefined|\[object Object\]|NaN/.test(text), `${name} knowledge text contains a stray runtime artifact`);
        });
    }
});