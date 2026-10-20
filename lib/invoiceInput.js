// =============================================================
// FILE: lib/invoiceInput.js
// Validation and parsing for the staff invoice tool. Pure functions, no
// network, no runtime dependencies (lib/productNames.js is likewise pure) —
// which is the point: api/staff-create-invoice.js
// imports `stripe` and therefore cannot be loaded by the test suite at all, so
// anything left inside it is untestable. Same rationale as
// lib/depositNotification.js.
//
// validateInvoiceInput() is the gate between staff input and real money. It
// runs on the SERVER against the fields the staff member confirmed, never
// against Gemini's raw output: the model proposes, a human edits, and this
// function decides whether the result is chargeable.
// =============================================================

import { normalizeProductName } from './productNames.js';

// Fat-finger guard. An order legitimately above this exists, but "typed an
// extra zero" is far more likely, and a wrong invoice sent to a customer is
// expensive to unwind. Raising it is a deliberate code change, not a runtime
// override — there is no way for a request to opt out.
export const MAX_INVOICE_AMOUNT_RM = 100000;
export const MAX_LINE_ITEMS = 50;
export const SUPPORTED_CURRENCY = 'myr';

// The same fat-finger reasoning as the amount cap, for the other factor in a
// line total. Nobody orders ten thousand wall beds; a five-digit quantity is a
// slipped keypress, and it would multiply straight into the money.
export const MAX_LINE_QUANTITY = 10000;

// Customer-facing detail fields. These are descriptive text printed on the
// invoice, not figures, so over-length input is TRIMMED rather than rejected —
// losing the tail of a long address line is a far better outcome than refusing
// to create an invoice the staff member is otherwise happy with. Stripe applies
// its own limits on top, and those errors already surface to staff verbatim.
const MAX_ADDRESS_PART_LENGTH = 200;
const MAX_DETAIL_LENGTH = 100;

// MOCOF invoices Malaysian customers. Stripe wants an ISO country on an
// address, and asking staff to pick one every time would be noise.
const DEFAULT_COUNTRY = 'MY';

// Deliberately loose: "plausible", not RFC 5322. The real proof an address
// works is Stripe delivering to it; this only catches obvious typos and empty
// values before they reach Stripe.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function fail(error) {
    return { ok: false, error };
}

/**
 * Accepts a number, or a string a human typed ("1,500", " RM 1500 ").
 * Returns null for anything that isn't a clean finite number — including
 * NaN, Infinity, booleans, and strings with leftover junk.
 */
function toAmount(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;

    const cleaned = raw.replace(/rm/gi, '').replace(/,/g, '').trim();
    if (cleaned === '' || !/^\d*\.?\d+$/.test(cleaned)) return null;

    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
}

/**
 * Quantity is a count of physical things, so only a whole number means
 * anything. Absent or blank is 1 — the overwhelmingly common case, and the
 * behaviour every invoice had before quantities existed.
 *
 * Returns null for anything that is not a clean integer, including "2.5",
 * booleans and Infinity. Deliberately does NOT round: a staff member who typed
 * a fraction meant something we cannot guess, and silently rounding it would
 * change what the customer is billed for.
 */
function toQuantity(raw) {
    if (raw === undefined || raw === null) return 1;

    if (typeof raw === 'string') {
        const cleaned = raw.trim();
        if (cleaned === '') return 1;
        return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
    }

    if (typeof raw === 'number') return Number.isInteger(raw) ? raw : null;

    return null;
}

/** Trim, and cut to length rather than failing — see MAX_DETAIL_LENGTH above. */
function trimmedText(raw, maxLength) {
    if (typeof raw !== 'string') return '';
    return raw.trim().slice(0, maxLength);
}

/**
 * Builds the Stripe-shaped address to put on the customer record, which is
 * what renders as "Bill to" on the invoice.
 *
 * Returns null unless there is a line1 — a city with no street is not an
 * address worth printing, and sending a half-filled one would replace a good
 * address already on a returning customer with a worse one.
 *
 * Output is already snake_cased for Stripe so the caller does no mapping, the
 * same reason amounts come back in sen.
 */
