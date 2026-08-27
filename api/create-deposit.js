// =============================================================
// FILE: api/create-deposit.js
// Vercel Serverless Function — creates a Stripe Checkout Session for a
// reservation deposit against a wall bed + cabinetry estimate.
// Endpoint: POST /api/create-deposit
// Env vars: STRIPE_SECRET_KEY, SITE_URL (optional — falls back to the
//           production widget origin)
// =============================================================

import Stripe from 'stripe';
import { getDepositBasisFromContext, DEPOSIT_PERCENT, DEPOSIT_TYPE_WITH_CABINETRY, depositIncludesCabinets } from './chat.js';
import { generateQuoteRef } from '../lib/reference.js';

function round2(n) {
    return Math.round(n * 100) / 100;
}

function getStripeClient() {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) return null;
    return new Stripe(key);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const stripe = getStripeClient();
    if (!stripe) {
        console.error('STRIPE_SECRET_KEY not set — configure it in Vercel to enable deposits');
        return res.status(500).json({ error: 'Server configuration error — payments are not yet configured' });
    }

    const { message, history } = req.body || {};
    if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
    }

    // NEVER trust a grandTotal/depositAmount sent by the client. Re-derive the
    // basis from the message/history using the SAME function api/chat.js's
    // computeDepositOffer() used to show the button — not a parallel
    // reimplementation, so the quoted and charged amounts cannot diverge. The
    // rule the proposal states explicitly: trust the server-calculated
    // estimate, never a number that passed through the browser (or the model's
    // text) on the way here.
    const basis = getDepositBasisFromContext(message, history);
    if (!basis) {
        return res.status(400).json({
            error: 'No confirmed wall bed estimate found for this conversation — a deposit can only be created for a fully resolved quote.'
        });
    }

    const grandTotal = basis.total;
    const depositAmount = round2(grandTotal * DEPOSIT_PERCENT / 100);
    const quoteRef = generateQuoteRef();

    // What the customer sees on the Stripe Checkout page. A wall-bed-only
    // deposit must not say "+ Cabinetry" — that would describe scope they
    // aren't paying for.
    const lineItemName = basis.type === DEPOSIT_TYPE_WITH_CABINETRY
        ? `${basis.wallBedModelLabel} + Cabinetry`
        : basis.wallBedModelLabel;
    const siteUrl = process.env.SITE_URL || 'https://mocof-chatbot.vercel.app';

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card', 'fpx'],
            line_items: [{
                price_data: {
                    currency: 'myr',
                    product_data: {
                        name: `${DEPOSIT_PERCENT}% Deposit — ${lineItemName}`,
                        description: `Reservation deposit, applied toward the final invoice confirmed by site survey. Quote ref ${quoteRef}.`
                    },
                    unit_amount: Math.round(depositAmount * 100) // Stripe amounts are in the smallest currency unit (cents)
                },
                quantity: 1
            }],
            // Collected by Stripe's hosted flow, not the chat widget, for the
            // same reason customer_email isn't passed below.
            //
            // phone_number_collection is Stripe's purpose-built toggle and
            // populates customer_details.phone. There is no equivalent
            // standalone "collect name" switch: customer_details.name is filled
            // from the billing-details form, so billing_address_collection has
            // to be required to get a name reliably. Relying on the card form's
            // cardholder-name field instead would leave the name blank for FPX
            // payments — a Malaysian bank-transfer method with no such field,
            // and one this session explicitly accepts — which is silent data
            // loss on a meaningful share of real customers. The address it also
            // collects is not waste here: these deposits lead to a site survey
            // and a delivery.
            phone_number_collection: { enabled: true },
            billing_address_collection: 'required',
            // No customer_email is passed here on purpose — the widget doesn't
            // collect one today (see the proposal's Open Questions), and Stripe
            // Checkout already prompts for an email as part of its own hosted
            // flow, so nothing is lost by letting Stripe collect it rather than
            // adding a new question to the chat widget just to duplicate it.
            // `cabinets` is the Yes/No api/stripe-webhook.js reads back and
            // lib/sheetsLogger.js writes into the Sheet's Cabinets column;
            // `deposit_type` is the precise identifier kept alongside it for
            // filtering in the Stripe dashboard. Both derive from basis.type,
            // so they cannot disagree. The measurement fields are empty on a
            // wall-bed-only deposit — no wall is being surveyed in that case.
            metadata: {
                quote_ref: quoteRef,
                cabinets: depositIncludesCabinets(basis.type),
                deposit_type: basis.type,
                wall_bed_model: basis.wallBedModelLabel,
                grand_total: grandTotal.toFixed(2),
                deposit_percent: String(DEPOSIT_PERCENT),
                wall_height_ft: basis.heightFt !== null ? String(basis.heightFt) : '',
                total_wall_width_ft: basis.totalWidthFt !== null ? String(basis.totalWidthFt) : ''
            },
            success_url: `${siteUrl}/deposit-success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: siteUrl
        });

        return res.status(200).json({
            success: true,
            url: session.url,
            quoteRef,
            depositAmount,
            grandTotal
        });
    } catch (err) {
        console.error('Stripe checkout session creation failed:', err.message || err);
        return res.status(502).json({ error: 'Could not start the payment session — please try again or contact us on WhatsApp.' });
    }
}
