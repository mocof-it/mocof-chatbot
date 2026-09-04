# MOCOF Chatbot

A Vercel-hosted AI chatbot for MOCOF that answers product questions, helps shortlist wall beds, furniture, and bedding, calculates surround-cabinetry estimates, and can offer a 10% reservation deposit through Stripe.

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
- `EMAIL_API_KEY` and `COMPANY_NOTIFY_EMAIL` — enable optional deposit notification emails via Resend (see [Deposit notification emails](#deposit-notification-emails))
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
- `knowledge/bedsheets.js` — bedding and bath catalog (Signoria Firenze, Luxury Tencel, Egyptian Cotton, Pure Cotton, accessories, cushions, bath)
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
- catalog modules that change often — `bedsheets.js` and `basicfurniture.js` — carry material tiers, price ranges, and representative products rather than every SKU, and end by pointing at WhatsApp for anything not named

### Pricing guardrail

The bot does not assume all prices in a model response are valid. Before returning a reply, `api/chat.js` validates RM amounts against:

- the known MOCOF price list
- amounts the customer stated themselves
- live calculated surround-cabinetry totals for the current conversation

If a reply contains an unrecognized price, the bot safely falls back to a generic WhatsApp confirmation instead of sending an incorrect quote.

Every knowledge module feeds this list, so any `RM` figure written into one is quotable as soon as it is registered in `MASTER_PRICE_LIST`. A module left out of that array has its prices treated as hallucinations and suppressed — which is why adding a knowledge file is never just creating the file.

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

### Deposit notification emails

Confirmed deposits can trigger a notification email to MOCOF. This is optional and off by default: set both `EMAIL_API_KEY` and `COMPANY_NOTIFY_EMAIL` to enable it. If either is unset, `api/stripe-webhook.js` logs the deposit instead of emailing — the Sheet row and Vercel function logs record it either way, so nothing is lost when email is off.

**Current status: enabled.** This deployment runs with notification emails turned on using the minimal Resend setup — `EMAIL_API_KEY` and `COMPANY_NOTIFY_EMAIL` are configured, and mail is sent from Resend's shared test sender to the configured notify inbox. `EMAIL_FROM_ADDRESS` and domain verification are not in use.

Sending uses [Resend](https://resend.com) over its plain HTTP API (no SDK dependency); the message is composed in `lib/depositNotification.js`.

1. Create a Resend account and an API key, and set it as `EMAIL_API_KEY`.
2. Set `COMPANY_NOTIFY_EMAIL` to the address that should receive the alerts.
3. Redeploy — Vercel does not apply new environment variables to a running deployment.

**Sender address and the test-sender restriction.** With no `EMAIL_FROM_ADDRESS` set, the webhook sends from Resend's shared test sender (`onboarding@resend.dev`). Resend restricts that sender to delivering **only to the email address the Resend account was registered with**. So the minimal working setup is to register Resend with the inbox you want the alerts in, and set `COMPANY_NOTIFY_EMAIL` to that same address — no DNS or domain setup required. Sending to any other address returns a `403` and no email arrives (the webhook catches this and logs it rather than failing the request).

**Why the domain isn't verified with Resend.** Short version: `mocof.com.my` cannot complete Resend's standard domain verification while its DNS is hosted at Wix, so this deployment stays on the test sender deliberately — it is not an unfinished setup step.

- The domain's nameservers are `ns2.wixdns.net` and `ns3.wixdns.net`, so every DNS record is edited **inside Wix**, not at the original registrar.
- Resend's standard verification requires an **MX record on a sending subdomain** (e.g. `send.mocof.com.my`). That MX record is what receives Resend's Return-Path traffic — bounces and complaints — and it forms part of the SPF setup.
- **Wix does not allow MX records on subdomains.** It supports them only on the root domain, and those root MX records are already in use by Google Workspace to receive `@mocof.com.my` mail. They must not be touched.
- With no way to create the subdomain MX record Resend asks for, verification cannot be completed through Wix DNS.

That is why `EMAIL_FROM_ADDRESS` is intentionally left unset. `EMAIL_API_KEY` and `COMPANY_NOTIFY_EMAIL` are both set, and `COMPANY_NOTIFY_EMAIL` is the same address the Resend account is registered under — the only address the shared test sender is permitted to deliver to. One practical consequence to expect: mail from `onboarding@resend.dev` is unauthenticated for our domain and commonly lands in spam, so whitelist it in the receiving inbox.

**Future options for sending to a different address** (a shared sales inbox, say), cheapest first:

1. **Re-add the domain in Resend and check for a CNAME-based sending setup.** Wix *can* create subdomain CNAMEs, so if Resend offers that path it sidesteps the subdomain-MX limitation entirely. Check this before considering option 2 — it costs nothing to try.
2. **Move the domain's DNS to a provider that supports subdomain MX records** (Cloudflare, for example), then verify the domain in Resend and set `EMAIL_FROM_ADDRESS`. This means recreating *every* existing record at the new provider — the Google Workspace MX records, the Wix site records, and any existing verification TXT records. Treat it as a planned migration with mail downtime risk, not a quick change.

Notifications depend on the Stripe webhook being live: the email is composed inside `api/stripe-webhook.js`, so if the webhook is not configured, no email is ever built regardless of these variables.

## Testing and CI

The repository includes automated checks:

- `npm test` runs the Node test suite
- `npm run test:consistency` runs the dedicated pricing consistency checks
- GitHub Actions runs a syntax check across all JavaScript files and imports all serverless entrypoints before merging

The suite is offline and needs no credentials: the Google Sheets tests stub `globalThis.fetch` and generate a throwaway RSA key pair, and nothing calls Gemini or Stripe. Most cases exist to catch *drift* rather than to prove a function works — a price hardcoded in the prompt disagreeing with the pricing table, a worked example in a comment disagreeing with the formula, or the Sheet row disagreeing with the range it is written into. A failure there usually means two things that must agree no longer do.

## Troubleshooting

- `500` or "API key missing": ensure `GEMINI_API_KEY` is set.
- Every chat request fails after adding a knowledge module: check the import path against the real filename. A typo there breaks `api/chat.js` at load time, which takes `/api/create-deposit` down with it since it imports `chat.js`. `npm test` still passes — the import check (`node -e "import('./api/chat.js')"`, which CI runs over every entrypoint) is what catches it.
- `502` or Gemini API errors: verify the key is valid and the endpoint is reachable.
- Price response seems blocked unexpectedly: check logs for the guardrail message and inspect whether the amount was recognized.
- Deposit button does not appear: a price question must have been asked, and a specific wall bed model established. If cabinetry has been mentioned, the button waits for the full combined estimate rather than offering the bed alone. A Murano below the 2.4 m ceiling minimum is never offered a deposit.
- Deposit confirmation does not appear in the chat after paying: expected when the original tab was closed, or if the browser severed `window.opener` on the way through Stripe. The success page still confirms the payment, and the webhook still records it — nothing is lost.
- Sheet columns look shifted: the row must line up with the `A:K` range. A row wider than its range is truncated silently by the Sheets API, so check both together after adding a column.
- Stripe webhook returns 400: verify `STRIPE_WEBHOOK_SECRET` matches the endpoint and the body parser is disabled in `api/stripe-webhook.js`.
- Deposit logging is missing: confirm the `GOOGLE_SHEETS_*` variables are configured.
- Deposit notification email not arriving: confirm both `EMAIL_API_KEY` and `COMPANY_NOTIFY_EMAIL` are set and that you redeployed afterwards. On Resend's test sender (no `EMAIL_FROM_ADDRESS`), `COMPANY_NOTIFY_EMAIL` must be your own Resend account email, or Resend returns a `403` — check the `stripe-webhook` function logs for the error.

## Notes

- Do not commit API keys or secrets to the repository.
- System prompt wording and knowledge modules strongly influence behavior; validate pricing-sensitive changes with the project tests.
- This project intentionally keeps model-generated product recommendations constrained and cross-checked by server logic to reduce hallucinated pricing and invalid product claims.

---