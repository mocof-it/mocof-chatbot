// =============================================================
// FILE: lib/installment.js
// MOCOF's OWN installment terms. Pure functions, no network, no dependencies —
// the same reason lib/invoiceInput.js lives here rather than inside the
// endpoint, and why this module can be imported by both.
//
// This file used to hold an eight-term table of BANK credit-card plans, printed
// on the invoice as reference only while Stripe charged the full price. That
// framing was wrong: MOCOF is the lender here. Choosing a term CHANGES WHAT THE
// CUSTOMER OWES — the interest is added to the invoice and Stripe collects the
// interest-inclusive total — so everything below is on the money path and is
// treated as such. Nothing here is reference text any more.
//
// Terms beyond 12 months are handled off-tool ("subject to approval") and are
// deliberately absent: a term that is not in INSTALLMENT_TERMS cannot be
// invoiced through this tool at all.
// =============================================================

/**
 * The two terms MOCOF offers, in the order they are presented.
 *
 * Single source of truth, and frozen: a rate is a priced business decision, so
 * changing or adding one is a deliberate code change here and nothing at
 * runtime — no request, and no staff member — can introduce a term or a rate.
 *
 * `rate` is a decimal fraction (0.03 = 3%) because that is what the arithmetic
 * multiplies by; the percentage is only ever a display concern.
 */
export const INSTALLMENT_TERMS = Object.freeze([
    Object.freeze({ months: 6, rate: 0.03 }),
    Object.freeze({ months: 12, rate: 0.05 })
]);

/** The only accepted term lengths, derived so the two can never disagree. */
export const INSTALLMENT_MONTHS = Object.freeze(INSTALLMENT_TERMS.map(term => term.months));

/** Money is owed to the sen, and rounded once so no caller re-derives it. */
function round2(value) {
    return Math.round(value * 100) / 100;
}

/** The term's rate, or null when `months` is not one MOCOF offers. */
export function findInstallmentTerm(months) {
    return INSTALLMENT_TERMS.find(term => term.months === months) || null;
}

/**
 * @param {number} baseRm the line-item total before interest, in ringgit
 * @param {number} months 6 or 12
 * @returns {{ months: number, rate: number, interestRm: number, totalRm: number, monthlyRm: number }}
 *
 * THROWS on an unknown term or an unusable base, rather than returning a
 * fallback. This is the opposite of the old display-only function, which
 * returned an empty array so a cosmetic failure could never break an invoice.
 * The numbers are now what the customer is charged: a term this file does not
 * recognise must stop the invoice, never quietly produce one at the wrong
 * price. Callers validate the term first — see validateInvoiceInput(), which
 * rejects a bad term with a message instead of letting this throw.
 *
 * `monthlyRm × months` need not equal `totalRm` to the sen: the monthly figure
 * is rounded for printing, and collection is manual, so the final payment
 * absorbs the remainder. `totalRm` is the authoritative amount owed.
 */
export function computeInstallmentPlan(baseRm, months) {
    if (typeof baseRm !== 'number' || !Number.isFinite(baseRm) || baseRm <= 0) {
        throw new TypeError(`computeInstallmentPlan: base must be a positive finite number, got ${baseRm}`);
    }

    const term = findInstallmentTerm(months);
    if (!term) {
        throw new RangeError(
            `computeInstallmentPlan: ${months} is not an offered term (${INSTALLMENT_MONTHS.join(', ')} months)`);
    }

    const interestRm = round2(baseRm * term.rate);
    const totalRm = round2(baseRm + interestRm);

    return {
        months: term.months,
        rate: term.rate,
        interestRm,
        totalRm,
        // Divided from the rounded total rather than the raw sum, so the
        // printed monthly figure is consistent with the printed total.
        monthlyRm: round2(totalRm / months)
    };
}
