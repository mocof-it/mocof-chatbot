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
//
// Two renderings are returned: `text` and `html`. Both are sent on the same
// Resend message — the HTML table is what management reads, and the plain
// text is the fallback for clients that don't render HTML (and a small
// deliverability win, since text-only-capable filters treat a multipart
// message more kindly than an HTML-only one). They must always show the
// SAME data; only the presentation differs.
// =============================================================

const UNKNOWN_TYPE_LABEL = 'Type Not Recorded';

function orNone(value, fallback = '(not provided)') {
    return (value === null || value === undefined || value === '') ? fallback : value;
}

// Values here are customer-supplied (name, email, phone) and flow in from
// Stripe metadata, so they are escaped before being interpolated into markup —
// a name containing "&" or "<" would otherwise corrupt the table or inject
// tags. The plain-text rendering needs none of this, which is why escaping
// lives here rather than around orNone().
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')   // must run first, or it double-escapes the entities below
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Inline styles only. Gmail and Outlook strip <style> blocks and <head>
// entirely, so a class-based or stylesheet layout silently renders unstyled.
// No external images, web fonts, or JS for the same reason.
const TABLE_STYLE = 'border-collapse:collapse;width:100%;max-width:640px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222222;';
const SECTION_STYLE = 'border:1px solid #dddddd;padding:8px 10px;background-color:#f4f4f4;font-weight:bold;text-align:left;';
const LABEL_STYLE = 'border:1px solid #dddddd;padding:8px 10px;background-color:#fafafa;font-weight:bold;text-align:left;width:40%;';
const VALUE_STYLE = 'border:1px solid #dddddd;padding:8px 10px;text-align:left;';
const BANNER_STYLE = 'border:1px solid #dddddd;padding:10px;background-color:#222222;color:#ffffff;font-weight:bold;text-align:left;font-size:15px;';

function sectionRow(title) {
    return `<tr><td colspan="2" style="${SECTION_STYLE}">${escapeHtml(title)}</td></tr>`;
}

function fieldRow(label, value) {
    return `<tr><td style="${LABEL_STYLE}">${escapeHtml(label)}</td>`
        + `<td style="${VALUE_STYLE}">${escapeHtml(value)}</td></tr>`;
}

/**
 * @param {Object} details - as assembled by api/stripe-webhook.js
 * @param {string} [details.depositTypeLabel] - "Wall Bed Only" / "Wall Bed + Cabinetry",
 *        resolved by depositTypeLabel() in api/chat.js. Empty when the session
 *        predates the deposit_type field, or carries a type this build doesn't know.
 * @returns {{ subject: string, text: string, html: string }}
 */
export function buildDepositEmail(details = {}) {
    // An empty label means the type genuinely isn't known for this session —
    // say so rather than picking one of the two and being confidently wrong.
    const typeLabel = details.depositTypeLabel || UNKNOWN_TYPE_LABEL;
    const model = details.wallBedModel;

    // Resolved once and shared by both renderings: calling new Date() twice
    // could stamp the text and the HTML with different timestamps for the
    // same payment.
    const recordedAt = details.recordedAt || new Date().toISOString();

    // "New Deposit — Wall Bed + Cabinetry (Murano Queen Sofa)". The model is
    // omitted entirely rather than rendered as "(unknown)" when absent.
    const subject = model
        ? `New Deposit — ${typeLabel} (${model})`
        : `New Deposit — ${typeLabel}`;

    // Only meaningful for a wall-bed-plus-cabinetry deposit. A wall-bed-only
    // deposit has no wall being surveyed, so the section is omitted outright
    // rather than printed with blanks beside every field. Computed once and
    // used by both renderings so they can never disagree about whether the
    // cabinetry section belongs on this email.
    const hasWallHeight = Boolean(details.wallHeightFt);
    const hasWallWidth = Boolean(details.totalWallWidthFt);
    const hasMeasurements = hasWallHeight || hasWallWidth;

    // ── Plain text ────────────────────────────────────────────────
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

    const measurements = [];
    if (hasWallHeight) measurements.push(`  Wall height: ${details.wallHeightFt}ft`);
    if (hasWallWidth) measurements.push(`  Total wall width: ${details.totalWallWidthFt}ft`);

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
        `Recorded at: ${recordedAt}`
    );

    // ── HTML table ────────────────────────────────────────────────
    // Same values, same fallbacks, same conditional cabinetry section as the
    // text above — presentation is the only difference.
    const rows = [
        // The deposit type leads, as it does in the text version: it is the one
        // field that changes what the payment actually covers.
        `<tr><td colspan="2" style="${BANNER_STYLE}">Deposit type: ${escapeHtml(typeLabel)}</td></tr>`,
        sectionRow('Deposit'),
        fieldRow('Deposit %', `${orNone(details.depositPercent, '?')}%`),
        fieldRow('Quote ref', orNone(details.quoteRef, '(none)')),
        fieldRow('Wall bed model', orNone(details.wallBedModel, '(none)')),
        fieldRow('Grand total', `RM ${orNone(details.grandTotal, '?')}`),
        fieldRow('Deposit paid', `RM ${orNone(details.depositAmountPaid, '?')}`)
    ];

    if (hasMeasurements) {
        rows.push(sectionRow('Cabinetry estimate (from the customer\'s own measurements)'));
        if (hasWallHeight) rows.push(fieldRow('Wall height', `${details.wallHeightFt}ft`));
        if (hasWallWidth) rows.push(fieldRow('Total wall width', `${details.totalWallWidthFt}ft`));
    }

    rows.push(
        sectionRow('Customer'),
        fieldRow('Name', orNone(details.customerName)),
        fieldRow('Email', orNone(details.customerEmail)),
        fieldRow('Phone', orNone(details.customerPhone)),
        sectionRow('Record'),
        fieldRow('Stripe session', orNone(details.stripeSessionId, '(none)')),
        fieldRow('Recorded at', recordedAt)
    );

    const html = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${TABLE_STYLE}">`
        + `<tbody>${rows.join('')}</tbody>`
        + '</table>';

    return { subject, text: lines.join('\n'), html };
}

export { UNKNOWN_TYPE_LABEL, escapeHtml };
