# MOCOF Chatbot

A Vercel-hosted AI chatbot for MOCOF that answers product questions, helps shortlist wall beds and furniture, calculates surround-cabinetry estimates, and can offer a 10% reservation deposit through Stripe.

## Overview

This project combines:

- a floating chat widget in the browser
- a serverless backend in `api/`
- curated product and showroom knowledge in `knowledge/`
- a pricing guardrail that prevents unsupported RM values from reaching customers
- Stripe Checkout for deposits tied to a quote reference and confirmable webhook handling
- automated tests plus CI syntax/import validation

The chatbot uses Gemini through Google's OpenAI-compatible chat completions endpoint and keeps manual pricing logic in JavaScript instead of trusting the model to do arithmetic.

## Prerequisites

- Node.js 20.x
- Vercel CLI for local development, or deployment through the Vercel dashboard
- Environment variables in Vercel or your shell

Required:
- `GEMINI_API_KEY`

Optional but commonly used:
- `GEMINI_API_KEY_2` — fallback key if the primary key hits a rate limit or 5xx
- `STRIPE_SECRET_KEY` — enables deposit creation
- `STRIPE_WEBHOOK_SECRET` — verifies Stripe webhook signatures
- `SITE_URL` — used by deposit checkout flows when not otherwise set
- `EMAIL_API_KEY` and `COMPANY_NOTIFY_EMAIL` — enables optional deposit notification emails
- `EMAIL_FROM_ADDRESS` — custom sender for Resend-based email alerts
- `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_SHEETS_TAB_NAME` — optional deposit logging to Google Sheets via `lib/sheetsLogger.js`

## Quick start

```bash
npm install
npm run dev
```

Then open:

- http://localhost:3000/

This starts the Vercel app and serves the widget and serverless endpoints locally.

Run the tests locally:

```bash
npm test
npm run test:consistency
```

Example direct API test:

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Tell me about your wall bed products","history":[]}'
```

## Project structure

- `api/chat.js` — main bot endpoint, prompt assembly, knowledge routing, pricing calculations, product-image matching, and deposit-offer detection
- `api/create-deposit.js` — creates a Stripe Checkout session for a valid 10% deposit
- `api/stripe-webhook.js` — validates Stripe webhook signatures and records confirmed deposits
- `knowledge/` — product and service knowledge modules used to guide responses
- `knowledge/productImages.js` — maps product names to real catalog photos
- `knowledge/cabinetry.js` — surround-cabinetry pricing formula and related constants
- `lib/reference.js` — generates `MQS-YYYYMMDD-XXXXXX` quote references for Stripe metadata
- `lib/sheetsLogger.js` — logs confirmed deposits to Google Sheets when configured
- `GOOGLE_SHEETS_CREDENTIALS.md` — Sheet column list, and how the Google service-account credentials are provisioned
- `CLAUDE.md` — architecture notes and the invariants to preserve when changing pricing, deposits, or the Sheet row
- `public/index.html` — chat widget UI
- `public/deposit-success.html` — success page shown after successful Stripe checkout
- `test/consistency.test.js` — regression checks for critical pricing and gating logic
- `.github/workflows/ci.yml` — CI checks for syntax and import validity
- `vercel.json` — rewrite and header configuration for Vercel deployment

## How the chatbot works

1. The client widget sends a message to `POST /api/chat` with a `message` and `history` payload.
2. `api/chat.js` selects the relevant knowledge modules using current-message and recent-history matching.
3. It builds a system prompt with MOCOF persona rules, pricing guidance, showroom rules, and contextual product details.
4. It sends the request to Gemini via the OpenAI-compatible chat completions endpoint.
5. The response is checked against internal pricing data and live cabinetry calculations before being returned to the customer.
6. If a deposit is payable — either a full wall-bed + cabinetry estimate, or a wall bed on its own — the widget may also render a deposit button and trigger the Stripe flow.

## Key product features

### Knowledge routing

The app is designed to keep product knowledge and behaviour from drifting away from the actual MOCOF catalog. `api/chat.js` keeps a `KNOWLEDGE_MODULES` list with regex-based relevance checks and prioritises current-message matches over older history matches.

Important details:
- room-purpose and ceiling-height logic affect wall-bed recommendations
- `basicfurniture.js` is automatically included as a companion source when relevant to product categories such as wall beds, sofas, tables, kitchens, and wardrobes
- knowledge is intentionally bounded so a single message does not expand into an oversized prompt

### Pricing guardrail

The bot does not assume all prices in a model response are valid. Before returning a reply, `api/chat.js` validates RM amounts against:

- the known MOCOF price list
- amounts the customer stated themselves
- live calculated surround-cabinetry totals for the current conversation

If a reply contains an unrecognized price, the bot safely falls back to a generic WhatsApp confirmation instead of sending an incorrect quote.

### Surround-cabinetry estimation

When a customer asks for a wall bed plus cabinetry estimate, the app uses the same logic in `knowledge/cabinetry.js` to compute a live estimate from:

- chosen wall-bed model
- wall height
- total wall width

The app then injects the computed breakdown into the system prompt so the model can present the exact figures without recalculating them.

### Deposit flow

The widget can show a "Pay 10% Deposit" button in two situations:

- **Wall bed + cabinetry** — the combined grand total, once a full estimate has been quoted.
- **Wall bed only** — the model's sale price alone, for a customer who never raised cabinetry.

Both are decided by a single function, `getDepositBasisFromContext()` in `api/chat.js`. The chat response's button and the actual Stripe charge both read from it and nothing else, so the quoted and charged amounts cannot diverge.

The gating is deliberately conservative:

- An explicit price question is required — the button never appears unprompted.
- Once cabinetry is mentioned by *either* side of the conversation, the wall-bed-only offer is suppressed until the combined estimate is complete. Otherwise a customer mid-quote would be offered payment for less than the total being assembled.
- No deposit is offered for a Murano below its 2.4 m ceiling minimum. The app never takes money for a bed that cannot be installed.

The flow is:

1. `api/chat.js` computes a deposit offer using the same basis the pricing breakdown uses.
2. The browser sends the conversation snapshot to `POST /api/create-deposit`.
3. `api/create-deposit.js` re-derives the total instead of trusting client-supplied amounts.
4. Stripe creates a hosted Checkout session in MYR using the calculated deposit.
5. Stripe sends `checkout.session.completed` to `api/stripe-webhook.js`.
6. The webhook verifies the signature, then records the deposit by email and to Google Sheets.

After payment, `public/deposit-success.html` confirms the deposit and — when the original chat tab is still reachable — posts back to it so the confirmation also appears as a message in the conversation. That messaging is best-effort; the success page is a complete confirmation on its own if it fails.

### Deposit logging

Every confirmed deposit appends one row to the configured Google Sheet, in the range `<tab>!A:K`:

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| Timestamp | Quote Ref | Wall Bed Model | Grand Total | Deposit % | Deposit Paid | Customer Email | Customer Name | Customer Phone | Stripe Session ID | Cabinets |

**Cabinets** is `Yes` or `No` — whether the deposit covers surround cabinetry or the bed alone.

Customer email, name, and phone are collected by Stripe's hosted checkout page, not by the chat widget, and read back from `session.customer_details`. Any of them can be blank if Stripe captured nothing.

Column order is a stored data format: the write range must always be exactly as wide as the row, because the Sheets API silently truncates a longer row rather than returning an error. Add new columns at the end. See [GOOGLE_SHEETS_CREDENTIALS.md](GOOGLE_SHEETS_CREDENTIALS.md) for the header row to create, and for how the Google service-account credentials are provisioned.

## Deployment

Deploy this project to Vercel and configure the environment variables above. `vercel.json` contains the headers and rewrites used in local and production environments.

### Stripe setup

1. Create a Stripe account and enable FPX under Payment methods.
2. Set `STRIPE_SECRET_KEY`.
3. Register the webhook endpoint in Stripe Dashboard → Developers → Webhooks.
4. Point it at:
   - `https://<your-deployment>/api/stripe-webhook`
