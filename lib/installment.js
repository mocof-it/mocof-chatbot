// =============================================================
// FILE: lib/installment.js
// Bank credit-card installment plans, as REFERENCE figures printed on the
// MOCOF invoice PDF. Pure functions, no network, no dependencies — the same
// reason lib/invoiceInput.js lives here rather than inside the endpoint.
//
// Nothing in this file touches money that is actually charged. MOCOF invoices
// and Stripe collects the FULL price; the customer's bank is what converts
// their card charge into monthly installments afterwards, under the bank's own
// terms. These numbers exist so a staff member can answer "what would that be
// per month?" without a calculator, and so the customer sees the same answer
// on paper. Treat them as printed text that happens to be arithmetic.
// =============================================================

/**
 * The eight terms MOCOF quotes, in the order they are printed.
 *
 * Rates are uniform across every participating bank and are NOT waivable, so
 * there is no per-bank table and no override path — one frozen list is the
 * whole source of truth. Adding, removing or repricing a term is a deliberate
 * code change here, never something a request can ask for.
 *
 * `rate` is a decimal fraction (0.025 = 2.5%) because that is what the formula
 * multiplies by; the percentage is only ever a display concern.
 */
export const INSTALLMENT_RATES = Object.freeze([
    Object.freeze({ months: 3, rate: 0.025 }),
    Object.freeze({ months: 6, rate: 0.03 }),
    Object.freeze({ months: 12, rate: 0.05 }),
    Object.freeze({ months: 18, rate: 0.07 }),
    Object.freeze({ months: 24, rate: 0.075 }),
    Object.freeze({ months: 36, rate: 0.09 }),
    Object.freeze({ months: 48, rate: 0.12 }),
    Object.freeze({ months: 60, rate: 0.14 })
]);

/** Money is quoted to the sen, and rounded once so no caller re-derives it. */
function round2(value) {
    return Math.round(value * 100) / 100;
}

/**
 * @param {number} priceRm the invoice total, in ringgit
 * @returns {Array<{ months: number, rate: number, totalRm: number, monthlyRm: number }>}
 *          one entry per term, in INSTALLMENT_RATES order
 *
 * Returns an EMPTY array for anything that is not a finite number above zero,
 * rather than throwing. The caller runs this after a real Stripe invoice has
 * already been created and finalized: an exception there would be caught by
 * the endpoint's error handler and reported to the staff member as a failure,
 * for an invoice the customer has in fact been sent. A missing reference table
 * is a far smaller problem than a created invoice described as a failed one.
 *
 * `monthlyRm × months` deliberately need not equal `totalRm` to the sen — each
 * is rounded for display, and the bank, not this file, decides how it collects
 * the remainder. The note printed beside the table says the bank's terms
 * govern, which is why that discrepancy is acceptable in print.
 */
export function computeInstallmentOptions(priceRm) {
    if (typeof priceRm !== 'number' || !Number.isFinite(priceRm) || priceRm <= 0) {
        return [];
    }

    return INSTALLMENT_RATES.map(({ months, rate }) => {
        const totalRm = round2(priceRm * (1 + rate));
        return {
            months,
            rate,
            totalRm,
            // Divided from the rounded total, not from the raw product, so the
            // printed monthly figure is consistent with the printed total.
            monthlyRm: round2(totalRm / months)
        };
    });
}
