# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev                 # vercel dev — serves public/ + api/ on :3000
npm test                    # node --test (whole suite)
npm run test:consistency    # just test/consistency.test.js
node --test --test-name-pattern="worked example 1"   # single test by name
node --check api/chat.js    # syntax-only check (what CI runs across every .js)
```

There is no build step, no linter, and no test framework beyond `node:test` + `node:assert/strict`. Node 20.x only (`engines`), matching Vercel's runtime.

CI (`.github/workflows/ci.yml`) runs three things: `node --check` on every `.js` in the repo, `npm test`, then `import()` of each `api/*.js` entrypoint — that last step exists to catch a package used in code but missing from `package.json`, which the first two pass cleanly.

## Architecture

A Vercel serverless app with **no database and no server-side session state**. The browser widget (`public/index.html`) holds the entire conversation in a JS array and replays `{ message, history }` on every request. Every server-side fact — which knowledge to load, what the cabinetry estimate is, whether to offer a deposit, what amount to charge — is re-derived from that pair on each call. Nothing is remembered between invocations, and nothing computed client-side is ever trusted.

### The central design principle: verify in code, never trust the model

Prices and product claims are enforced by server code, not by prompt wording. Three layers, all in `api/chat.js`:

1. **Pre-compute and inject.** `buildCabinetryEstimateBlock()` runs the real pricing formula and injects the finished line items into the system prompt, instructing the model to relay the exact figures. The model never does arithmetic.
2. **Guardrail on the way out.** `findHallucinatedPrices()` extracts every `RM` figure from the reply and checks it against `MASTER_PRICE_LIST` (built at module load by calling *every* knowledge function, not just the ones routed into this turn), plus amounts the customer stated themselves, plus live cabinetry figures from `computeCabinetryAllowedAmounts()`. `PRICE_TOLERANCE = 2.00` forgives cent-level rounding. An unrecognized price triggers **one regeneration**, then falls back to `SAFE_FALLBACK_REPLY`.
3. **Regex backstops for prompt rules.** `stripImageDisclaimers()` deletes sentences where the model claims it can't show a photo — because a real photo may already be attached alongside the text.

When adding a rule the model must follow, assume it will occasionally ignore it and add the code-level check too. Existing code comments call this out explicitly and name the incidents that motivated each guard ("the Glint Table incident", etc.) — read them before changing that logic.

### Request flow (`POST /api/chat`)

`getRelevantKnowledge()` → `buildSystemPrompt()` → `callGeminiWithFallback()` → price guardrail (+ one retry) → `stripImageDisclaimers()` → `getRelevantImages()` → `computeDepositOffer()` → `{ success, message, images, deposit }`.

Gemini is reached through its **OpenAI-compatible** chat-completions endpoint, so request/response shapes are standard OpenAI. `GEMINI_API_KEY_2` is a fallback key, tried only on network errors / 429 / 5xx — a 400/401/403 fails fast since a second key would fail identically. `temperature`/`top_p` are deliberately omitted (not recommended for Gemini 3.x); `max_completion_tokens: 3000` with `reasoning_effort: 'low'` because thinking and visible output share one budget and a small cap silently truncates replies (`finish_reason: 'length'` is logged for this).

### Knowledge routing

`KNOWLEDGE_MODULES` in `api/chat.js` is an ordered registry of `{ key, test: /regex/, fn }`. Modules matching the **current message** rank above ones matching only recent history; the top `MAX_KNOWLEDGE_MODULES` (3) are selected. `basicFurniture` is force-included alongside any of `BASIC_FURNITURE_COMPANION_KEYS` and is deliberately **not** counted against that cap — dropping it reintroduces a known bug where the bot denies a real product exists while its photo is attached. Array order is the tiebreak, so it matters.

`knowledge/*.js` files export a `get*Knowledge()` returning a plain prompt-text string. Adding one means: create the module, register it in `KNOWLEDGE_MODULES`, add it to the `MASTER_PRICE_LIST` array (otherwise its prices get flagged as hallucinations), and add it to the sanity-check list in `test/consistency.test.js`.

### Single sources of truth (and the drift tests)

Several structured tables exist specifically so prose and code can't disagree:

- `WALLBED_MODEL_WIDTHS_FT` — width lookup, coarse (Queen variants share a width).
- `WALLBED_MODEL_PRICING` — price lookup, granular (Queen vs. Queen Sofa differ by ~RM9k). Bare patterns use negative lookaheads so match order is irrelevant.
- `PRODUCT_IMAGES` — order **does** matter here; specific variants must precede the generic patterns that would also match them.
- `WALLBED_MODEL_HEIGHTS_FT` — per-model height lookup, granular like the pricing table and **not** like the width table. All Gioco variants share one width, so a single coarse `Gioco` entry is right there; their heights range from 3.44ft to 6.92ft, so it is wrong here. Carries `heightCm` alongside `heightFt` purely so a test can check both against the prose.
- `SIDE_CABINET_MAX_HEIGHT_FT` (7) is the Murano side-cabinet height. It is **not** the same fact as `MURANO_MIN_CEILING_FT` (2.4m ≈ 7.87ft) in `api/chat.js` — those were aliased once, which quietly under-enforced the ceiling rule, and they are deliberately independent now.

`test/consistency.test.js` is **not** a general unit-test suite — it exists to catch drift between things that must agree: prompt-hardcoded prices vs. `WALLBED_MODEL_PRICING`, worked examples in `knowledge/cabinetry.js` comments vs. what `calculateCabinetPrice()` actually returns, pricing table vs. width table, every priced model vs. `PRODUCT_IMAGES` coverage. Editing a price, a formula constant, or a prompt figure without updating its counterpart will fail here — that's the point.

`api/chat.js` has an explicit **test-only named-export block** (`export { getRelevantKnowledge, ... }`) so internals can be tested without mocking the Gemini HTTP call. Add to it when you need a new function under test.

### Cabinetry estimate extraction

`extractCabinetryDimensions()` is best-effort regex parsing over the last ~10 turns, and it is **turn-aware**: the prompt asks for measurements one at a time, so customers reply with bare numbers ("9ft") carrying no context — the function reads the *assistant's preceding message* to decide whether that number is a height or a total width. Feet and metric are both accepted and converted immediately via `convertToFeet()`, so the formula and its worked examples stay in feet. Wall-bed width is never asked from the customer; the model name is detected from **either role's** turns (the assistant usually names it) and the width/price looked up. If extraction fails, the strict guardrail applies — the safe default is that no extra amounts get allowed.

`getCabinetryEstimateFromContext()` is the single computation both the prompt block and the deposit offer read from, so they can never disagree. It returns three distinct shapes: `null` (still missing info — keep asking), `{ blocked: true, reason: 'WALL_TOO_SHORT_FOR_CABINETRY' }` (surface immediately, never price it), or a full estimate.

**Side-cabinet height is per wall bed model**, via `resolveSideCabinetHeightFt()` in `knowledge/cabinetry.js`. Murano keeps the flat `SIDE_CABINET_MAX_HEIGHT_FT` (7ft — a build constant, slightly proud of the 209.5ft bed). Each Gioco uses its own height, because the horizontal-fold series mounts far shorter and is *not* uniform within itself: Single and Single Desk 3.44ft, Queen 5.58ft, Bunk Bed 6.92ft. Resolve it off the **granular pricing table**, never the width table — the latter labels every Gioco variant just `Gioco` and cannot tell a 3.44ft Single from a 6.92ft Bunk Bed. An unresolvable model falls back to the flat 7ft, which is the conservative pre-change behaviour.

Two consequences of that, both easy to get wrong:

- **The minimum wall height is per-model too.** Gating `WALL_TOO_SHORT_FOR_CABINETRY` on the flat 7ft rejected walls that comfortably fit a short Gioco — a 5ft wall is fine for a 3.44ft Gioco Single. Both `calculateCabinetPrice()` and the `chat.js` pre-check compare against the resolved height.
- **None of this moves a price.** The formula is width-driven (`leftoverWidth × RM1,350 × sides` + `totalWidth × RM850`); height only sets build heights and that minimum. A short Gioco under a normal ceiling leaves bare wall above the stack — reported as `uncoveredWallHeightFt` — because the overhead cabinet stops at its 4ft cap rather than stretching. That gap is deliberately free; there is no excess-height surcharge anywhere in this codebase, and the prose says so in several places.

### Deposit flow

`getDepositBasisFromContext()` is the **single** definition of whether a deposit is payable and on what amount. Both the chat response's offer (`computeDepositOffer()`) and the actual Stripe charge (`api/create-deposit.js`) call it and nothing else — that's what stops the quoted and charged amounts from diverging. It returns `null` or `{ type, wallBedModelLabel, total, heightFt, totalWidthFt }`.

Two paths, in priority order:

1. **`wallbed_with_cabinetry`** — the combined grand total. Gating mirrors `buildCabinetryEstimateBlock()` exactly (same price-intent check, same non-blocked-full-`grandTotal` requirement), so the button can't appear ahead of or instead of the price text. Keep those two in lockstep.
2. **`wallbed_only`** — the model's sale price alone. Gated on `hasCabinetryIntent()` being **false**, not merely on the cabinetry estimate being absent: mid-cabinetry-flow the estimate is legitimately missing while measurements are collected, and falling through there would offer payment for less than the quote being assembled.

`hasCabinetryIntent()` is deliberately **broader** than the cabinetry routing regex in `KNOWLEDGE_MODULES`, and deliberately does not reuse it. That regex is narrow so a generic "cabinet" can't claim a knowledge slot, and it misses ordinary phrasings like "a Murano Queen with cabinets". Here the error costs invert — over-matching only costs an unoffered deposit, under-matching offers the wrong payment — so the two patterns stay separate.

Both paths refuse a deposit when `detectMuranoCeilingConflict()` fires: never take money for a bed that can't be installed at the stated ceiling. Note the cabinetry flow only blocks walls under the *side-cabinet* minimum for that model, which is a different — and for every model except Bunk Bed, lower — threshold than Murano's 2.4m.

The `type` on the returned basis drives three things: the widget's deposit-card label, the Stripe line-item name (a wall-bed-only deposit must not say "+ Cabinetry"), and the Sheet's Cabinets column via `depositIncludesCabinets()`.

`api/create-deposit.js` imports `getDepositBasisFromContext` and `DEPOSIT_PERCENT` **from `api/chat.js`** (one serverless entrypoint importing another) and re-derives the total from the replayed conversation. The client sends only `{ message, history }` — never an amount. The model is barred from writing payment links at all; the widget renders the button from the structured `deposit` field.

`api/stripe-webhook.js` sets `export const config = { api: { bodyParser: false } }` — Stripe's signature check needs the exact raw bytes, and re-serializing parsed JSON breaks it. It handles `checkout.session.completed` (not the success redirect, which a customer can skip by closing the tab), and returns 200 for every event type so Stripe doesn't retry ones we intentionally ignore. `notifyCompany()` (Resend) and `logDepositToSheet()` both swallow their own errors — a notification failure must never turn into a 500 and cause Stripe to retry an already-processed event.

`lib/sheetsLogger.js` hand-signs a service-account JWT with `node:crypto` rather than adding `googleapis`. Both it and the Resend call use raw `fetch` with no SDK — `stripe` is the project's only runtime dependency, and it's worth keeping it that way. It has its own test-only export block (`base64url`, `normalizePrivateKey`, `getAccessToken`) for the same reason `api/chat.js` does; its tests stub `globalThis.fetch` and generate a throwaway RSA key pair, so they need no credentials and make no network calls. `normalizePrivateKey()` exists because Vercel's env var UI stores multi-line values with literal `\n` escapes that `createSign()` rejects — the usual cause of Sheets logging working locally but failing in production.

### The Sheet row shape

`logDepositToSheet()` appends one row per confirmed deposit into a fixed range. Column order is a **stored data format** — rows already in the Sheet are written this way, so add new columns at the *end* and widen the range to match. The Sheets API silently truncates a row longer than its range rather than erroring, so a mismatch loses data quietly.

| A | B | C | D | E | F | G | H | I | J | K |
|---|---|---|---|---|---|---|---|---|---|---|
| Timestamp | Quote Ref | Wall Bed Model | Grand Total | Deposit % | Deposit Paid | Customer Email | Customer Name | Customer Phone | Stripe Session ID | Cabinets |

Range: `<tab>!A:K`. The same table (with per-column value notes) is in [GOOGLE_SHEETS_CREDENTIALS.md](GOOGLE_SHEETS_CREDENTIALS.md), since that's what you follow when creating the sheet's header row — keep both in sync.

**Columns G–I come from Stripe, not the widget.** `api/create-deposit.js` sets `phone_number_collection: { enabled: true }` and `billing_address_collection: 'required'` on the Checkout Session; the webhook reads them back off `session.customer_details`. Stripe has no standalone "collect name" switch — `customer_details.name` is filled from the billing-details form, which is why address collection is required rather than relying on the card form's cardholder-name field. That field doesn't exist for FPX, a payment method this session accepts, so the name would silently be blank for those customers otherwise. Any of G–I can still be blank if Stripe captured nothing.

**Cabinets** is `Yes` / `No` — whether the deposit covers a wall bed with surround cabinetry or the bed alone.

That value is derived, never tracked separately: `depositIncludesCabinets()` in `api/chat.js` maps the deposit type to Yes/No, `api/create-deposit.js` writes it into Stripe session metadata as `cabinets`, and the webhook reads it back. An **unrecognised type returns `''`** on purpose — a future third deposit type must not be silently recorded as "No", since a confident wrong answer in a business record is worse than a blank cell that visibly needs attention. The mapping lives in `chat.js` rather than `create-deposit.js` so it's testable without the `stripe` dependency.

Sessions created before the `cabinets` field existed log an empty cell rather than being guessed at. `test/consistency.test.js` pins the column order, the row width against the range, and the Yes/No mapping.

Adding a column: append at the **end** and widen the range in the same edit. The contact fields (H, I) were inserted mid-row instead, which moved Stripe Session ID from H to J — any row written before that change is misaligned from column H onward. That was acceptable only because the integration hadn't logged anything yet; assume it isn't next time.

### Google service-account credentials

The Cloud project, service account, and Sheets API enablement backing `lib/sheetsLogger.js` live under **`mocof.chatbot@gmail.com`** — a Google account owned by MOCOF as a business, not by any individual developer.

Two reasons, both load-bearing:

- **Org policy.** Google Cloud organizations (including most Workspace domains created in recent years) enforce `iam.disableServiceAccountKeyCreation` by default, which blocks the downloadable JSON key this integration authenticates with. Working around it needs org-level permissions a project developer generally won't have. A standalone account with no Workspace/Cloud org attached isn't subject to the policy at all — that's the mechanism this relies on.
- **Continuity.** Credentials held in a developer's personal account make that person a single point of failure and an access problem the day they leave, which for an intern or contractor is a certainty rather than a risk. Business ownership means the key can be rotated or handed over without them.

The destination Sheet does **not** need to live under this account — it's shared with the service account's email like any external collaborator, so it can stay in MOCOF's real Drive/Workspace. Only the service account itself has to sit under the dedicated account.

Full reasoning, setup steps, and the Workspace-centralization alternative are in [GOOGLE_SHEETS_CREDENTIALS.md](GOOGLE_SHEETS_CREDENTIALS.md) — don't duplicate them here.

### Widget

`public/index.html` is a single self-contained file (no build, no framework, ES5-style `var`/`function`). Two things to know:

- **`API_URL` and `CREATE_DEPOSIT_URL` are hardcoded to the production deployment.** Running `npm run dev` serves the widget locally but it still calls production `/api/chat`. Edit those constants to hit a local backend.
- `fmt()` is a hand-rolled Markdown subset renderer supporting **only** bold, numbered lists, bullet lists, and tables. The system prompt's FORMATTING RULES section enumerates exactly this set — headers, links, italics, and code blocks render as literal characters. Changing one without the other breaks output.

### Routing and static files — `vercel.json`

**Vercel flattens `public/` to the site root.** With no framework detected, `public/deposit-success.html` is served at `/deposit-success.html`, *not* `/public/deposit-success.html` — that path does not exist in the deployed output at all.

This is a live trap. The rewrites in [vercel.json](vercel.json) deliberately have **no `/public` prefix**, and they look wrong if you assume the destination mirrors the repo layout. They don't. Restoring the `/public/...` prefixes reintroduces a 404 on the Stripe post-payment redirect, which is exactly the bug they were written to fix. The same applies to the headers block: scoping it to `/public/(.*)` matches nothing, silently dropping the iframe-embedding headers.

Two consequences worth knowing when this breaks:

- The 404 only shows up *after* a completed payment, so it fails at the least testable moment.
- A Stripe Checkout session bakes its `success_url` in at creation time — sessions created while the config was broken keep the bad URL and can't be fixed retroactively. Verify with a fresh checkout, not a stale link.

`vercel.json` also sets permissive frame headers (`X-Frame-Options: ALLOWALL`, `frame-ancestors *`) on all non-API routes because the widget is embedded via iframe on the MOCOF storefront.

## Environment variables

Required: `GEMINI_API_KEY`. Optional: `GEMINI_API_KEY_2`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`, `EMAIL_API_KEY`, `COMPANY_NOTIFY_EMAIL`, `EMAIL_FROM_ADDRESS`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`, `GOOGLE_SHEETS_TAB_NAME`. Every optional integration no-ops (and logs) when its vars are unset, so partial configuration is a supported state, not a failure.
