// =============================================================
// FILE: lib/depositNotification.js
// Composes the deposit notification email that api/stripe-webhook.js sends
// via Resend. Pure string building — no network, no dependencies, no env
// vars — which is the whole point of it living here rather than inline in
// the webhook: the webhook imports `stripe` and therefore cannot be loaded
// by the test suite at all, so anything left inside it is untestable.
//
// Every value comes from Stripe session metadata that api/create-deposit.js
// wrote at CHARGE time. Nothing here is re-derived from the chat transcript
// or the model's reply — the deposit type shown in this email is the same
// field that decided the amount charged and the Sheet's Cabinets column.
// =============================================================

const UNKNOWN_TYPE_LABEL = 'Type Not Recorded';

function orNone(value, fallback = '(not provided)') {
    return (value === null || value === undefined || value === '') ? fallback : value;
}

/**
 * @param {Object} details - as assembled by api/stripe-webhook.js
 * @param {string} [details.depositTypeLabel] - "Wall Bed Only" / "Wall Bed + Cabinetry",
 *        resolved by depositTypeLabel() in api/chat.js. Empty when the session
 *        predates the deposit_type field, or carries a type this build doesn't know.
 * @returns {{ subject: string, text: string }}
 */
export function buildDepositEmail(details = {}) {
    // An empty label means the type genuinely isn't known for this session —
    // say so rather than picking one of the two and being confidently wrong.
    const typeLabel = details.depositTypeLabel || UNKNOWN_TYPE_LABEL;
    const model = details.wallBedModel;

    // "New Deposit — Wall Bed + Cabinetry (Murano Queen Sofa)". The model is
    // omitted entirely rather than rendered as "(unknown)" when absent.
    const subject = model
        ? `New Deposit — ${typeLabel} (${model})`
        : `New Deposit — ${typeLabel}`;

    const lines = [
        `Deposit type: ${typeLabel}`,
        '',
        `A ${orNone(details.depositPercent, '?')}% deposit has been paid.`,
        '',
        `Quote ref: ${orNone(details.quoteRef, '(none)')}`,
        `Wall bed model: ${orNone(details.wallBedModel, '(none)')}`,
        `Grand total: RM ${orNone(details.grandTotal, '?')}`,
        `Deposit paid: RM ${orNone(details.depositAmountPaid, '?')}`
    ];

    // Only meaningful for a wall-bed-plus-cabinetry deposit. A wall-bed-only
    // deposit has no wall being surveyed, so the section is omitted outright
    // rather than printed with blanks beside every field.
    const measurements = [];
    if (details.wallHeightFt) measurements.push(`  Wall height: ${details.wallHeightFt}ft`);
    if (details.totalWallWidthFt) measurements.push(`  Total wall width: ${details.totalWallWidthFt}ft`);

    if (measurements.length > 0) {
        lines.push('', 'Cabinetry estimate (from the customer\'s own measurements):', ...measurements);
    }

    lines.push(
        '',
        `Customer name: ${orNone(details.customerName)}`,
        `Customer email: ${orNone(details.customerEmail)}`,
        `Customer phone: ${orNone(details.customerPhone)}`,
        '',
        `Stripe session: ${orNone(details.stripeSessionId, '(none)')}`,
        `Recorded at: ${details.recordedAt || new Date().toISOString()}`
    );

    return { subject, text: lines.join('\n') };
}

export { UNKNOWN_TYPE_LABEL };