5. Subscribe to `checkout.session.completed` and copy the resulting signing secret into `STRIPE_WEBHOOK_SECRET`.
6. For local testing, use Stripe CLI forwarding to the local Vercel app.

Customer name, phone, and billing address are requested by the Checkout Session itself (`api/create-deposit.js`), so no Dashboard configuration is needed for them. Billing address collection is required rather than optional because that is what populates `customer_details.name` — Stripe has no standalone "collect name" setting, and the card form's cardholder-name field does not exist for FPX payments.

## Testing and CI

The repository includes automated checks:

- `npm test` runs the Node test suite
- `npm run test:consistency` runs the dedicated pricing consistency checks
- GitHub Actions runs a syntax check across all JavaScript files and imports all serverless entrypoints before merging

The suite is offline and needs no credentials: the Google Sheets tests stub `globalThis.fetch` and generate a throwaway RSA key pair, and nothing calls Gemini or Stripe. Most cases exist to catch *drift* rather than to prove a function works — a price hardcoded in the prompt disagreeing with the pricing table, a worked example in a comment disagreeing with the formula, or the Sheet row disagreeing with the range it is written into. A failure there usually means two things that must agree no longer do.

## Troubleshooting

- `500` or "API key missing": ensure `GEMINI_API_KEY` is set.
- `502` or Gemini API errors: verify the key is valid and the endpoint is reachable.
- Price response seems blocked unexpectedly: check logs for the guardrail message and inspect whether the amount was recognized.
- Deposit button does not appear: a price question must have been asked, and a specific wall bed model established. If cabinetry has been mentioned, the button waits for the full combined estimate rather than offering the bed alone. A Murano below the 2.4 m ceiling minimum is never offered a deposit.
- Deposit confirmation does not appear in the chat after paying: expected when the original tab was closed, or if the browser severed `window.opener` on the way through Stripe. The success page still confirms the payment, and the webhook still records it — nothing is lost.
- Sheet columns look shifted: the row must line up with the `A:K` range. A row wider than its range is truncated silently by the Sheets API, so check both together after adding a column.
- Stripe webhook returns 400: verify `STRIPE_WEBHOOK_SECRET` matches the endpoint and the body parser is disabled in `api/stripe-webhook.js`.
- Deposit logging is missing: confirm `GOOGLE_SHEETS_*` variables or the optional email env vars are configured.

## Notes

- Do not commit API keys or secrets to the repository.
- System prompt wording and knowledge modules strongly influence behavior; validate pricing-sensitive changes with the project tests.
- This project intentionally keeps model-generated product recommendations constrained and cross-checked by server logic to reduce hallucinated pricing and invalid product claims.

---
