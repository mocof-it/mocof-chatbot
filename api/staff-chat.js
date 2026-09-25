// =============================================================
// FILE: api/staff-chat.js
// Turns a staff member's plain-English order description into a PROPOSED
// invoice for them to review. Endpoint: POST /api/staff-chat
// Body: { message, history }   Env vars: GEMINI_API_KEY (+ _2), STAFF_*
//
// THIS ENDPOINT NEVER TOUCHES STRIPE. It proposes; api/staff-create-invoice.js
// is the only thing that creates anything, and it takes the human-confirmed
// fields rather than anything this file returned. That split is the whole
// safety model: the model's output is a draft on a screen, never an instruction
// that money follows.
//
// STAFF ROUTE — same-origin only, auth first. Shares nothing with the public
// /api/chat path except lib/gemini.js, which knows only how to call an API.
// =============================================================

import { requireStaffAuth } from '../lib/staffAuth.js';
import { getGeminiApiKeys, callGeminiWithFallback, GEMINI_MODEL } from '../lib/gemini.js';
import { parseProposedInvoice } from '../lib/invoiceInput.js';
import { buildProductNameReference } from '../lib/productNames.js';
import { applyCatalogPricing } from '../lib/productPricing.js';

const MAX_HISTORY_TURNS = 12;

// Note what this prompt does NOT contain: any MOCOF PRICING or persona. It
// does carry the catalog's product NAMES, so the model can tidy "murano q"
// into "Murano Queen" rather than inventing a house style — but names only,
// never an amount beside them.
//
// Figures are not the model's job at all: after it returns names, the SERVER
// looks each one up in the knowledge base and fills in the catalog sale price
// (lib/productPricing.js). So the model is never asked for a number, and any
// number it volunteers anyway is discarded rather than reviewed. That is
// deliberate — a plausible-looking invented amount is the one failure a human
// reviewer is least likely to catch, and handing the model a price list to
// match against would have re-created exactly that risk.
//
// Products the catalog cannot price — custom work, delivery, site surveys,
// bedsheets (sold as ranges), cabinetry (computed from measurements) — come
// back with a null amount and the staff member types the figure in.
const PRODUCT_NAME_REFERENCE = buildProductNameReference();

const STAFF_SYSTEM_PROMPT = `You help MOCOF staff draft an invoice from a plain-English description of an order.

Respond with STRICT JSON ONLY. No prose, no explanation, no markdown code fences. Your entire reply must be a single JSON object of exactly this shape:

{
  "customerName": string,
  "customerEmail": string or null,
  "lineItems": [ { "description": string, "amount": null } ],
  "currency": "myr",
  "clarifyingQuestion": string or null
}

Rules:
- PRICING IS NOT YOUR JOB. Do not invent, estimate, look up, or infer a price, and never ask the staff member for one. Set every line item's "amount" to null. The system fills in catalog prices itself after you reply, and a staff member types in anything it cannot price. An amount you supply will be discarded.
- Because pricing is handled for you, NEVER put a question about price, amount, or cost in "clarifyingQuestion". A line item with no price is normal and complete as far as you are concerned.
- Ask a clarifying question ONLY when the customer's email address is missing, or when you genuinely cannot tell what product or service is being sold. Nothing else is worth interrupting for.
- If something essential is missing, set "clarifyingQuestion" to one short, specific question and still fill in whatever you did understand. Leave the rest partial — do not guess.
- When you have the customer's details and can tell what is being sold, set "clarifyingQuestion" to null.
- Split the order into one line item per distinct product or service.
- Keep descriptions short and factual, as they will appear on a customer's invoice.
- Where a line item clearly refers to one of the MOCOF products listed below, write that product's name EXACTLY as it appears in the list ("murano q" and "Murano Queen WB" both become "Murano Queen"; "gioco single desk" becomes "Gioco Single Desk").
- If a line item does NOT clearly match one of those products, keep the staff member's own wording unchanged. Custom and one-off items ("custom cabinetry job", "delivery charge", "site survey fee") are normal and must be passed through as written. Never substitute a listed product for something you are unsure about — a wrong product name on an invoice is worse than an untidy one.${PRODUCT_NAME_REFERENCE ? `

MOCOF PRODUCT NAMES (names only — these are NOT prices, and carry no information about what anything costs):
${PRODUCT_NAME_REFERENCE}` : ''}`;

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Before anything else — no Gemini call happens for an unauthenticated
    // caller, so this endpoint cannot be used as a free model proxy.
    if (!requireStaffAuth(req, res)) return;

    const { message, history } = req.body || {};
    if (typeof message !== 'string' || message.trim() === '') {
        return res.status(400).json({ error: 'message is required' });
    }

    const apiKeys = getGeminiApiKeys();
    if (apiKeys.length === 0) {
        console.error('GEMINI_API_KEY not set — the staff tool cannot parse orders');
        return res.status(500).json({ error: 'Server configuration error — the assistant is unavailable.' });
    }

    const priorTurns = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
    const messages = [
        { role: 'system', content: STAFF_SYSTEM_PROMPT },
        ...priorTurns
            .filter(t => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string')
            .map(t => ({ role: t.role, content: t.content })),
        { role: 'user', content: message }
    ];

    let raw;
    try {
        raw = await callGeminiWithFallback(apiKeys, {
            model: GEMINI_MODEL,
            messages,
            max_completion_tokens: 2000,
            reasoning_effort: 'low'
        });
    } catch (err) {
        console.error('[staff] Gemini call failed:', err.status || 'network', err.details || err.message);
        return res.status(502).json({ error: 'Could not reach the assistant — please try again.' });
    }

    // Verified in code, not trusted from the prompt: the model is told to emit
    // bare JSON, and parseProposedInvoice still tolerates fences and returns
    // null rather than throwing on anything it cannot read.
    const proposal = parseProposedInvoice(raw);
    if (!proposal) {
        console.warn('[staff] could not parse the model reply as an invoice proposal');
        return res.status(200).json({
            proposal: null,
            clarifyingQuestion: "Sorry — I couldn't read that as an order. Could you rephrase it, including the customer's name, email, and what they're buying?"
        });
    }

    // The prices are decided HERE, in code, from the knowledge base — not by
    // anything the model returned. A catalog product gets its sale price and
    // canonical name; anything the catalog cannot price keeps a null amount for
    // the staff member to fill in on the review card. Either way the figure
    // stays editable there, and whatever they confirm is what gets invoiced.
    const pricedProposal = {
        ...proposal,
        lineItems: applyCatalogPricing(proposal.lineItems)
    };

    return res.status(200).json({
        proposal: pricedProposal,
        clarifyingQuestion: pricedProposal.clarifyingQuestion
    });
}
