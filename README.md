# MOCOF Chatbot

A Vercel-hosted AI chatbot for MOCOF that answers product questions, helps shortlist wall beds, furniture, and bedding, calculates surround-cabinetry estimates, and can take a reservation deposit through Stripe — 10% of the total, or a fixed amount the customer chooses.

Customers know the assistant as **MOCOF CS**, short for **MOCOF Customer Support**.

## Overview

This project combines:

- a floating chat widget in the browser
- a serverless backend in `api/`
- curated product and showroom knowledge in `knowledge/`
- a pricing guardrail that prevents unsupported RM values from reaching customers
- Stripe Checkout for deposits tied to a quote reference and confirmable webhook handling
- a separate, passcode-gated staff tool at `/staff` that turns a described order into a real Stripe invoice
- automated tests plus CI syntax/import validation

The chatbot uses Gemini through Google's OpenAI-compatible chat completions endpoint and keeps manual pricing logic in JavaScript instead of trusting the model to do arithmetic.

**Changing the assistant's name.** The name isn't stored in one place; it is written into four files, and all four need updating together:

- `api/chat.js` — the opening line of the system prompt, which is how the model knows what to call itself
- `public/index.html` — the chat header (name and subtitle), the welcome message, and the label under each bot message
- `public/deposit-success.html` — the header and message label on the post-payment confirmation page
- `FUTURE_FB_WHATSAPP_INTEGRATION.md` — mentions the assistant by name

## Prerequisites

- Node.js 24.x — matches the `engines` field in `package.json`, which is what Vercel reads
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

Staff invoice tool only — **not** used by the customer-facing chatbot, and unrelated to any variable above. The tool is unavailable until both are set:
- `STAFF_TOOL_PASSCODE` — the shared passcode staff type at `/staff`. Anyone who has it can create real invoices in MOCOF's name, so treat it like a password: long, random, shared privately, rotated when someone leaves.
- `STAFF_SESSION_SECRET` — signs the staff session cookie. A long random string (e.g. `openssl rand -hex 32`). **Must be a different value from `STAFF_TOOL_PASSCODE`** — reusing the passcode here would let anyone who knows it forge sessions directly. Changing it signs every staff member out immediately, which is also how you revoke access in a hurry.

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
- `api/create-deposit.js` — creates a Stripe Checkout session for a validated deposit (10% of the total, or an allowed fixed amount)
- `api/stripe-webhook.js` — validates Stripe webhook signatures and records confirmed deposits
- `knowledge/` — product and service knowledge modules used to guide responses
- `knowledge/productImages.js` — maps product names to real catalog photos
- `knowledge/cabinetry.js` — surround-cabinetry pricing formula and related constants
- `knowledge/bedsheets.js` — bedding and bath catalog (Signoria Firenze, Luxury Tencel, Egyptian Cotton, Pure Cotton, accessories, cushions, bath)
- `lib/reference.js` — generates `MQS-YYYYMMDD-XXXXXX` quote references for Stripe metadata
- `lib/sheetsLogger.js` — logs confirmed deposits to Google Sheets when configured
- `GOOGLE_SHEETS_CREDENTIALS.md` — Sheet column list, and how the Google service-account credentials are provisioned
- `CLAUDE.md` — architecture notes and the invariants to preserve when changing pricing, deposits, or the Sheet row
- `FUTURE_FB_WHATSAPP_INTEGRATION.md` — planning notes for a possible future Facebook Messenger / WhatsApp channel via Zernio; nothing in the code uses it yet
- `public/index.html` — chat widget UI
- `public/staff.html` — staff-only invoice tool UI, served at `/staff` (passcode gate, then chat → review → create)
- `api/staff-login.js`, `api/staff-chat.js`, `api/staff-create-invoice.js` — the staff tool's endpoints; every one requires a valid staff session
- `lib/staffAuth.js` — staff session tokens (HMAC-SHA256, no DB), passcode comparison, and the `requireStaffAuth()` gate
- `lib/invoiceInput.js` — validates staff-confirmed invoice input before Stripe is touched, and parses the model's proposal
- `lib/productNames.js` — canonical product names derived from `knowledge/*.js`, and the conservative normalizer that tidies invoice line-item descriptions (never overrides what staff typed when it is unsure)
- `lib/productPricing.js` — resolves an invoice line item's **sale** price from the knowledge base in code, so an invoice figure never originates from the model; returns `null` for anything it cannot pin to exactly one product
- `lib/gemini.js` — the Gemini caller, shared by the customer bot and the staff tool
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
6. If a deposit is payable — either a full wall-bed + cabinetry estimate, or a wall bed on its own — the widget may also render a deposit card and trigger the Stripe flow.

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

