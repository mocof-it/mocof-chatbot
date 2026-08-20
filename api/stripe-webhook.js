// =============================================================
// FILE: api/stripe-webhook.js
// Vercel Serverless Function — receives Stripe's checkout.session.completed
// event and confirms a deposit against its quote reference.
// Endpoint: POST /api/stripe-webhook — set this as the endpoint URL in the
// Stripe Dashboard (Developers → Webhooks). Never called by the widget.
// Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Optional: EMAIL_API_KEY, COMPANY_NOTIFY_EMAIL — see notifyCompany() below
// =============================================================

import Stripe from 'stripe';

// Vercel parses the request body as JSON by default. Stripe's signature
// check needs the EXACT raw bytes the client sent — re-serializing a parsed
// JSON object can produce a byte-for-byte different string and silently
// break verification. Disabling the default parser here is what makes
// readRawBody() below receive the untouched body.
export const config = {
    api: {
        bodyParser: false
    }
};

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// Uses Resend's plain HTTP API (no SDK dependency to add/lock) via fetch,
// which Node 20's runtime supports natively. Stays fully opt-in: if
// EMAIL_API_KEY + COMPANY_NOTIFY_EMAIL aren't both set, this still just
// logs, exactly as before — so nothing sends until MOCOF deliberately
// configures it. Every confirmed deposit is logged either way (see below,
// plus Vercel's own function logs), so nothing is silently lost if the
// email send itself fails.
async function notifyCompany(details) {
    if (!process.env.EMAIL_API_KEY || !process.env.COMPANY_NOTIFY_EMAIL) {
        console.log('Deposit confirmed (no notification channel configured):', JSON.stringify(details));
        return;
    }

    // Resend requires the "from" address to be on a domain verified in your
    // Resend dashboard. Set EMAIL_FROM_ADDRESS once that's done; this
    // fallback only works for accounts still on Resend's unverified test
    // sender and will be rejected otherwise.
    const fromAddress = process.env.EMAIL_FROM_ADDRESS || 'MOCOF Chatbot <onboarding@resend.dev>';
    const subject = `New deposit paid — ${details.quoteRef || 'no ref'} (RM ${details.depositAmountPaid || '?'})`;
    const body = [
        `A ${details.depositPercent || '?'}% deposit has been paid.`,
        '',
        `Quote ref: ${details.quoteRef || '(none)'}`,
        `Wall bed model: ${details.wallBedModel || '(none)'}`,
        `Grand total: RM ${details.grandTotal || '?'}`,
        `Deposit paid: RM ${details.depositAmountPaid || '?'}`,
        `Customer email: ${details.customerEmail || '(not provided)'}`,
        `Stripe session: ${details.stripeSessionId || '(none)'}`
    ].join('\n');

    // Never let a notification failure reach the caller — the webhook
    // handler awaits this outside its own try/catch, so an uncaught
    // rejection here would turn into a 500 and make Stripe retry an event
    // that was actually processed successfully. The payment is already
    // durably recorded by Stripe regardless of whether this email goes out.
    try {
        const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.EMAIL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                from: fromAddress,
                to: [process.env.COMPANY_NOTIFY_EMAIL],
                subject,
                text: body
            })
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error('notifyCompany: Resend API returned an error:', res.status, errText);
            return;
        }

        console.log('Deposit confirmed — notification email sent:', JSON.stringify(details));
    } catch (err) {
        console.error('notifyCompany: failed to send notification email:', err.message || err);
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!webhookSecret || !stripeKey) {
        console.error('STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY not configured');
        return res.status(500).json({ error: 'Server configuration error' });
    }
    const stripe = new Stripe(stripeKey);

    const sig = req.headers['stripe-signature'];
    let event;

    try {
        const rawBody = await readRawBody(req);
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
        // Never act on an unverified body — a bad signature means either a
        // misconfigured secret or a forged request, and either way this
        // event must be rejected, not processed.
        console.error('Stripe webhook signature verification failed:', err.message);
        return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
    }

    // checkout.session.completed specifically, not the success-page
    // redirect — a customer can close the tab before the redirect fires, so
    // the webhook is the only reliable fulfillment signal (see the
    // proposal's Section 6).
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const meta = session.metadata || {};

        const details = {
            quoteRef: meta.quote_ref || null,
            wallBedModel: meta.wall_bed_model || null,
            grandTotal: meta.grand_total || null,
            depositPercent: meta.deposit_percent || null,
            depositAmountPaid: typeof session.amount_total === 'number'
                ? (session.amount_total / 100).toFixed(2)
                : null,
            customerEmail: session.customer_details?.email || null,
            stripeSessionId: session.id
        };

        await notifyCompany(details);

        // Phase 4 of the main roadmap (lead logging) can hook in here once
        // it's rebuilt — the Google Sheets integration was removed from
        // main on Aug 20, so there's nothing to log to yet.
    }

    // Acknowledge receipt for any event type Stripe sends, even ones this
    // handler doesn't act on — Stripe retries on anything other than a 2xx,
    // and there's no reason to make it retry an event we're intentionally
    // ignoring.
    return res.status(200).json({ received: true });
}