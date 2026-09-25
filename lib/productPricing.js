// =============================================================
// FILE: lib/productPricing.js
// Resolves a line item's price from the knowledge base, in code.
//
// This is the money-safety half of the staff invoice tool. api/staff-chat.js
// hands the model product NAMES and no prices, and the model emits names back;
// this module is what turns a name into a figure. So the number that lands on a
// customer's invoice comes from a table in this repo, never from a language
// model — the same rule api/chat.js enforces for the customer bot, arrived at
// from the other direction (there the model is checked AFTER the fact, here it
// is never asked for the number at all).
//
// Pure on purpose, like lib/invoiceInput.js: no stripe, no gemini, no network,
// nothing from api/chat.js. That is what lets the test suite import it — and
// api/staff-create-invoice.js, which pulls in `stripe`, cannot be loaded by
// tests at all, so anything left in there is untestable.
//
// SALE price always. MOCOF quotes sale prices everywhere else (see the
// PRODUCT RECOMMENDATION RULES in api/chat.js and the wall-bed estimate), so an
// invoice that quietly used retail would contradict the price the customer was
// already given in chat.
// =============================================================

import { WALLBED_MODEL_PRICING } from '../knowledge/wallbeds.js';
import { BASIC_SOFA_PRICING } from '../knowledge/basicfurniture.js';
import { normalizeProductName } from './productNames.js';

// Wall beds first, then sofas — the order the spec for this tool calls for, and
// it also happens to be the safe order: the wall-bed patterns carry negative
// lookaheads that make exactly one of them match a given name, while the sofa
// patterns are single distinctive words. Each table keeps its own internal
// order, which is load-bearing for the wall-bed one.
const PRICE_TABLES = [WALLBED_MODEL_PRICING, BASIC_SOFA_PRICING];

/**
 * Finds every DISTINCT product in one table whose pattern matches `text`.
 * Deliberately collects all of them rather than returning the first or last
 * hit — the way api/chat.js's extractSelectedWallBedPricing() takes "last
 * mention wins" is right for reading a conversation, but wrong here: this
 * function decides what to charge, so two candidates must be reported as two,
 * not silently resolved to one of them.
 */
function matchesIn(table, text) {
    const found = [];
    for (const entry of table) {
        if (!entry.pattern.test(text)) continue;
        if (!found.some(e => e.label === entry.label)) found.push(entry);
    }
    return found;
}

/**
 * @param {string} name a line-item description as the staff member or the model wrote it
 * @returns {{ label: string, salePrice: number } | null}
 *
 * Returns null — meaning "no catalog price, let the staff type one" — for
 * anything it cannot pin down to exactly one product. That covers custom work
 * ("custom cabinetry job"), delivery and survey fees, bedsheets (priced as
 * ranges, with no single figure to resolve), and cabinetry (computed from
 * measurements, not looked up). Guessing here would put a wrong number in front
 * of a customer, so ambiguity resolves to null rather than to a best effort.
 */
export function resolveProductPrice(name) {
    if (typeof name !== 'string' || name.trim() === '') return null;

    // Staff shorthand first: "murano q" is not something the catalog patterns
    // match ("queen" is simply absent), but normalizeProductName() already
    // expands it to "Murano Queen" and returns the text untouched whenever it
    // is unsure — so this only ever helps, never invents a product.
    const text = normalizeProductName(name);
    if (typeof text !== 'string' || text.trim() === '') return null;

    for (const table of PRICE_TABLES) {
        const found = matchesIn(table, text);
        if (found.length === 1) {
            return { label: found[0].label, salePrice: found[0].sale };
        }
        // More than one distinct product fits — we cannot tell which was meant.
        if (found.length > 1) return null;
    }

    return null;
}

/**
 * Fills in what the catalog knows, leaves everything else alone.
 *
 * A resolved line gets the canonical label and the catalog sale price, and the
 * catalog price OVERRIDES whatever amount came back with the proposal. That is
 * the point of the change: the model is not a pricing authority, so its number
 * (if it produced one despite being told not to) does not get to survive next
 * to a real one.
 *
 * `pricedFromCatalog` is set so public/staff.html can mark the field as
 * auto-filled. It is presentation only — the review card posts just
 * {description, amount}, so this flag never reaches the create-invoice
 * endpoint, and validateInvoiceInput() is unchanged and still the gate.
 *
 * NOTE: this is a better DEFAULT, not an enforcement point. Staff are trusted
 * and may type over any figure; whatever they confirm is what gets invoiced.
 */
export function applyCatalogPricing(lineItems) {
    if (!Array.isArray(lineItems)) return lineItems;

    return lineItems.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return item;

        const resolved = resolveProductPrice(item.description);
        if (!resolved) return item; // amount stays as-is (usually null) — staff types it

        return {
            ...item,
            description: resolved.label,
            amount: resolved.salePrice,
            pricedFromCatalog: true
        };
    });
}
