// =============================================================
// FILE: api/staff-resolve-price.js
// Looks up one product's catalogue sale price for the staff invoice form.
// Endpoint: POST /api/staff-resolve-price
// Body: { productName }   ->   { resolved, label, salePrice }
// Env vars: STAFF_*
//
// This exists so public/staff.html can pre-fill a price without the browser
// ever holding a copy of the catalogue. The figure is resolved server-side from
// the knowledge base, which is the same money-safety rule the rest of this repo
// follows: a price comes from code, never from a model and never from the
// client.
//
// It only ANSWERS a question — it creates nothing and charges nothing. The
// price it returns is a suggested default that the staff member can type over,
// and api/staff-create-invoice.js remains the sole authority on what gets
// invoiced (whatever the human confirmed).
//
// STAFF ROUTE — same-origin only, auth first.
// =============================================================

import { requireStaffAuth } from '../lib/staffAuth.js';

// Long enough for any real product name, short enough that this endpoint can't
// be used to push megabytes of text through a regex table.
const MAX_PRODUCT_NAME_LENGTH = 200;

const NOT_RESOLVED = { resolved: false, label: null, salePrice: null };

/**
 * lib/productPricing.js is imported lazily and defensively because a "no
 * catalogue price" answer is a perfectly normal outcome of this endpoint — a
 * custom carpentry line has no catalogue price either. A clone where the module
 * is missing should therefore degrade to manual price entry, which still works,
 * rather than 500 and make the whole form look broken.
 *
 * Cached after the first call so a missing module isn't retried on every
 * keystroke-blur, and a present one isn't re-resolved.
 */
let pricingModulePromise = null;
function loadPricingModule() {
    if (!pricingModulePromise) {
        pricingModulePromise = import('../lib/productPricing.js').catch((err) => {
            console.warn('[staff] lib/productPricing.js unavailable — prices fall back to manual entry:', err.message);
            return null;
        });
    }
    return pricingModulePromise;
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Before any lookup happens. The catalogue is not secret, but an
    // unauthenticated caller has no business enumerating it through this route,
    // and every staff endpoint gates the same way.
    if (!requireStaffAuth(req, res)) return;

    const { productName } = req.body || {};
    if (typeof productName !== 'string') {
        return res.status(400).json({ error: 'productName must be a string' });
    }
    if (productName.length > MAX_PRODUCT_NAME_LENGTH) {
        return res.status(400).json({ error: 'productName is too long' });
    }

    // An empty box is not an error — the form asks as soon as the field is
    // touched, which includes being cleared.
    if (productName.trim() === '') {
        return res.status(200).json(NOT_RESOLVED);
    }

    const mod = await loadPricingModule();
    if (!mod || typeof mod.resolveProductPrice !== 'function') {
        return res.status(200).json(NOT_RESOLVED);
    }

    let match = null;
    try {
        match = mod.resolveProductPrice(productName);
    } catch (err) {
        // The resolver is pure and is not expected to throw, but a thrown error
        // here must still read as "no catalogue price" rather than as a failure
        // of the form the staff member is in the middle of filling in.
        console.error('[staff] price resolution failed for a product name:', err.message);
        return res.status(200).json(NOT_RESOLVED);
    }

    if (!match) return res.status(200).json(NOT_RESOLVED);

    return res.status(200).json({
        resolved: true,
        label: match.label,
        salePrice: match.salePrice
    });
}
