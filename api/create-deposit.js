// =============================================================
// FILE: api/create-deposit.js
// Vercel Serverless Function — creates a Stripe Checkout Session for a
// reservation deposit against a wall bed + cabinetry estimate.
// Endpoint: POST /api/create-deposit
// Env vars: STRIPE_SECRET_KEY, SITE_URL (optional — falls back to the
//           production widget origin)
// =============================================================

import Stripe from 'stripe';
import { getCabinetryEstimateFromContext, DEPOSIT_PERCENT } from './chat.js';
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

    // NEVER trust a grandTotal/depositAmount sent by the client. Re-derive
    // the exact same estimate api/chat.js's computeDepositOffer() would show
    // for this conversation, straight from the message/history — the same
    // rule the proposal states explicitly: trust the server-calculated
    // estimate the guardrail already relies on, never a number that passed
    // through the browser (or the model's text) on the way here.
    const est = getCabinetryEstimateFromContext(message, history);
    if (!est || est.blocked || est.grandTotal === null || typeof est.grandTotal === 'undefined') {
        return res.status(400).json({
            error: 'No confirmed wall bed + cabinetry estimate found for this conversation — a deposit can only be created for a fully resolved quote.'
        });
    }

    const grandTotal = est.grandTotal;
    const depositAmount = round2(grandTotal * DEPOSIT_PERCENT / 100);
    const quoteRef = generateQuoteRef();
    const siteUrl = process.env.SITE_URL || 'https://mocof-chatbot.vercel.app';

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'payment',
            payment_method_types: ['card', 'fpx'],
            line_items: [{
                price_data: {
                    currency: 'myr',
                    product_data: {
                        name: `${DEPOSIT_PERCENT}% Deposit — ${est.wallBedModelLabel} + Cabinetry`,
                        description: `Reservation deposit, applied toward the final invoice confirmed by site survey. Quote ref ${quoteRef}.`
                    },
                    unit_amount: Math.round(depositAmount * 100) // Stripe amounts are in the smallest currency unit (cents)
                },
                quantity: 1
            }],
            // No customer_email is passed here on purpose — the widget doesn't
            // collect one today (see the proposal's Open Questions), and Stripe
            // Checkout already prompts for an email as part of its own hosted
            // flow, so nothing is lost by letting Stripe collect it rather than
            // adding a new question to the chat widget just to duplicate it.
            metadata: {
                quote_ref: quoteRef,
                wall_bed_model: est.wallBedModelLabel,
                grand_total: grandTotal.toFixed(2),
                deposit_percent: String(DEPOSIT_PERCENT),
                wall_height_ft: String(est.heightFt),
                total_wall_width_ft: est.totalWidthFt !== null ? String(est.totalWidthFt) : ''
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
