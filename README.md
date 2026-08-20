# MOCOF Chatbot

> A lightweight chatbot for MOCOF (Malaysian furniture & interior design) that runs as a Vercel serverless app and uses Google's Gemini API via OpenAI-compatible endpoints.

## Overview

This repository implements a small, production-ready chat widget ("Moco") and a serverless backend that forwards customer messages to the Gemini chat completion API. The backend composes a controlled system prompt from curated product and service knowledge files, computes live custom-cabinetry price estimates where applicable, verifies every price in the model's reply against real business data before it's sent to a customer, and returns concise, branded replies to the client widget. Separate product-image matching logic attaches real catalog photos when a product is mentioned.

## Quick Start

Prerequisites:
- Node.js 20.x
- Vercel CLI (for `npm run dev`) or deploy directly via the Vercel dashboard
- Set the following environment variables in Vercel or your shell:
   - `GEMINI_API_KEY` (required)
   - `GEMINI_API_KEY_2` (optional — automatic fallback if the primary key hits a rate limit or a 5xx; see "Reliability" below)
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (optional — enables the "Pay Deposit" button; see "Deposit payments (Stripe)" below. The chatbot works fine without these, it just never offers a deposit)

Install and run locally:

\`\`\`bash
npm install
npm run dev
\`\`\`

Open `http://localhost:3000/` to view the chat widget while `vercel dev` is running.

Run tests before committing:

