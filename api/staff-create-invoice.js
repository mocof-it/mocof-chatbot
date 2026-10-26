// =============================================================
// FILE: api/staff-create-invoice.js
// Creates a REAL Stripe invoice from fields a staff member reviewed and
// confirmed. Endpoint: POST /api/staff-create-invoice
// Body: { customerName, customerEmail, currency,
//         address?, contact?, salesPerson?, location?,
//         icPassport?, tin?,
//         lineItems: [{ description, quantity, unitAmount }] }
// Env vars: STRIPE_SECRET_KEY, STAFF_*
//
// The optional fields are presentation only — they decide what the customer
// READS on the invoice (Bill to, and the Contact / Sales Person / Location
// custom fields), never what they are charged. Nothing here is tax, SST or
// e-invoice handling; that lives in QuickBooks and deliberately not here.
//
// This is the only file in the staff tool that creates anything. It takes
// structured fields, never free text and never the model's raw output — by the
// time a request arrives here a human has read every amount on screen.
// Validation still runs server-side regardless (lib/invoiceInput.js): the
// browser form is a convenience, not a control.
//
// STAFF ROUTE — same-origin only, auth first.
// =============================================================

import Stripe from 'stripe';
import { requireStaffAuth } from '../lib/staffAuth.js';
import { validateInvoiceInput } from '../lib/invoiceInput.js';

const DAYS_UNTIL_DUE = 3;