function buildAddress(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

    const line1 = trimmedText(raw.line1, MAX_ADDRESS_PART_LENGTH);
    if (line1 === '') return null;

    const address = { line1, country: DEFAULT_COUNTRY };

    // Only the parts that were actually filled in. Stripe accepts nulls, but
    // omitting keeps the object honest about what the staff member supplied.
    const line2 = trimmedText(raw.line2, MAX_ADDRESS_PART_LENGTH);
    const city = trimmedText(raw.city, MAX_ADDRESS_PART_LENGTH);
    const postalCode = trimmedText(raw.postalCode, MAX_ADDRESS_PART_LENGTH);
    const state = trimmedText(raw.state, MAX_ADDRESS_PART_LENGTH);

    if (line2 !== '') address.line2 = line2;
    if (city !== '') address.city = city;
    if (postalCode !== '') address.postal_code = postalCode;
    if (state !== '') address.state = state;

    return address;
}

/**
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 *
 * On success, `value` carries amounts already converted to sen and an address
 * already in Stripe's shape, so the caller does no arithmetic and no mapping
 * of its own.
 *
 * Each line comes back as { description, quantity, unitAmount, unitAmountCents }
 * — a UNIT price plus a count, which is what Stripe wants so the invoice can
 * print "qty × unit = amount" for the customer.
 */
export function validateInvoiceInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return fail('Invoice details are missing.');
    }

    const customerName = typeof input.customerName === 'string' ? input.customerName.trim() : '';
    if (customerName === '') return fail('A customer name is required.');
    if (customerName.length > 200) return fail('That customer name is too long.');

    const customerEmail = typeof input.customerEmail === 'string' ? input.customerEmail.trim() : '';
    if (customerEmail === '') return fail('A customer email is required.');
    if (customerEmail.length > 254 || !EMAIL_PATTERN.test(customerEmail)) {
        return fail(`"${customerEmail}" does not look like a valid email address.`);
    }

    // Only MYR is supported. Accepting an unchecked currency would let a
    // request denominate the invoice in something else entirely while the
    // amounts stay the same numbers.
    //
    // Absent means "the default"; present-but-wrong means rejected. A non-string
    // currency must not quietly become MYR — that would silently reinterpret a
    // request whose intent we could not read.
    let currency = SUPPORTED_CURRENCY;
    if (input.currency !== undefined && input.currency !== null) {
        if (typeof input.currency !== 'string') {
            return fail(`Only ${SUPPORTED_CURRENCY.toUpperCase()} invoices are supported.`);
        }
        currency = input.currency.trim().toLowerCase();
    }
    if (currency !== SUPPORTED_CURRENCY) {
        return fail(`Only ${SUPPORTED_CURRENCY.toUpperCase()} invoices are supported.`);
    }

    if (!Array.isArray(input.lineItems) || input.lineItems.length === 0) {
        return fail('Add at least one line item.');
    }
    if (input.lineItems.length > MAX_LINE_ITEMS) {
        return fail(`An invoice cannot have more than ${MAX_LINE_ITEMS} line items.`);
    }

    const lineItems = [];
    let totalRm = 0;

    for (let i = 0; i < input.lineItems.length; i++) {
        const row = input.lineItems[i];
        const position = `Line ${i + 1}`;

        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            return fail(`${position} is not a valid line item.`);
        }

        const description = typeof row.description === 'string' ? row.description.trim() : '';
        if (description === '') return fail(`${position} needs a description.`);
        if (description.length > 500) return fail(`${position}'s description is too long.`);

        const quantity = toQuantity(row.quantity);
        if (quantity === null) return fail(`${position} needs a whole-number quantity.`);
        if (quantity < 1) return fail(`${position} needs a quantity of at least 1.`);
        if (quantity > MAX_LINE_QUANTITY) {
            return fail(`${position} exceeds the quantity limit of ${MAX_LINE_QUANTITY.toLocaleString('en-US')}.`);
        }

        // `unitAmount` is the field the form sends; `amount` is accepted as the
        // same thing so every caller written before quantities existed keeps
        // working — a bare amount simply is the unit price of a single item.
        const rawUnit = (row.unitAmount === undefined || row.unitAmount === null) ? row.amount : row.unitAmount;
        const unitAmount = toAmount(rawUnit);
        if (unitAmount === null) return fail(`${position} has an amount that is not a number.`);
        if (unitAmount <= 0) return fail(`${position} must be more than RM 0.`);
        if (unitAmount > MAX_INVOICE_AMOUNT_RM) {
            return fail(`${position} exceeds the RM ${MAX_INVOICE_AMOUNT_RM.toLocaleString('en-US')} safety limit.`);
        }

        // The cap has to bind on what the customer is actually charged for this
        // line, not on the unit price — otherwise 60 × RM 2,000 sails past a
        // per-line ceiling that exists precisely to catch a mistyped order.
        const lineTotal = Math.round(quantity * unitAmount * 100) / 100;
        if (lineTotal > MAX_INVOICE_AMOUNT_RM) {
            return fail(`${position} totals more than the RM ${MAX_INVOICE_AMOUNT_RM.toLocaleString('en-US')} safety limit.`);
        }

        totalRm += lineTotal;
        lineItems.push({
            description,
            quantity,
            unitAmount,
            // Stripe works in the smallest currency unit (sen), and wants the
            // UNIT price — it multiplies by quantity itself, so the invoice
            // reads "qty × unit = amount". Rounded here, once, so no caller
            // re-derives it differently.
            unitAmountCents: Math.round(unitAmount * 100)
        });
    }

    // Also capped in total: splitting a mistyped figure across lines should not
    // slip past a per-line ceiling.
    if (totalRm > MAX_INVOICE_AMOUNT_RM) {
        return fail(`The invoice total exceeds the RM ${MAX_INVOICE_AMOUNT_RM.toLocaleString('en-US')} safety limit.`);
    }

    // Optional, customer-facing, and printed rather than calculated: a blank
    // one is simply left off the invoice. None of them can fail validation,
    // because none of them can make the invoice wrong about money.
    const address = buildAddress(input.address);
    const contact = trimmedText(input.contact, MAX_DETAIL_LENGTH);
    const salesPerson = trimmedText(input.salesPerson, MAX_DETAIL_LENGTH);
    const location = trimmedText(input.location, MAX_DETAIL_LENGTH);

    const value = {
        customerName,
        customerEmail,
        currency,
        lineItems,
        totalRm: Math.round(totalRm * 100) / 100
    };

    // Present only when filled, so the caller can test for them directly
    // instead of re-checking for empty strings.
    if (address) value.address = address;
    if (contact !== '') value.contact = contact;
    if (salesPerson !== '') value.salesPerson = salesPerson;
    if (location !== '') value.location = location;

    return { ok: true, value };
}

