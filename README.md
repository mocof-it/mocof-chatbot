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
6. If a full wall-bed + cabinetry estimate is valid, the widget may also render a deposit button and trigger the Stripe flow.

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

Once the estimate is valid, the widget can show a "Pay 10% Deposit" button. The flow is:

1. `api/chat.js` computes a deposit offer using the same estimate logic as the pricing breakdown.
2. The browser sends the conversation snapshot to `POST /api/create-deposit`.
3. `api/create-deposit.js` re-derives the total instead of trusting client-supplied amounts.
4. Stripe creates a hosted Checkout session in MYR using the calculated deposit.
5. Stripe sends `checkout.session.completed` to `api/stripe-webhook.js`.
6. The webhook verifies the signature and records the payment details.

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

## Testing and CI

The repository includes automated checks:

- `npm test` runs the Node test suite
- `npm run test:consistency` runs the dedicated pricing consistency checks
- GitHub Actions runs a syntax check across all JavaScript files and imports all serverless entrypoints before merging

## Troubleshooting

- `500` or "API key missing": ensure `GEMINI_API_KEY` is set.
- `502` or Gemini API errors: verify the key is valid and the endpoint is reachable.
- Price response seems blocked unexpectedly: check logs for the guardrail message and inspect whether the amount was recognized.
- Deposit button does not appear: the same wall-bed + cabinetry conditions must be met for both the estimate and the deposit offer.
- Stripe webhook returns 400: verify `STRIPE_WEBHOOK_SECRET` matches the endpoint and the body parser is disabled in `api/stripe-webhook.js`.
- Deposit logging is missing: confirm `GOOGLE_SHEETS_*` variables or the optional email env vars are configured.

## Notes

- Do not commit API keys or secrets to the repository.
- System prompt wording and knowledge modules strongly influence behavior; validate pricing-sensitive changes with the project tests.
- This project intentionally keeps model-generated product recommendations constrained and cross-checked by server logic to reduce hallucinated pricing and invalid product claims.

---