function getStripeClient() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new Stripe(key);
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Before Stripe is even constructed.
    if (!requireStaffAuth(req, res)) return;

    const stripe = getStripeClient();
    if (!stripe) {
        console.error('STRIPE_SECRET_KEY not set — the staff tool cannot create invoices');
        return res.status(500).json({ error: 'Server configuration error — invoicing is not configured.' });
    }

    const validation = validateInvoiceInput(req.body);
    if (!validation.ok) {
        // Nothing has been created at this point, and nothing will be.
        return res.status(400).json({ error: validation.error });
    }
    const {
        customerName, customerEmail, currency, lineItems,
        address, contact, salesPerson, location, icPassport, tin
    } = validation.value;

    // Buyer identifiers go on the CUSTOMER as metadata, not on the invoice as
    // custom fields: Stripe caps custom_fields at 4 and the three below already
    // claim most of that, and these belong to the person rather than to one
    // order. Metadata is also not printed on Stripe's hosted invoice, which
    // suits an identifier the customer already knows and nobody else needs to
    // read. Keys are added only when filled — writing an empty string would
    // erase a value an earlier invoice captured for this customer.
    const buyerMetadata = {};
    if (icPassport) buyerMetadata.ic_passport = icPassport;
    if (tin) buyerMetadata.tin = tin;
    const hasBuyerMetadata = Object.keys(buyerMetadata).length > 0;

    // Stripe prints these above the line items. Named here rather than in
    // lib/invoiceInput.js because the labels are a Stripe presentation detail,
    // and the limit of 4 is Stripe's — three is all this form collects, so
    // there is nothing to trim. Empty ones are skipped: a blank custom field
    // still renders as an empty row on the customer's invoice.
    const customFields = [
        { name: 'Contact', value: contact },
        { name: 'Sales Person', value: salesPerson },
        { name: 'Location', value: location }
    ].filter(field => Boolean(field.value));

    try {
        // 1. Reuse the customer if MOCOF has invoiced this address before, so
        //    Stripe's dashboard shows one customer with a payment history
        //    rather than a new record per invoice.
        const existing = await stripe.customers.list({ email: customerEmail, limit: 1 });
        let customer;
        if (existing.data.length > 0) {
            customer = existing.data[0];
            // A reused customer may carry an older address, or none. Update it
            // BEFORE the invoice is finalized — finalizing snapshots the
            // customer's details onto the invoice, so an update afterwards
            // would not appear on the document the customer actually receives.
            //
            // Stripe merges the metadata keys it is handed rather than
            // replacing the whole object, so sending only what this invoice
            // captured leaves anything recorded earlier in place.
            const updates = {};
            if (address) {
                updates.address = address;
                updates.name = customerName;
            }
            if (hasBuyerMetadata) updates.metadata = buyerMetadata;
            if (Object.keys(updates).length > 0) {
                customer = await stripe.customers.update(customer.id, updates);
            }
        } else {
            customer = await stripe.customers.create({
                email: customerEmail,
                name: customerName,
                ...(address ? { address } : {}),
                ...(hasBuyerMetadata ? { metadata: buyerMetadata } : {})
            });
        }

        // 2. Create the DRAFT invoice before its line items, then attach each
        //    item to it explicitly by id.
        //
        //    The usual order (items first, then an invoice that sweeps up
        //    whatever is pending for that customer) is a trap here: an earlier
        //    attempt that failed after creating items leaves them pending, and
        //    the next invoice for that customer would silently include them.
        //    Attaching by id means this invoice contains exactly what was on
        //    screen and nothing else.
        const invoice = await stripe.invoices.create({
            customer: customer.id,
            collection_method: 'send_invoice',
            days_until_due: DAYS_UNTIL_DUE,
            // Staff share the hosted link themselves, so Stripe must not also
            // sweep in unrelated pending items from any other flow.
            pending_invoice_items_behavior: 'exclude',
            description: `MOCOF order for ${customerName}`,
            metadata: { source: 'mocof_staff_invoice_tool' },
            ...(customFields.length > 0 ? { custom_fields: customFields } : {})
        });

        for (const item of lineItems) {
            await stripe.invoiceItems.create({
                customer: customer.id,
                invoice: invoice.id,
                // A unit price + quantity rather than a single flat amount, so
                // the customer's invoice shows the arithmetic: 3 × RM 500.00 =
                // RM 1,500.00. Stripe does that multiplication itself, which is
                // also why the validator hands over a UNIT price.
                //
                // The Invoice Items API takes `unit_amount_decimal` — a STRING
                // of cents — and has no `unit_amount` field, unlike Checkout's
                // price_data (see api/create-deposit.js, where the integer form
                // is correct). Passing the integer field here is silently wrong
                // until Stripe rejects the request.
                quantity: item.quantity,
                unit_amount_decimal: String(item.unitAmountCents),
                currency,
                description: item.description
            });
        }

        // 3. Finalizing is what produces hosted_invoice_url — a draft has none.
        const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

        // Whether a buyer identifier was captured, never which one or what it
        // said: an IC/passport number and a TIN are personal data, and a log
        // line is the easiest place for them to end up somewhere nothing is
        // protecting them. The yes/no still answers "did that invoice get one".
        console.log(`[staff] invoice ${finalized.id} finalized for ${customerEmail} `
            + `(${lineItems.length} line item(s), buyer id captured: ${hasBuyerMetadata ? 'yes' : 'no'})`);

        return res.status(200).json({
            invoiceId: finalized.id,
            // Stripe's own human-readable number (e.g. "A1B2C3D4-0001"), which
            // is assigned at finalize. It goes on the branded PDF the staff
            // member sends, so the customer's copy and Stripe's record quote
            // the same reference — this is why no separate numbering scheme
            // exists here.
            invoiceNumber: finalized.number,
            hostedInvoiceUrl: finalized.hosted_invoice_url,
            invoicePdf: finalized.invoice_pdf,
            total: typeof finalized.total === 'number' ? finalized.total / 100 : null,
            currency
        });
    } catch (err) {
        // Stripe's own message is surfaced deliberately: this is a staff-only
        // tool behind auth, and "No such customer" or "amount too small" is
        // exactly what the person needs to know to fix it themselves.
        console.error('[staff] Stripe invoice creation failed:', err.message || err);
        return res.status(502).json({
            error: `Stripe could not create the invoice: ${err.message || 'unknown error'}`
        });
    }
}
