---
name: mocof-chatbot
description: Use for any work on the MOCOF chatbot repository — bug fixes, new features, refactors, debugging a customer-facing issue, changes to knowledge content or pricing logic, the cabinetry formula, the Stripe deposit flow, the widget (public/index.html), routing/embedding, or Vercel deployment config. This is the general project skill covering the whole codebase, not one narrow subsystem.
---

# Working on the MOCOF chatbot

## What this project is

A Vercel serverless chatbot for MOCOF (Malaysian furniture/wall-bed retailer). No
database, no server-side session state. The browser widget (`public/index.html`) holds
the entire conversation client-side and replays `{ message, history }` on every request.
Every server-side fact — which knowledge to load, what a cabinetry estimate is, whether
to offer a deposit, what to actually charge — is re-derived from that pair on each call.
It has grown from a plain product-Q&A bot into one that also computes live price
estimates and takes real Stripe deposit payments, so parts of this codebase now handle
real money, not just conversation text.

## Commands

\`\`\`bash
npm install
npm run dev                 # vercel dev — serves public/ + api/ on :3000
npm test                    # node --test (whole suite)
npm run test:consistency    # just test/consistency.test.js
node --test --test-name-pattern="worked example 1"   # single test by name
node --check api/chat.js    # syntax-only check (what CI runs across every .js)
\`\`\`

No build step, no linter, no test framework beyond `node:test` + `node:assert/strict`.
Node 20.x only, matching Vercel's runtime. CI (`.github/workflows/ci.yml`) runs
`node --check` on every `.js` file, `npm test`, then `import()`s each `api/*.js`
entrypoint — that last step exists specifically to catch a package used in code but
missing from `package.json`.

## The rule everything else follows from

**Nothing customer-facing is trusted just because the model said it.** This shows up
everywhere in this codebase:

- Prices are checked against server-computed truth before a reply ships
  (`findHallucinatedPrices()` in `api/chat.js`), not enforced by prompt wording alone.
- Formulas run in JavaScript (`knowledge/cabinetry.js`'s `calculateCabinetPrice()`), never
  in the model's head — the system prompt gets a pre-computed block to relay, not raw
  numbers to calculate from.
- Payment amounts are re-derived server-side at the moment of charge
  (`api/create-deposit.js` re-runs the same estimate function independently), never
  trusted from an earlier turn or anything the client sends.

When adding a new rule for the model to follow, ask "what happens the one time it
ignores this instruction?" — if the answer is "a customer sees something wrong," that
rule needs a code-level check, not just a prompt sentence. Existing comments in
`api/chat.js` name the real incidents that motivated each guard — read them before
changing that logic, and see "Known incidents" below for the fuller list.

## Architecture

**Request flow (`POST /api/chat`):** `getRelevantKnowledge()` → `buildSystemPrompt()` →
`callGeminiWithFallback()` → price guardrail (+ one retry) → `stripImageDisclaimers()` →
`getRelevantImages()` → `computeDepositOffer()` → `{ success, message, images, deposit }`.

Gemini is reached through its OpenAI-compatible chat-completions endpoint.
`GEMINI_API_KEY_2` is a fallback, tried only on network errors / 429 / 5xx (a 400/401/403
fails fast — a second key would fail identically). `temperature`/`top_p` are deliberately
omitted (not recommended for Gemini 3.x). `max_completion_tokens` and `reasoning_effort`
matter more than they look: Gemini 3.x's thinking tokens and visible-output tokens share
one budget, so too small a cap silently truncates replies mid-answer with no error other
than a logged `finish_reason: 'length'`.

**Knowledge routing:** `KNOWLEDGE_MODULES` in `api/chat.js` is an ordered registry of
`{ key, test: /regex/, fn }`. Matches against the *current message* rank above matches
that only appear in recent history; the top `MAX_KNOWLEDGE_MODULES` are selected —
array order is the tiebreak. `basicFurniture` is force-included alongside
`BASIC_FURNITURE_COMPANION_KEYS` and isn't counted against the cap. Each
`knowledge/*.js` module exports `get<Topic>Knowledge()` returning plain prompt text.

**Single sources of truth:** `WALLBED_MODEL_WIDTHS_FT` (width lookup, coarse),
`WALLBED_MODEL_PRICING` (price lookup, granular — Queen vs. Queen Sofa differ by
~RM9k), `PRODUCT_IMAGES` (order matters — specific variants before generic patterns).
`test/consistency.test.js` exists specifically to catch drift between these tables, the
prompt's hardcoded figures, and the knowledge prose — not as a general unit-test suite.

**Cabinetry estimate extraction:** `extractCabinetryDimensions()` is best-effort,
turn-aware regex parsing — the prompt asks for measurements one at a time, so customers
reply with bare numbers ("9ft") carrying no context of their own, and the function reads
the assistant's *preceding* message to decide what a bare number means. Both feet and
metric are accepted and converted via `convertToFeet()`. Wall bed width is never asked
from the customer — the model name is detected from either role's turns (the assistant
usually names it) and its width/price looked up. `getCabinetryEstimateFromContext()` is
the single computation both the prompt block and the deposit offer read from, returning
either `null` (still missing info), `{ blocked: true, reason: ... }`, or a full estimate.

**Deposit flow:** `computeDepositOffer()` mirrors the price-block's gating exactly — the
"Pay Deposit" button must never appear ahead of or instead of the price text itself.
`api/create-deposit.js` imports straight from `api/chat.js` and re-derives the total from
the replayed conversation; the client sends only `{ message, history }`, never an amount.
`api/stripe-webhook.js` disables Vercel's default body parser (`bodyParser: false`) since
signature verification needs the exact raw bytes — re-serializing parsed JSON breaks it.
It listens for `checkout.session.completed` specifically (not the success-page redirect,
which a customer can skip by closing the tab) and returns 200 for every event type so
Stripe doesn't retry ones it intentionally ignores. Notification email (Resend) and
`lib/sheetsLogger.js` both swallow their own errors — a failure in either must never
become a 500 that makes Stripe retry an already-processed event. `sheetsLogger.js`
hand-signs a Google service-account JWT with `node:crypto` rather than adding a
dependency; `stripe` is this project's only runtime dependency, worth keeping that way.

**Widget (`public/index.html`):** single self-contained file, no build, no framework,
ES5-style. `API_URL` and `CREATE_DEPOSIT_URL` are hardcoded to the production
deployment — `npm run dev` still calls production `/api/chat` unless you edit those.
`fmt()` is a hand-rolled Markdown subset (bold, numbered/bullet lists, tables only) —
the system prompt's formatting rules enumerate exactly this set; changing one without
the other breaks rendering. The widget is meant to be embedded via `<iframe>` on the
MOCOF Wix storefront — it posts its open/closed state via `postMessage` so an embedder
can resize its iframe wrapper instead of permanently reserving a large click-blocking box
(this matters most on mobile, where the popup goes near-full-screen).

**Deployment (`vercel.json`):** Vercel flattens `public/` to the site root — rewrites and
headers deliberately have **no `/public/` prefix**. Adding one back looks like a fix and
isn't — it silently matches nothing (a rewrite 404s, a header rule stops applying). This
has a nasty failure profile: it only surfaces on the post-payment Stripe redirect, and a
Checkout session's `success_url` is baked in at creation time, so a session created while
this was broken can't be fixed retroactively. Verify any `vercel.json` change with a
fresh end-to-end request, not by reasoning about what path it "should" produce.
Permissive frame headers (`X-Frame-Options: ALLOWALL`, `frame-ancestors *`) are
intentional — the widget is iframed on an external site.

## Checklist: adding or editing knowledge content

1. Export `get<Topic>Knowledge()` returning a prompt-text string.
2. Register it in `KNOWLEDGE_MODULES` — array order is the tiebreak, place it deliberately.
3. Add its function call to the `MASTER_PRICE_LIST` build list. Skip this and every real
   price in it gets flagged as a hallucination the first time a customer asks — silently,
   with no error, just a reply that's oddly evasive about a number it should have stated.
4. Add it to the knowledge-module sanity checks in `test/consistency.test.js`.
5. `npm test`.

## Checklist: changing a price, a formula, or a constant

1. Change it in code.
2. Update every worked example and hardcoded figure in the corresponding knowledge
   prose — the model reads that text directly; stale prose becomes a stale, now
   guardrail-blocked, answer.
3. Update or add a `test/consistency.test.js` case that would fail if the two drift again.
4. `npm run test:consistency`.
5. If it touches `knowledge/cabinetry.js` or anything `getCabinetryEstimateFromContext()`
   reaches, also check `api/create-deposit.js` — a formula change not reflected there
   means the chat quote and the actual Stripe charge can disagree.

## Before considering any change done

- `npm test` — the whole suite, not just the file that seems relevant; the consistency
  tests exist to catch cross-file drift that doesn't show up reading one file in isolation.
- `node --check` on every touched file.
- Touched `vercel.json`? Re-read the deployment section above before adding any
  `/public/` prefix back in.
- Touched anything payment-related? Confirm the charged amount is re-derived
  server-side at charge time, not passed through from an earlier turn or the client.

## Known incidents (don't reintroduce these)

- **Hallucinated a nonexistent product** ("Gioco Queen Sofa") by pattern-matching a real
  naming convention from a different series. Fixed by the guardrail architecture, not a
  prompt tweak.
- **Denied a real product existed** one turn after correctly describing it, because
  knowledge routing only looked at the current message, so the relevant module dropped
  out of context. Routing checks recent history now — don't narrow that back to
  message-only matching.
- **A documented parameter (`sides: 1` for corner installations) was quietly dropped**
  during an unrelated extraction-logic refactor, with nothing testing that it actually
  reached the formula call. Add a parameter, add a test that changing it changes output.
- **A ceiling-height constant was aliased to an unrelated cabinet-carpentry constant**
  because the values were numerically close (7ft vs. the real 2.4m ≈ 7.87ft), under a
  "single source of truth" rationale — they were never the same fact. Numerically similar
  right now isn't the same as logically the same thing.
- **`max_completion_tokens` set lower than the model's own thinking budget** silently
  truncated replies mid-answer. If the model or its reasoning effort changes, re-check
  this against the provider's current thinking-budget documentation.
- **`vercel.json` paths mirroring the repo layout (`/public/...`) silently matched
  nothing** post-deployment — see the deployment section above.
- **The widget was embedded on the live Wix site via more than one Custom Code entry**
  simultaneously, producing a duplicate chat bubble rendered inline in page content. Not
  a bug in this repo, but worth ruling out first if "something's duplicated on the live
  site" comes up.

## When you're not sure a change is safe

Run `npm run test:consistency` and read what it actually asserts before writing code to
satisfy it. These tests encode real business facts — a specific ceiling requirement, a
specific price, a specific formula constant — not arbitrary expectations. If a test and
your change disagree, that's usually the test telling you something true about the
business, not a test that needs updating to match the change.