All three inputs are required. Until every one is known, the prompt instead carries an instruction naming the specific item(s) still missing and telling the model to keep asking for them one at a time — including re-asking when a reply was blank, unparseable, or out of range. Without that, an unusable answer would silently end the measurement flow, and neither the estimate nor the deposit offer would ever appear.

A customer doesn't have to use price words to get the estimate. If the bot offers one ("Would you like an estimate for adding surround cabinetry?") and the customer just says "yes", that counts as asking. Otherwise the pre-calculated figures would be withheld, the model would improvise its own, and the guardrail would replace the whole reply with the WhatsApp fallback.

Re-asking has a limit. Once the bot has asked for the same measurement twice and still can't read a usable number, the keep-asking instruction is replaced by one telling it to stop and offer a colleague on WhatsApp instead — measuring a wall over chat is fiddly, and some customers can't do it. It still never quotes a cabinetry price without the measurements.

### Human handoff

Beyond the price guardrail's fallback, the system prompt tells the bot to offer a colleague on WhatsApp — **+60 12-568 4568** for products, **+60 12-475 4568** for renovation — when the customer seems confused or frustrated, when it has failed to help with the same thing across a couple of turns, when a request is outside the catalog or it isn't confident in its answer, or when the customer asks for a person. The handoff is framed as help arriving rather than a dead end, and the bot keeps answering what it can alongside it. This is the one exception to the rule that otherwise keeps the WhatsApp number out of non-renovation replies.

### Deposit flow

The widget can show a deposit card in three situations:

- **Wall bed + cabinetry** — the combined grand total, once a full estimate has been worked out and its price revealed.
- **Wall bed only** — the model's sale price alone, once the customer says they want that specific bed.
- **Product reservation** — a fixed amount to reserve anything else in the catalog (a sofa, a table, a bedding set), once the customer says they want it. This one carries no order total at all, which is what lets it work for products that have no structured price.

Both are decided by a single function, `getDepositBasisFromContext()` in `api/chat.js`. The chat response's card and the actual Stripe charge both read from it and nothing else, so the quoted and charged amounts cannot diverge.

The gating is deliberately conservative — the card should never appear ahead of a price, and never in reply to a question that was only asking:

- **Cabinetry deposits** need a complete estimate plus a revealed price: either the customer asked for it ("how much", "what's the total", or "yes" to the bot's offer of an estimate), or the grand total was already shown in an earlier reply.
- **Wall-bed-only deposits** need purchase intent, not just a priced model. "I want the Murano Queen", "I'll take it", "how do I reserve?", or "yes" to the bot's own reservation invite all count. "Is there a Murano Single?" and "How much is it?" do not — the bot answers the question and doesn't mention deposits.
- **No downgrading mid-quote.** Once cabinetry comes up on *either* side of the conversation, the cheaper bed-only deposit is withheld until the combined estimate is complete. Declining cabinetry ("no cabinets", "just the bed") re-opens the bed-only option; asking for cabinets again closes it.
- **No deposit is offered for a Murano below its 2.4 m ceiling minimum.** The app never takes money for a bed that cannot be installed.

The bot's wording follows the same rules: the prompt only lets it invite a reservation once a specific model is settled and the customer wants it, and bars it from writing payment links or stating the deposit amount itself.

The flow is:

1. `api/chat.js` computes a deposit offer using the same basis the pricing breakdown uses.
2. The browser sends the conversation snapshot to `POST /api/create-deposit`.
3. `api/create-deposit.js` re-derives the total instead of trusting client-supplied amounts, then re-validates the customer's chosen deposit option against it.
4. Stripe creates a hosted Checkout session in MYR for the validated deposit amount.
5. Stripe sends `checkout.session.completed` to `api/stripe-webhook.js`.
6. The webhook verifies the signature, then records the deposit by email and to Google Sheets.

After payment, `public/deposit-success.html` confirms the deposit and — when the original chat tab is still reachable — posts back to it so the confirmation also appears as a message in the conversation. That messaging is best-effort; the success page is a complete confirmation on its own if it fails.

### Deposit amount options

The deposit card lets the customer choose how much to put down. For a wall bed: **10% of the total** (the default), or a fixed **RM 1,500 / RM 2,500 / RM 3,500 / RM 4,500**, excluding any fixed amount at or above the order's total.

For a **product reservation** the fixed amounts are the only choices — there is no percentage, because there is no computed total to take a percentage of. That is the whole point: most of the catalog has no price table, so the deposit is decoupled from price rather than blocked by its absence. The product name is recorded for the Sheet and the email, but it is identified loosely from the conversation and never affects the amount; an unrecognised product still reserves fine and logs `(unspecified product)`.

The browser sends back only the chosen option's id (`percent`, `fixed_1500`, …), never an amount. `api/create-deposit.js` rebuilds the option list from the freshly re-derived grand total and accepts only an exact match against it, so a tampered request can neither introduce a new amount nor charge one that wasn't offered. The allowed fixed amounts live in a single server-side constant, `ALLOWED_FIXED_DEPOSITS` in `api/chat.js`.

### Deposit logging

Every confirmed deposit appends one row to the configured Google Sheet, in the range `<tab>!A:M`:

| A | B | C | D | E | F | G | H | I | J | K | L | M |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Timestamp | Quote Ref | Wall Bed Model | Grand Total | Deposit % | Deposit Paid | Customer Email | Customer Name | Customer Phone | Stripe Session ID | Cabinets | Deposit Option | Product |

**Cabinets** is `Yes` or `No` — whether the deposit covers surround cabinetry or the bed alone.

**Deposit Option** is the option the customer picked — `10% of total`, or `Fixed RM 1,500.00` and so on. For a fixed-amount deposit, **Deposit %** is left blank. The notification email shows the same option.

**Product** is what the deposit is for, filled on every row: wall bed rows mirror the Wall Bed Model column, and product reservations carry their own label. **Add the `Product` header to column M of the Sheet by hand** — the logger writes by position and never writes headers.

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

Each notification goes out as **both an HTML table and a plain-text version**, in one message. Clients that render HTML show the table; the rest fall back to the text, which also helps deliverability. Both carry identical data, so neither is a summary of the other. The HTML uses inline styles only — email clients strip `<style>` blocks — and every interpolated value is HTML-escaped, since customer names and emails arrive from Stripe metadata and could otherwise break the markup.

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

## Staff invoice tool

A separate, staff-only page at `/staff` that turns a plain-English order description into a real Stripe invoice with a payable link to send the customer. It shares no code path with the customer chatbot.

In normal use a staff member supplies three things — customer name, customer email, and what the customer is buying. **They do not type prices for catalog products**; the server fills those in.

1. Staff enter the shared passcode (`STAFF_TOOL_PASSCODE`) and get an 8-hour session cookie.
2. They describe the order in chat. `POST /api/staff-chat` asks Gemini to turn it into structured fields and **returns a proposal only** — this endpoint never contacts Stripe. The model is asked for product *names*, never for a figure. If the customer's email is missing, or it genuinely cannot tell what is being sold, it replies with one clarifying question instead.
3. Still on the server, `lib/productPricing.js` looks each line item up in the knowledge base and fills in the catalog **sale** price, replacing the description with the canonical product name (`murano q` → `Murano Queen`, RM 14,371.55). Anything it cannot price confidently is left blank for the staff member to type in.
4. The proposal appears as an editable form: customer name, email, and a row per line item. Auto-filled amounts are marked *"Catalog price — editable"*, and that marker disappears as soon as the field is typed over. Every figure can be corrected, lines added or removed.
5. **Confirm & Create Invoice** posts the edited fields to `POST /api/staff-create-invoice`, which re-validates them server-side, creates the Stripe customer and invoice, finalizes it, and returns the hosted payment link to copy.

### Where the prices come from

Catalog prices are resolved from the same structured tables the customer bot prices against, so the invoice and the chat quote cannot disagree:

- `WALLBED_MODEL_PRICING` in `knowledge/wallbeds.js` — all 10 Murano and Gioco models.
- `BASIC_SOFA_PRICING` in `knowledge/basicfurniture.js` — the 20 priced MOCOF Basic sofas. The prose in that file stays the source of truth, and a consistency test asserts every figure in the table still matches it.

The **sale** price is always used, because sale prices are what the bot quotes everywhere else — an invoice quoting retail would contradict a price the customer had already been given.

Some things have no single catalog price and deliberately fall through to manual entry: custom carpentry, delivery, site-survey and balance-payment lines; bedsheets (sold as ranges); and surround cabinetry (computed from wall measurements, not looked up). These arrive with an empty amount rather than a guess.

### Why it is safe to let a model near invoicing

- **The model is never asked for a price.** It returns product names; `lib/productPricing.js` resolves the figure from the knowledge base in code. Any amount the model volunteers anyway is discarded rather than reviewed — a plausible invented figure is the one error a reviewer is least likely to catch, so the safest design is one where the model never produces a number at all. The catalog it is given in the prompt is a list of names only — a test asserts that reference carries no price figure.
- **The model proposes; a human confirms; the server decides.** `/api/staff-chat` cannot create anything. `/api/staff-create-invoice` accepts structured fields only — never free text, and never anything forwarded straight from the model.
- **Name matching refuses to guess.** A description that matches no catalog product, or more than one, resolves to "no price" rather than a best effort — so an unrecognised custom line keeps the words the staff member chose instead of borrowing another product's price.
- **Validation is server-side regardless of the form.** `validateInvoiceInput()` rejects a missing email, an empty line-item list, and any amount that is not a finite number above zero. There is a RM 100,000 ceiling per line and in total as a fat-finger guard; raising it is a code change, not a runtime option.
- **Every staff route checks the session first**, before any Gemini or Stripe call, so an unauthenticated request costs nothing and reveals nothing.

Note what is deliberately *not* enforced: the catalog price is a **default, not a rule**. Staff are a trusted role and may type over any filled-in figure — for a discount, a bundle, or a price the catalog has not caught up with — and whatever they confirm is what gets invoiced. The RM 100,000 ceiling remains the only backstop.

### Security boundary

`/api/chat` is public by design: `Access-Control-Allow-Origin: *` and no auth. The staff routes are the opposite, and `vercel.json` enforces the split:

- The wildcard CORS rule is scoped to `/api/((?!staff-).*)` — it deliberately **excludes** `/api/staff-*`. A new staff endpoint whose filename does not begin with `staff-` would silently opt into public CORS.
- The permissive frame headers (`X-Frame-Options: ALLOWALL`) that let the storefront embed the widget are scoped to `/((?!staff).*)`, and `/staff*` gets `DENY` plus `frame-ancestors 'none'` instead. Without that the tool could be loaded in an invisible iframe and a signed-in staff member clickjacked into creating an invoice.
- The session cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, and holds an HMAC-signed expiry — there is no session store to read, and the expiry cannot be edited without invalidating the signature. `Secure` is dropped only when the request's host is localhost, so `vercel dev` over http still works.

## Testing and CI

The repository includes automated checks:

- `npm test` runs the Node test suite
- `npm run test:consistency` runs the dedicated pricing consistency checks
- GitHub Actions runs a syntax check across all JavaScript files and imports all serverless entrypoints before merging

The suite is offline and needs no credentials: the Google Sheets tests stub `globalThis.fetch` and generate a throwaway RSA key pair, and nothing calls Gemini or Stripe. Most cases exist to catch *drift* rather than to prove a function works — a price hardcoded in the prompt disagreeing with the pricing table, a worked example in a comment disagreeing with the formula, or the Sheet row disagreeing with the range it is written into. A failure there usually means two things that must agree no longer do.

`api/create-deposit.js` and `api/stripe-webhook.js` import `stripe`, so the suite doesn't run them. Instead it reads their source to pin the wiring that matters: the charge comes only from `buildDepositCharge()` with no amount read off the request, and every metadata field written at charge time is read back by the webhook. The deposit logic itself lives in `api/chat.js`, where it is tested directly.

## Troubleshooting

- `500` or "API key missing": ensure `GEMINI_API_KEY` is set.
- Every chat request fails after adding a knowledge module: check the import path against the real filename. A typo there breaks `api/chat.js` at load time, which takes `/api/create-deposit` down with it since it imports `chat.js`. `npm test` still passes — the import check (`node -e "import('./api/chat.js')"`, which CI runs over every entrypoint) is what catches it.
- `502` or Gemini API errors: verify the key is valid and the endpoint is reachable.
- Price response seems blocked unexpectedly: check logs for the guardrail message and inspect whether the amount was recognized.
- Deposit card does not appear: for a wall bed on its own, the customer must have named a specific model and said they want it — an availability or price question alone is not enough. For cabinetry, the estimate must be complete and its price revealed; while cabinetry is still being discussed, the bed-only card is held back unless the customer declines cabinetry. A Murano below the 2.4 m ceiling minimum is never offered a deposit. To see which rule stopped it, search the `chat` function logs for `[deposit] suppressed:`. Treat `[deposit] WITHHELD despite buy intent:` (logged as an error) as the likely-bug case — the customer named a model and said they want it, and still got no card.
- Checkout fails with "That deposit option is not available for this order": the requested option isn't in the server's list for this order's grand total — usually a fixed amount at or above the total, or a request the widget didn't send. `create-deposit` logs `[deposit] rejected deposit option:` with the reason.
- Deposit confirmation does not appear in the chat after paying: expected when the original tab was closed, or if the browser severed `window.opener` on the way through Stripe. The success page still confirms the payment, and the webhook still records it — nothing is lost.
- Sheet columns look shifted: the row must line up with the `A:M` range. A row wider than its range is truncated silently by the Sheets API, so check both together after adding a column.
- Stripe webhook returns 400: verify `STRIPE_WEBHOOK_SECRET` matches the endpoint and the body parser is disabled in `api/stripe-webhook.js`.
- Deposit logging is missing: confirm the `GOOGLE_SHEETS_*` variables are configured.
- Deposit notification email not arriving: confirm both `EMAIL_API_KEY` and `COMPANY_NOTIFY_EMAIL` are set and that you redeployed afterwards. On Resend's test sender (no `EMAIL_FROM_ADDRESS`), `COMPANY_NOTIFY_EMAIL` must be your own Resend account email, or Resend returns a `403` — check the `stripe-webhook` function logs for the error.

## Notes

- Do not commit API keys or secrets to the repository.
- System prompt wording and knowledge modules strongly influence behavior; validate pricing-sensitive changes with the project tests.
- This project intentionally keeps model-generated product recommendations constrained and cross-checked by server logic to reduce hallucinated pricing and invalid product claims.

---