\`\`\`bash
npm test                    # Run full test suite
npm run test:consistency    # Run consistency checks
\`\`\`

Test the API directly (example):

\`\`\`bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Tell me about your wall bed products", "history": [] }'
\`\`\`

## Project structure

- `package.json`: project metadata and scripts (`dev` uses `vercel dev`, `test` and `test:consistency` for testing).
- `vercel.json`: headers and rewrites used for local/production behavior.
- `api/chat.js`: the serverless handler — knowledge routing, system prompt assembly, the Gemini call, live cabinetry price calculation, the price-hallucination guardrail, and the deposit-offer gate (`computeDepositOffer()`) all live here.
- `api/create-deposit.js`: creates a Stripe Checkout Session for a 10% deposit once a full wall bed + cabinetry estimate exists — see "Deposit payments (Stripe)" below.
- `api/stripe-webhook.js`: receives Stripe's `checkout.session.completed` event and confirms the deposit.
- `lib/reference.js`: generates the `MQS-YYYYMMDD-XXXXXX` quote reference used to tie a Stripe payment back to its conversation.
- `.github/workflows/ci.yml`: automated CI pipeline that syntax-checks all JS files and runs test suite on every push and pull request.
- `knowledge/`: modules that export product/service knowledge used to build the system prompt (see below for the full list — two of them also export plain functions/data, not just prompt text).
- `knowledge/productImages.js`: a separate image matcher that maps product names to real catalog photos and attaches them when relevant.
- `public/index.html`: a minimal floating chat widget that calls `/api/chat` and `/api/create-deposit`.

See the files in the repo for implementation details.

## How the backend works

1. Client (browser widget) sends a POST to `/api/chat` with a JSON body:
   - `message` (string) — the user's latest message (required)
   - `history` (array) — optional conversation history (user/assistant pairs)

2. `api/chat.js` builds a system prompt that contains:
   - A short persona description (the `Moco` brand voice and response rules).
   - Business-specific rules (pricing presentation, WhatsApp usage rules, recommendation heuristics, renovation lead collection, surround-cabinetry estimation).
   - Curated product knowledge concatenated from up to `MAX_KNOWLEDGE_MODULES` (currently 3) `knowledge/*.js` modules. Which modules are included is decided by `getRelevantKnowledge()`: each module in the `KNOWLEDGE_MODULES` array has a regex `test` — matches against the **current message** are prioritized over matches that only appear in recent history (last 4 messages), and the total is capped so a single multi-topic message can't balloon the prompt past Gemini's request budget. Additionally, cheaper alternatives from `basicfurniture.js` are automatically included whenever any of the companion categories (wall bed, sofa bed, table, kitchen, wardrobe) are relevant, so customers always get budget-alternative suggestions without the model needing to remember to offer them.
   - If the conversation contains enough information for a live surround-cabinetry price estimate **and the customer explicitly requests a quote or estimate**, a **pre-calculated** breakdown block (computed in JS, not by the model) is appended — see "Pricing accuracy & guardrails" below. Total wall width is always required for this now (not just on tall walls), and a wall height under 7ft is blocked with an explicit "can't fit" message rather than silently priced.

3. The server converts the history into Gemini's OpenAI-compatible message format (capped to the last `MAX_HISTORY_TURNS_SENT_TO_MODEL`, currently 12, turns), appends the user's message, and calls the Gemini chat completions endpoint with the model in `GEMINI_MODEL` (currently `gemini-3.5-flash-lite`) using the request settings defined in `api/chat.js`.

4. `api/chat.js` tries `GEMINI_API_KEY` first and automatically falls back to `GEMINI_API_KEY_2` (if set) on a rate limit or a 5xx from Gemini — see `callGeminiWithFallback()`.

5. Before the reply is sent to the client, every `RM` figure in it is checked against the price guardrail (below). If anything unrecognized is found, the whole reply is swapped for a safe "let's confirm on WhatsApp" fallback rather than risking a wrong quote reaching a customer.

6. The response is relayed to the client as JSON: `{ success: true, message: "...", images: [...] }` (or an error payload on failure).

**Model note:** Gemini model names and request constraints can change over time. Check Google's Gemini/OpenAI-compatible API docs occasionally and update the `GEMINI_MODEL` constant if needed. If you switch model families, double-check the request parameters in `api/chat.js` too.

Other implementation notes:
- CORS and common headers are set in the handler and mirrored in `vercel.json`.
- The server enforces prompt-level rules such as formatting (only **bold** allowed for emphasis) and response length guidelines.

## Knowledge modules

| File | Exports | Notes |
|---|---|---|
| `wallbeds.js` | `getWallBedKnowledge()`, `WALLBED_MODEL_WIDTHS_FT`, `WALLBED_MODEL_PRICING` | The width lookup and the granular pricing table are structured data (not just prompt text) — they're imported directly by `chat.js` to derive a wall bed's width and sale/retail prices from whichever model has been discussed, so the bot never has to ask a customer for that spec or price. |
| `sofabeds.js` | `getSofaBedKnowledge()` | |
| `tables.js` | `getTableKnowledge()` | |
| `kitchen.js` | `getKitchenKnowledge()` | |
| `wardrobes.js` | `getWardrobeKnowledge()` | Standalone/free-standing wardrobes — distinct from surround cabinetry, see `cabinetry.js`. |
| `showroom.js` | `getShowroomKnowledge()` | |
| `warranty.js` | `getWarrantyKnowledge()` | |
| `renovation.js` | `getRenovationKnowledge()` | |
| `basicfurniture.js` | `getBasicFurnitureKnowledge()` | MOCOF Basic standalone furniture (living room, dining room, hallway/storage, bedroom, study tables) — automatically included whenever any companion category (wall bed, sofa bed, table, kitchen, wardrobe) is routed, ensuring budget-alternative suggestions are always available without explicit model instruction. |
| `productImages.js` | `getRelevantImages()` | Product-name to photo matching for the reply image attachment flow. |
| `cabinetry.js` | `getCabinetryKnowledge()`, `calculateCabinetPrice()` | Surround cabinetry (side + overhead cabinets built around a wall bed). `calculateCabinetPrice()` is a pure function implementing the real pricing formula — `chat.js` calls it directly to compute a live estimate rather than trusting the model to do the arithmetic. |

Most modules export a single function returning a template string that gets concatenated into the system prompt. `wallbeds.js` and `cabinetry.js` are the exceptions — they also export plain data/functions that `chat.js` uses directly in code, not just as prompt text.

To add or update product information:
1. Add a new `knowledge/<topic>.js` exporting `get<Topic>Knowledge()` that returns the text to include in the prompt.
2. Import it in `api/chat.js` and add an entry to the `KNOWLEDGE_MODULES` array: `{ key: 'yourTopic', test: /keyword|regex/, fn: getYourTopicKnowledge }`. Order matters if you expect overlap with other modules on a single message, since the array order is the tie-break priority when `MAX_KNOWLEDGE_MODULES` is reached.
3. If your knowledge contains prices, they're automatically picked up by the price guardrail's `MASTER_PRICE_LIST` — no extra step needed, as long as the module is added to the `extractAmounts([...])` list in `chat.js`.
4. If the product should attach a photo, add or update the mapping in `knowledge/productImages.js` so the backend can match the name to a real image URL.

Design notes: keep the knowledge strings factual and avoid adding instructions that conflict with the system-level persona and formatting rules.

## Pricing accuracy & guardrails

This bot has been through real hallucination incidents in testing (inventing non-existent products, misquoting prices, denying real products exist), so two layers of protection are built in:

**1. History-aware knowledge routing.** `getRelevantKnowledge()` checks recent conversation history, not just the current message — otherwise a natural follow-up like "what is X?" (where X was named by the bot a turn earlier) loses all context and the bot may wrongly deny a real product exists.

**2. The price guardrail (`findHallucinatedPrices` / `isKnownAmount` in `chat.js`).** Before any reply reaches the client, every `RM` figure in it is checked against:
   - `MASTER_PRICE_LIST` — every real price across the entire knowledge base (not just what got routed into this turn's prompt), with a small (`PRICE_TOLERANCE`, RM2) tolerance to forgive the model rounding off cents in casual phrasing.
   - Any amount the *customer themselves* stated (so echoing back a stated budget is never flagged).
   - Any amount matching a **live cabinetry estimate** computed for this conversation (see below).

   If a reply contains a price matching none of the above, the entire reply is replaced with a generic "let's confirm on WhatsApp" fallback rather than risking a wrong number reaching a customer. Check server logs for `Blocked reply containing unrecognized price(s)` if this fires more than expected — it either caught a genuine hallucination (good) or a legitimate price is being phrased in a format the guardrail doesn't recognize (needs tuning).

**3. Live surround-cabinetry pricing.** This is the one case where the model is allowed to state a price that isn't literally written in a knowledge file — it's a formula-based estimate computed from the customer's own wall measurements. `chat.js` extracts wall height / total wall width from the conversation via regex (`extractCabinetryDimensions`), derives the wall bed's width automatically from whichever model has been discussed (`extractSelectedWallBedModel` + `WALLBED_MODEL_WIDTHS_FT` — the customer is never asked for this directly, since they likely wouldn't know it), runs the real formula (`calculateCabinetPrice()` in `knowledge/cabinetry.js`), and injects the already-computed breakdown into the system prompt so the model relays exact figures instead of doing its own arithmetic. The same computation feeds the guardrail's allow-list, so the two can never disagree with each other. See the comments in `knowledge/cabinetry.js` for the formula itself and worked examples.

## Deposit payments (Stripe)

Once a customer has a full wall bed + cabinetry grand total (the same PRE-CALCULATED ESTIMATE described above), the widget can offer a "Pay 10% Deposit" button that opens a Stripe-hosted Checkout page. Full design rationale lives in `stripe-payment-gateway-proposal-v2.md`; this section covers what's actually implemented.

**How it fits together:**
1. `api/chat.js`'s handler computes `computeDepositOffer()` on every turn — it reuses the exact same price-intent gate and grand-total resolution as the text breakdown, so the button can never appear ahead of (or instead of) the price itself. This is returned to the widget as `deposit` alongside the normal `message`/`images` fields — never written by the AI.
2. The widget renders a real `<button>` (not a link the model generated — see the proposal's Section 5 on why) showing the grand total and the 10% deposit amount.
3. Clicking it POSTs the same `(message, history)` pair to `POST /api/create-deposit`, which **independently re-derives the grand total from the conversation** rather than trusting anything the browser sends — the client only ever supplies the raw conversation, never a dollar amount.
4. `create-deposit.js` creates a Stripe Checkout Session (card + FPX, MYR) for 10% of that re-derived total, tagged with a generated quote reference (`lib/reference.js`) in `metadata`, and returns the checkout URL. The widget opens it in a new tab (the chat itself is often embedded in an iframe, so a same-tab redirect would strand the conversation).
5. Stripe calls `POST /api/stripe-webhook` on `checkout.session.completed` (the reliable fulfillment signal — a customer can close the tab before the success-page redirect fires). The handler verifies the signature, then logs the confirmed deposit (quote ref, model, amounts, payer email from Stripe's own checkout).

**Setup:**
1. Create/activate a Stripe account for the MOCOF entity and complete Malaysian business verification.
2. In the Stripe Dashboard, under Payment methods, enable **FPX** (off by default).
3. Grab the **test-mode** secret key first (`sk_test_...`) — don't use live keys until a few test-mode deposits have gone through cleanly.
4. Set env vars in Vercel: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (from the Dashboard once the endpoint below is registered), and optionally `SITE_URL` (defaults to the production widget URL if unset).
5. In the Stripe Dashboard → Developers → Webhooks, add an endpoint pointing at `https://<your-deployment>/api/stripe-webhook`, subscribed to `checkout.session.completed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
6. For local testing, use the Stripe CLI (`stripe listen --forward-to localhost:3000/api/stripe-webhook`) rather than the real Dashboard endpoint.

**Deliberately not yet wired up:**
- **Company notification on payment.** `stripe-webhook.js` logs every confirmed deposit but doesn't send an email — MOCOF chose Resend for a general chat-alerting feature earlier in this project, then asked to remove that feature entirely, so re-adding email specifically for payment notifications is a channel/inbox decision worth confirming rather than a default this file should make quietly. Set `EMAIL_API_KEY` + `COMPANY_NOTIFY_EMAIL` and implement the send in `notifyCompany()` once that's decided.
- **Lead-sheet logging.** The webhook has a marked spot to log a paid deposit as a "won" lead once Phase 4 (Google Sheets) exists again on `main` — it was built Aug 19 and reverted Aug 20.
- **Customer email/phone collection in the widget.** None exists today. Stripe Checkout collects an email itself as part of its hosted flow, so this was left as-is rather than adding a new question to the chat just to duplicate it — revisit if you want the email captured even when a customer abandons checkout before paying.
- **Refund policy wording, and where `cancel_url` should send the customer** — business decisions called out as open in the proposal, not code changes.

## Response & persona rules (enforced in the system prompt)

- Persona: Warm, professional, concise. Ask clarifying questions when needed, one at a time.
- WhatsApp contact: only appended for renovation budget/design flows (explicit budget/design mention required), or when directing a customer to confirm a custom quote.
- Pricing: always present both `Retail: RM X | Sale: RM X` when price data exists; never fabricate prices — except the live cabinetry estimate described above, which is explicitly carved out as the one allowed exception.
- Formatting: use **only** Markdown bold (double asterisks) for emphasis. No italics or other Markdown.
- Length: prefer concise replies (maximum about 120 words unless more detail is requested).

## Extending or customizing

- To change the model or request settings, update the constants at the top of `api/chat.js` (`GEMINI_URL`, `GEMINI_MODEL`, and the `requestBody` parameters in the handler).
- To add richer user intent detection, add entries to the `KNOWLEDGE_MODULES` array rather than writing ad-hoc `if` chains — this keeps routing, priority, and the `MAX_KNOWLEDGE_MODULES` cap consistent.
- `MAX_KNOWLEDGE_MODULES` and `MAX_HISTORY_TURNS_SENT_TO_MODEL` are the two token-budget levers if you need to trade off context richness against Gemini's request limits.
- `PRICE_TOLERANCE` (in `chat.js`) controls how much rounding the guardrail forgives before treating a price as suspicious.

## Testing & CI

- The project includes automated CI via GitHub Actions (`.github/workflows/ci.yml`).
- On every push and pull request, the CI pipeline:
  - Syntax-checks all JavaScript files in the repo (catches typos before deployment).
  - Runs the full test suite (`npm test`).
- Use `npm test` locally before pushing to catch issues early.

## Deployment

- Deploy to Vercel and set the environment variable `GEMINI_API_KEY` (plus `GEMINI_API_KEY_2` if you want automatic fallback — see "Reliability" above).
- The `vercel.json` file contains header rules and rewrites used by the project.
- The CI pipeline validates all code before merge, so pull requests with syntax errors or test failures are automatically flagged.

## Troubleshooting

- `500` / "API key missing": ensure `GEMINI_API_KEY` is set in your environment.
- `502` / Gemini API errors: check your API key is valid, rate limits, and the `details` field in the error JSON returned by the endpoint.
- Bot gives a generic "confirm on WhatsApp" reply instead of an expected price: check server logs for `Blocked reply containing unrecognized price(s)` — see "Pricing accuracy & guardrails" above.
- Cabinetry estimate not appearing: it requires a wall height AND total wall width AND an established wall bed model somewhere in the recent conversation — if any of those is missing, the bot will keep asking rather than guessing. A wall height under 7ft is a separate, deliberate case (surround cabinetry can't physically fit) — the bot should say so explicitly rather than asking for more measurements.
- "Pay Deposit" button not appearing: same requirements as the cabinetry estimate above (it uses the identical gate), so if the text breakdown isn't showing, the button won't either.
- `create-deposit` returns "payments are not yet configured": `STRIPE_SECRET_KEY` isn't set in the environment.
- Stripe webhook returns 400 "signature verification failed": either `STRIPE_WEBHOOK_SECRET` doesn't match the endpoint's actual signing secret in the Stripe Dashboard, or the request body was parsed/re-serialized before reaching the handler — check that `export const config = { api: { bodyParser: false } }` in `stripe-webhook.js` hasn't been removed.

## Known limitations

- `/api/chat` has no rate limiting or authentication; the endpoint URL is visible in the client-side widget source, so it can be called directly by anyone.
- No server-side cap on incoming message length (only the widget's client-side `maxlength`).

## Notes & safety

- Do NOT commit API keys or other secrets to the repository. Use Vercel environment variables or another secrets store.
- System prompt and knowledge content control the assistant heavily. When updating prompt text, validate behavior with a few test queries — especially anything touching pricing, given the guardrail's exact-match nature.

---