/**
 * Reads the model's proposed invoice. The prompt demands strict JSON, but this
 * project's rule is to verify in code rather than trust the model, so fenced
 * output is tolerated and anything unparseable returns null instead of
 * throwing. Nothing here is authoritative — whatever comes out is shown to a
 * human to edit, and validateInvoiceInput() is what actually gates the charge.
 */
export function parseProposedInvoice(raw) {
    if (typeof raw !== 'string') return null;

    let text = raw.trim();
    const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
    if (fenced) text = fenced[1].trim();
    if (text === '') return null;

    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const lineItems = Array.isArray(parsed.lineItems)
        ? parsed.lineItems
            .filter(row => row && typeof row === 'object' && !Array.isArray(row))
            .map(row => ({
                // Cleanup only, and only at proposal time: the staff member
                // sees the result on the review card and can type over it.
                // normalizeProductName() returns the original text whenever it
                // is not certain, so a custom job keeps the words they chose.
                description: typeof row.description === 'string' ? normalizeProductName(row.description) : '',
                // Kept as null rather than 0 when the model couldn't work out a
                // figure: 0 would render as a real amount in the edit form.
                amount: toAmount(row.amount)
            }))
        : [];

    return {
        customerName: typeof parsed.customerName === 'string' ? parsed.customerName : '',
        customerEmail: typeof parsed.customerEmail === 'string' && parsed.customerEmail.trim() !== ''
            ? parsed.customerEmail.trim()
            : null,
        lineItems,
        currency: SUPPORTED_CURRENCY,
        clarifyingQuestion: typeof parsed.clarifyingQuestion === 'string' && parsed.clarifyingQuestion.trim() !== ''
            ? parsed.clarifyingQuestion.trim()
            : null
    };
}
