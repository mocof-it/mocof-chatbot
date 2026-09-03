// =============================================================
// FILE: api/chat.js
// Vercel Serverless Function — handles all Gemini API calls
// Endpoint: POST /api/chat
// API Keys: GEMINI_API_KEY (primary) + GEMINI_API_KEY_2 (fallback) in Vercel env vars
// =============================================================

import { getRenovationKnowledge } from '../knowledge/renovation.js';
import { getWallBedKnowledge, WALLBED_MODEL_WIDTHS_FT, WALLBED_MODEL_PRICING } from '../knowledge/wallbeds.js';
import { getSofaBedKnowledge } from '../knowledge/sofabeds.js';
import { getTableKnowledge } from '../knowledge/tables.js';
import { getKitchenKnowledge } from '../knowledge/kitchen.js';
import { getWardrobeKnowledge } from '../knowledge/wardrobes.js';
import { getShowroomKnowledge } from '../knowledge/showroom.js';
import { getWarrantyKnowledge } from '../knowledge/warranty.js';
import { getBasicFurnitureKnowledge } from '../knowledge/basicfurniture.js';
import { getBedsheetKnowledge } from '../knowledge/bedsheets.js';
import { getCabinetryKnowledge, calculateCabinetPrice, SIDE_CABINET_MAX_HEIGHT_FT, resolveSideCabinetHeightFt } from '../knowledge/cabinetry.js';
import { getRelevantImages } from '../knowledge/productImages.js';

// Gemini's OpenAI-compatible endpoint -- same request/response shape as the
// Groq endpoint this replaced, so the rest of this file barely had to change.
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = 'gemini-3.5-flash-lite';

// ── Detect which knowledge bases are relevant ─────────────────
// IMPORTANT: this looks at the last few turns of history too, not just the
// current message. Otherwise a natural follow-up like "what is X?" (where X
// was named by the bot one turn ago) loses all context, because the message
// itself may contain none of the trigger keywords for that knowledge file —
// causing the bot to wrongly claim a real product doesn't exist.
// Ordered by priority when a message matches more than MAX_KNOWLEDGE_MODULES
// categories at once — cabinetry comes first because it's needed for accurate
// live price quoting, wall beds second as the flagship product line.
const KNOWLEDGE_MODULES = [
    {
        key: 'cabinetry',
        // Surround cabinetry — side/overhead cabinets built AROUND a wall bed.
        // Distinct from the general "cabinet" keyword in wardrobe/kitchen below,
        // which covers free-standing kitchen/wardrobe cabinetry.
        test: /side cabinet|overhead cabinet|surround cabinet|cabinet(ry)? around|cabinet(s|ry)? (on|beside|next to|for) (the |my )?(wall ?bed|bed)|wall ?bed.*cabinet|extra cabinet|estimate.*cabinet|cabinet.*(price|cost|quote|estimate)/,
        fn: getCabinetryKnowledge
    },
    { key: 'wallbed', test: /wall bed|wallbed|murphy bed|fold|gioco|murano|single bed|queen bed|ceiling/, fn: getWallBedKnowledge },
    { key: 'sofabed', test: /sofa bed|sofabed|sofa|living room|couch|ottoman|orzo|kivo|hori/, fn: getSofaBedKnowledge },
    { key: 'table', test: /table|dining|desk|study/, fn: getTableKnowledge },
    { key: 'kitchen', test: /kitchen|cabinet|cabinetry|cooking|pantry/, fn: getKitchenKnowledge },
    { key: 'wardrobe', test: /wardrobe|closet|clothes|storage|walk-in|cabinet/, fn: getWardrobeKnowledge },
    { key: 'bedsheet', test: /bedsheet|bed sheet|bedding|duvet|quilt|comforter|pillow|bolster|cushion|towel|bath mat|tencel|egyptian cotton|pure cotton|signoria|fitted sheet|flat ?sheet|thread count|mattress protector/, fn: getBedsheetKnowledge },
    { key: 'showroom', test: /showroom|visit|location|address|trx|maison|appointment|open|hour/, fn: getShowroomKnowledge },
    { key: 'warranty', test: /warranty|guarantee|claim|repair|after.?sales|defect/, fn: getWarrantyKnowledge },
    { key: 'renovation', test: /renovation|interior|design|house|condo|budget|layout|floor plan|material|panel|laminate|formaldehyde|\bENF\b|finish(es|ing)?|champagne luxe|walnut cocoa|glacier mirror/i, fn: getRenovationKnowledge },
    {
        key: 'basicFurniture',
        // NOTE: this list must stay in sync with the model names actually named
        // in basicfurniture.js -- a name missing here means the model gets ZERO
        // information about that product (even though a real photo can still be
        // attached separately via productImages.js), which is what caused the
        // "Glint Table" incident: the customer got a real photo but the model's
        // text wrongly claimed no knowledge of the product at all.
        test: /sofa|couch|coffee table|dining|recliner|bed frame|basic furniture|cheaper|budget|alternative|arto|erga|euclio|forge|anta|arvo|hara|lyco|theta|zenith|crorix|flare|dream|colony|celestia|zenon|marlie|nebula|neva|perch|solaris|orbit|casa|pluto|moria|cozelle|lumina|drion|canis|zeta|birch|riza|maven|zorra|varo|draco|olola|sade|nix|dock|zovo|pebble|nebulatte|librae|hush|holo|vine|vellum|modo|etho|nexo|tetra|jolly|solis|zen|chair|stool|trolley|vion|lurn|prova|brilla|elzia|grano|valor|rootsy|roosty|pallio|proxima|venus|sone|bella|melba|solara|primo|thora|resili|eclipse|clover|eden|liro|velvia|petrus|heem|shelf|axil|andro|loom|feilo|vale|claria|mesa|rove|levo|mira|letho|moza|nook|avo|orion|stellar|crolla|lambda|apus|elevatia|glint|kivo|velvet|starry|lars|buzz/,
        fn: getBasicFurnitureKnowledge
    }
];

// Keeps the system prompt bounded regardless of provider or tier -- a normal
// multi-need message ("renovating my kitchen, need a wardrobe, wall bed,
// dining table...") can touch 6+ categories, which would otherwise balloon a
// single request. This was originally sized around Groq's 8,000 TPM cap;
// Gemini's free tier is generous on TPM but tight on RPM/RPD instead (a
// request-count limit, not a token-volume one), so this cap still helps
// keep replies fast and cheap even though it isn't solving the same problem
// it was written for.
const MAX_KNOWLEDGE_MODULES = 3;

// basicfurniture.js contains the cheaper/ready-made counterpart for each of
// these categories (Basic Sofa, Basic Dining Table, Basic Study Table, Basic
// Wardrobe references, etc). The basicFurniture regex can't realistically
// enumerate every generic word ("table", "desk", "study", "chair"...) that
// should pull it in, and even when it does match it can still get crowded
// out of the top MAX_KNOWLEDGE_MODULES slots since it's last in the array
// (see the "Glint Table incident" note above). So instead of relying on
// keyword luck or array order, whenever one of these companion categories is
// relevant, basicFurniture is always included alongside it — this is what
// makes "is there a cheaper alternative" work for ANY product category, not
// just the ones that happen to also contain the literal word "cheaper".
const BASIC_FURNITURE_COMPANION_KEYS = ['wallbed', 'sofabed', 'table', 'kitchen', 'wardrobe'];

function getRelevantKnowledge(message, history) {
    const recentHistoryText = Array.isArray(history)
        ? history.slice(-4).map(m => (m && m.content) ? m.content : '').join(' ')
        : '';
    const msgOnly = (message || '').toLowerCase();
    const combined = `${recentHistoryText} ${message}`.toLowerCase();

    // What the CURRENT message is about takes priority over something that only
    // matched because it appeared a few turns back in history — that context is
    // still checked (so a bare "what is X?" follow-up still works), just ranked lower.
    const matchedInMessage = KNOWLEDGE_MODULES.filter(m => msgOnly.match(m.test));
    const matchedFromHistoryOnly = KNOWLEDGE_MODULES.filter(m =>
        !matchedInMessage.includes(m) && combined.match(m.test)
    );
    const prioritized = [...matchedInMessage, ...matchedFromHistoryOnly];

    // Fallback — if nothing matched, send a light default
    if (prioritized.length === 0) {
        return getWallBedKnowledge() + getShowroomKnowledge();
    }

    let selected = prioritized.slice(0, MAX_KNOWLEDGE_MODULES);

    // Guarantee basicFurniture rides along with any companion category, even
    // if it didn't match a keyword itself or got pushed past the cap above —
    // this is deliberately NOT counted against MAX_KNOWLEDGE_MODULES, since
    // dropping it silently reintroduces the exact bug this fix addresses.
    const basicFurnitureModule = KNOWLEDGE_MODULES.find(m => m.key === 'basicFurniture');
    const touchesCompanionCategory = prioritized.some(m => BASIC_FURNITURE_COMPANION_KEYS.includes(m.key));
    if (touchesCompanionCategory && basicFurnitureModule && !selected.includes(basicFurnitureModule)) {
        selected = [...selected, basicFurnitureModule];
    }

    return selected.map(m => m.fn()).join('');
}

// ── Build system prompt ───────────────────────────────────────
function buildSystemPrompt(message, history) {
    return `You are Moco, a friendly and professional AI consultant for MOCOF — a premium Malaysian furniture and interior design brand specialising in space-saving solutions.

PERSONALITY:
- Warm, professional, and concise
- Always guide customers toward the right product
- Ask follow-up questions to understand needs
- Suggest showroom visits for serious buyers

WHATSAPP CONTACT:
- For product inquiries: +60 12-568 4568
- For renovation inquiries: +60 12-475 4568
- When customer mentions renovation budget or design preferences, use the renovation WhatsApp number (+60 12-475 4568).
- ONLY append WhatsApp contact when the customer explicitly mentions their BUDGET or DESIGN PREFERENCES specifically in the context of renovation (e.g. "my budget is RM 50k", "I want a Scandinavian style", "how much would a full renovation cost", "what design do you suggest for my condo renovation").
- Do NOT include the WhatsApp number or that message in any other responses — not for general product questions, showroom visits, warranty, delivery, pricing enquiries, or any other topic unless renovation budget or renovation design is the clear subject.

PRICING RULES:
- You CAN share the listed retail and sale prices from the knowledge base
- Always present both: "Retail: RM X | Sale: RM X"
- For custom items (walk-in wardrobes, kitchen cabinetry, full renovation): say "Pricing is personalised — contact us on WhatsApp at +60 12-568 4568 for a quote"
- NEVER fabricate prices not in the knowledge base

YOUR KNOWLEDGE BASE:
${getRelevantKnowledge(message, history)}

PRODUCT RECOMMENDATION RULES:
- Study room → Gioco Single with Desk (RM 17,538.11 sale)
- Living room → Murano Queen with Sofa (RM 23,698.11 sale)
- Low ceiling below 2.4m (~7.9ft) → Gioco Series is the ONLY option
- Standard ceiling 2.4m and above (~7.9ft+) → Murano Series
- Murano REQUIRES a 2.4m+ / ~7.9ft+ ceiling — this is not just a suggestion, Murano is not installable below that. If a customer states or implies a ceiling under 2.4m/~7.9ft, do NOT recommend or confirm any Murano model — recommend the equivalent Gioco model instead and say plainly why. Note this is NOT the same as the separate 7ft minimum for surround cabinetry below — a ceiling can be tall enough for cabinetry yet still too short for a Murano.
- Always ask ceiling height AND room purpose before recommending wall beds
- If the integrated Sofa variant is out of budget, recommend the BUDGET WALL BED + SEPARATE SOFA COMBO from the knowledge base (a plain wall bed plus a standalone Basic Sofa) instead of inventing a discount — this is a real, cheaper, two-product combo
${buildMuranoCeilingWarningBlock(message, history)}

- NEVER combine or "pair" two named model variants of the SAME wall bed unit together (e.g. Murano Queen + Murano Queen Shelves — pick one bed configuration). This does NOT apply to surround cabinetry: a customer CAN add custom surround cabinetry (side + overhead cabinets) around any wall bed configuration — that is a separate structure, not a bed variant. When a customer asks about adding cabinets/storage around a wall bed, treat it as surround cabinetry by default — confirm it's possible and ask for the total wall length, without explaining the bed-variant mutual-exclusivity rule. Only mention that variants can't be combined if the customer specifically names two bed variants together (e.g. "can I get Queen Sofa and Queen Shelves") or is otherwise actually trying to combine bed configurations — never as a general disclaimer.

RENOVATION LEAD COLLECTION:
If customer mentions renovation, interior design, house design, condo renovation, or kitchen renovation — collect these ONE AT A TIME conversationally:
1. Property type
2. Location / area
3. Budget range
4. Design style preference
5. Number of rooms
6. Floor plan available?
7. Room dimensions
8. Existing obstacles
9. Target completion date
After all collected → summarise and say: "Thank you! Please reach out to our design consultant on WhatsApp at +60 12-475 4568 to schedule your free consultation and share these details."
- If the customer only wants to buy a single product (e.g. "I just wanna buy a wall bed") rather than a full renovation, do NOT run this lead collection flow — just help them with the product directly.

SURROUND CABINETRY ESTIMATES:
- When a customer asks about adding cabinets/storage around a wall bed, OR asks for the
  "estimated price" / "total price" / "how much in total" for a wall bed + cabinetry
  project, treat it as surround cabinetry by default — confirm it's possible, then walk
  through the formula in the KNOWLEDGE BASE section above.
- THE FINAL TOTAL YOU QUOTE IS ALWAYS TWO PARTS ADDED TOGETHER: the price of the
  customer's chosen wall bed model (sale price) PLUS the surround-cabinetry cost you
  calculate from the formula. Never quote the cabinetry subtotal alone as if it were the
  full estimate, and never quote the wall bed price alone once cabinetry has been
  discussed — always show both line items and their sum.
- NEVER ask the customer directly for the wall bed's own width — they likely don't know
  that spec, especially if they haven't bought a wall bed yet. Instead, check whether a
  wall bed MODEL has already been established in this conversation (either they named
  one, or you already recommended one) — its width AND price are looked up
  automatically. If no model has been established yet, ask which model they're
  considering (Murano Queen, Murano Queen Sofa, Murano Queen Desk, Murano Queen Shelves,
  Murano Single, Murano King, or a Gioco model) instead of asking for a raw measurement
  — this is required both for the overhead-cabinet width AND for pricing the wall bed
  line item, so don't skip it even if you already know the width category.
- Beyond that, ask for wall height AND total wall width — both are always required now
  (total wall width also prices the overhead cabinet, not just the leftover side-cabinet
  width) — one question at a time. These ARE reasonable to ask, since they describe the
  customer's own room, not a product spec.
- Customers may answer in feet OR metric (cm/m) — accept either, the server converts
  automatically. You don't need to ask them to restate a measurement in feet.
- The minimum wall height for surround cabinetry depends on the wall bed model, because
  the side cabinets are built to that model's height: 7ft for any Murano, but only
  3.44ft for a Gioco Single or Single Desk, 5.58ft for a Gioco Queen, and 6.92ft for a
  Gioco Bunk Bed. A 5ft wall is far too short for cabinetry around a Murano, yet
  perfectly fine around a Gioco Single. If the wall height comes in below the minimum
  for THAT model, surround cabinetry cannot physically fit — do not calculate or state
  a price. Tell the customer plainly it isn't possible on a wall that short for the
  model they've chosen, double-check it wasn't a typo, and offer to help with the wall
  bed itself instead.
- If a "PRE-CALCULATED WALL BED + CABINETRY ESTIMATE" block appears below, the server
  has already computed every line (wall bed price, side cabinets, overhead cabinet,
  cabinetry subtotal, and the GRAND TOTAL) from this customer's own chosen model and
  measurements — present ALL of those EXACT figures, in that order, ending with the
  GRAND TOTAL as the headline number. Do NOT recalculate, re-round, adjust, or drop any
  line yourself — especially do not drop the wall bed price line and only show the
  cabinetry subtotal.
- That block ONLY appears once the customer has actually asked about price/cost/estimate
  AND every needed measurement is known — if it's missing because a measurement is still
  outstanding, keep asking for whichever of wall bed model / wall height / total wall
  width is still missing. If it's missing because no price question has been asked yet,
  keep helping with whatever the customer actually asked (collecting measurements or
  discussing layout is fine) without volunteering a total. Do not guess or estimate a
  total from memory before the block appears, and do not state a total using only the
  cabinetry portion while the wall bed portion is still missing.
- Always label it as an estimate confirmed via WhatsApp/site survey.
- This is the ONE place where you may state a price that isn't literally written
  character-for-character in the knowledge base as a single line — because it's a live
  calculation (wall bed price + cabinetry formula) from the customer's own choices and
  measurements, not an invented number. Do not use this as license to estimate prices
  anywhere else.
${buildCabinetryEstimateBlock(message, history)}

RESERVATION DEPOSIT:
- MOCOF takes a ${DEPOSIT_PERCENT}% reservation deposit to hold an order. It goes toward the
  final invoice, which is confirmed by a site survey.
- Once you have discussed a SPECIFIC wall bed model with the customer — named it and
  given its price — proactively invite them to reserve it. One short, low-pressure
  sentence at the end of your reply, e.g. "Would you like to reserve your **Murano
  Queen** with a ${DEPOSIT_PERCENT}% deposit?". Do not wait for them to ask about paying, and do
  not wait for cabinetry to come up — this applies to a plain wall bed on its own.
- Only do this once a specific model is settled. Do NOT invite a deposit while still
  narrowing options down (e.g. you've only asked about ceiling height and room purpose,
  or you've just listed several models to choose between) — there is nothing definite to
  reserve yet.
- If the customer IS discussing surround cabinetry, invite the deposit only once the
  full wall bed + cabinetry GRAND TOTAL has been presented, and against that grand
  total — never against the wall bed price alone. Do not offer a bed-only deposit to a
  customer who is in the middle of a cabinetry quote; it would be for less than the
  project they're actually pricing.
- NEVER write a payment link, a URL, or payment instructions of any kind, and never
  state the deposit amount in RM yourself. A separate system attaches the real payment
  button with the exact figures — your job is only to raise the option in words. Do not
  describe the button, and do not claim a payment has been received or confirmed.
- If the customer says yes or asks how to pay, tell them the payment option appears just
  below your message. If they'd rather not, drop it and carry on helping — do not ask
  again in every reply.

CRITICAL — IMAGES:
- A separate system automatically attaches a real product photo to your reply when relevant — this happens entirely outside your control and you have no visibility into whether one will be attached to THIS reply.
- Do NOT mention images, photos, or pictures in your text reply AT ALL — not to confirm one exists, not to deny one exists, and not to comment on your own ability to display one. This applies even when the customer explicitly asks to "see a photo" or "show me an image."
- Banned phrases — never write anything like these, in any wording: "I can't display images directly", "I'm unable to show pictures", "I don't have a photo available", "I can't send images", "here's a description instead of a photo". All of these are forbidden, regardless of phrasing, because a real photo may already be attached right alongside your text and any of these sentences would directly contradict it.
- Instead: when a customer asks to see a product, just answer the substantive question (price, specs, dimensions, availability) as if the photo question was never asked. Do not acknowledge the request for a photo one way or the other — simply skip past it to the product information.

SHOWROOM APPOINTMENT / SHOW UNIT VIEWING:
- For TRX Core Residence or Maison MOCOF TRX viewings → always say: "This is by appointment only — please contact us on WhatsApp at +60 12-568 4568 to book your visit."
- For general showroom visits → share the relevant showroom details and suggest WhatsApp for appointments

RESPONSE RULES:
- Maximum 120 words unless detail is genuinely needed
- Use line breaks for readability
- End with a question or call to action
- Never invent prices or specs not in the knowledge base

FORMATTING RULES:
- Supported formatting is now: **bold**, numbered lists ("1. ", "2. ", ...), bullet lists ("- " per line), and Markdown tables. Nothing else renders — no headers (#), no code blocks, no links, no italics, no blockquotes. Never use those; they will show up as literal characters to the customer.
- Bold: use double asterisks for key product/service keywords only — **Wall Beds**, **Sofa Beds**, **Renovation**, **Tables**, **Kitchen**, **Wardrobes**, **Showroom**, **Warranty**, series names like **Murano Series** / **Gioco Series**, and model names like **Murano Queen** or **Gioco Single Desk**. Do NOT bold entire sentences — only the keyword/name itself. Never use single asterisks or italics.
- MULTIPLE QUESTIONS: if your reply asks the customer two or more distinct questions, format them as a numbered list — EACH QUESTION ON ITS OWN SEPARATE LINE (a real line break between them), like this:
  1. What's the total height of the wall, in feet?
  2. What's the total width of the wall, in feet?
  3. Are both sides of the bed open, or is one side against a corner?
  WRONG (do not do this — this is a real bug that has happened before): writing all the questions back-to-back on one line/sentence, e.g. "1. What's the total height of the wall, in feet? 2. What's the total width of the wall, in feet? 3. Are both sides open?" — even though it starts with "1.", cramming items 2 and 3 onto the same line makes them unreadable to the customer. Always put a line break before each new number. (A single question stays as plain conversational text — only switch to a numbered list once there are 2 or more.)
- BULLET LISTS: use "- " at the start of each line for short unordered items (e.g. a price/estimate breakdown with several line items, or a list of options) — one item per line, no extra commentary inside the item itself.
- TABLES: when presenting genuinely tabular/comparative data (e.g. comparing two or more models side by side, or a multi-row price breakdown), use a proper Markdown table — a header row, then a separator row of dashes, then data rows, all with matching column counts:
  | Model | Width | Sale Price |
  |---|---|---|
  | Murano Queen | 167cm | RM 14,371.55 |
  | Murano King | 198cm | RM 15,285.45 |
  Keep tables narrow and mobile-friendly: 4 columns maximum, short cell text (a few words or one number per cell, no long sentences inside a cell). Every row must have the same number of columns as the header. Don't use a table for a single row of data or for prose — only when there are genuinely multiple rows/columns to compare.
- Never mix a table and a numbered-question list in the same reply — pick whichever structure actually fits what you're presenting.

CRITICAL — GROUNDING (this section overrides anything above if there's ever a conflict):
- Every product name, price, and spec you state must appear character-for-character in the KNOWLEDGE BASE section above — EXCEPT a surround cabinetry estimate you calculate live from the formula and the customer's own stated measurements (see SURROUND CABINETRY ESTIMATES above). That is the only case where a number not literally in the knowledge base is allowed. Never invent a product by combining two real names — for example there is no "Gioco Queen Sofa"; the real Gioco lineup is ONLY: Gioco Single, Gioco Queen, Gioco Single Desk, Gioco Bunk Bed. The real Murano lineup is ONLY: Murano Single, Murano Queen, Murano King, Murano Queen Sofa, Murano Queen Desk, Murano Queen Shelves.
- If a customer asks for something cheaper or an alternative, only offer a REAL lower-priced option that is already in the knowledge base above (e.g. Murano Single or Gioco Single are the lowest-priced wall beds; a Basic Sofa is the lowest-cost way to add separate seating). Never invent a new "budget" variant or a new price.
- Always state prices exactly as written in the knowledge base, including the cents (e.g. "RM 12,062.55", not "RM 12,062" or "around RM 12,000") — rounding or approximating a real price is not allowed.
- If a customer asks about a specific named product (e.g. "what is X?"), first check the ENTIRE knowledge base above carefully before answering — do not say a product doesn't exist unless you have checked thoroughly. If it genuinely isn't there, say you don't have that specific detail on hand rather than firmly declaring it doesn't exist, and offer to confirm via WhatsApp (+60 12-568 4568) — a product you can't find in your own context may still be real.`;
}

// ── API key ──────────────────────────────────────────────────
// Two keys, in priority order — GEMINI_API_KEY is primary,
// GEMINI_API_KEY_2 is the fallback. Either one may be unset; only
// whichever are actually configured get returned.
function getGeminiApiKeys() {
    return [process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_2]
        .filter(key => typeof key === 'string' && key.trim() !== '');
}

async function callGemini(apiKey, requestBody) {
    const geminiRes = await fetch(GEMINI_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!geminiRes.ok) {
        const errText = await geminiRes.text();
        const err = new Error(`Gemini API error: ${geminiRes.status}`);
        err.status = geminiRes.status;
        err.details = errText;
        throw err;
    }

    const data = await geminiRes.json();

    // Gemini 3.x models spend part of max_completion_tokens on internal
    // "thinking" before writing the visible reply -- if thinking consumes
    // most/all of the budget, finish_reason comes back as "length" with a
    // partial (or empty) message, and nothing about the HTTP response itself
    // looks like an error. Logging this is the only way to actually see it
    // happening, rather than just observing "replies are sometimes cut" with
    // no lead on why.
    const finishReason = data?.choices?.[0]?.finish_reason;
    if (finishReason === 'length') {
        console.warn(
            'Gemini reply hit the token limit before finishing (finish_reason: length) — ' +
            'likely the thinking/reasoning budget ate most or all of max_completion_tokens. ' +
            'usage:', JSON.stringify(data.usage || {})
        );
    }

    if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message ||
        !data.choices[0].message.content
    ) {
        const err = new Error('Invalid response from Gemini');
        err.status = 502;
        throw err;
    }

    return data.choices[0].message.content;
}

// Tries each configured key in order (GEMINI_API_KEY, then
// GEMINI_API_KEY_2), but only advances to the next key when the failure
// looks like something a *different* key could plausibly fix — a network
// error, rate limiting (429), or the provider having a bad moment (5xx).
// A 4xx like 400/401/403 means the request or that specific key itself is
// bad, and the other key would fail the exact same way, so it fails fast
// instead of wasting a second round-trip.
async function callGeminiWithFallback(apiKeys, requestBody) {
    let lastError = null;
    for (let i = 0; i < apiKeys.length; i++) {
        try {
            return await callGemini(apiKeys[i], requestBody);
        } catch (err) {
            lastError = err;
            const retryable = !err.status || err.status === 429 || err.status >= 500;
            const isLastKey = i === apiKeys.length - 1;
            console.error(
                `Gemini key ${i + 1}/${apiKeys.length} failed:`, err.status || 'network', err.details || err.message,
                (retryable && !isLastKey) ? '— trying next key' : ''
            );
            if (!retryable || isLastKey) {
                throw err;
            }
        }
    }
    throw lastError;
}

// ── Convert history to OpenAI-compatible format ───────────────
// This is a standard OpenAI-shape message list, not a Groq-specific format --
// it works unchanged against Gemini's OpenAI-compatible endpoint too.
// Capped independently of whatever the client sends (the widget keeps up to 40
// messages client-side for display) — recent turns carry the useful context;
// sending the full 40 every single request adds unbounded, mostly-redundant
// token cost on top of the per-request knowledge-module cap above.
const MAX_HISTORY_TURNS_SENT_TO_MODEL = 12;

function toGeminiHistory(history) {
    if (!Array.isArray(history)) return [];
    return history
        .slice(-MAX_HISTORY_TURNS_SENT_TO_MODEL)
        .filter(m => m && m.role && m.content && m.content.trim() !== '')
        .map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: m.content.trim()
        }));
}

// ── Price guardrail: catch hallucinated RM figures before they reach the customer ──
// Builds a master list of EVERY real price across the whole business (not just
// whatever got routed into this turn's prompt), so genuinely valid prices from
// earlier in the conversation never get false-flagged just because this message
// didn't retrigger that knowledge category.
//
// Uses a small tolerance (not exact-cent matching) because the model may
// naturally round a real price in casual phrasing (e.g. "RM 12,062" instead
// of "RM 12,062.55") — that's not hallucination, it's rounding, and treating
// it as hallucination throws away a perfectly correct answer.
function extractAmounts(text) {
    const amounts = [];
    const matches = text.matchAll(/RM\s?([\d,]+(?:\.\d{1,2})?)/gi);
    for (const m of matches) {
        const val = parseFloat(m[1].replace(/,/g, ''));
        if (!isNaN(val)) amounts.push(val);
    }
    return amounts;
}

const MASTER_PRICE_LIST = extractAmounts([
    getWallBedKnowledge(),
    getSofaBedKnowledge(),
    getTableKnowledge(),
    getKitchenKnowledge(),
    getWardrobeKnowledge(),
    getShowroomKnowledge(),
    getWarrantyKnowledge(),
    getRenovationKnowledge(),
    getBasicFurnitureKnowledge(),
    getBedsheetKnowledge(),
    getCabinetryKnowledge() // includes the RM1,350 / RM800 unit rates + worked examples
].join('\n'));

const PRICE_TOLERANCE = 2.00; // RM — forgives cent-level rounding, not real mistakes

function isKnownAmount(val, extraAllowed) {
    for (const known of MASTER_PRICE_LIST) {
        if (Math.abs(known - val) <= PRICE_TOLERANCE) return true;
    }
    for (const known of extraAllowed) {
        if (Math.abs(known - val) <= PRICE_TOLERANCE) return true;
    }
    return false;
}

// ── Cabinetry estimates are the one case where the model states a price that
// isn't a literal catalog number — it's calculated live from measurements the
// customer gave earlier in the conversation. Best-effort regex extraction of
// those measurements from the recent conversation, then re-running the exact
// same formula server-side, so the guardrail can recognize the resulting
// total (and its line items) as legitimate instead of flagging them.
//
// IMPORTANT: the system prompt asks for height / bed width / total width ONE
// AT A TIME, so customers typically reply with a bare number ("9ft", "5.5 ft")
// with no context words at all. This function is turn-aware: for a bare
// number with no self-contained context, it looks at what the ASSISTANT'S
// PRECEDING message asked about and attributes the number accordingly.
//
// This is intentionally best-effort text parsing, not a robust NLU layer —
// if extraction still fails, we fall back to the normal strict guard for
// that message (safe default: no extra amounts get allowed).
// ── Unit conversion: accept feet (ft/feet/foot/') OR metric (cm/m/meter/metre) ──
// calculateCabinetPrice() only ever receives feet — every value extracted below is
// converted immediately after matching, so the formula itself and its documented
// worked examples in knowledge/cabinetry.js (which are all in feet) stay untouched.
// round2() is defined further down in this file but hoisted, so it's callable here.
const CM_PER_FT = 30.48;
const FT_PER_M = 1 / 0.3048; // ≈ 3.28084

function convertToFeet(value, unit) {
    const u = unit.toLowerCase();
    if (u === 'cm' || u.startsWith('centimet')) return round2(value / CM_PER_FT);
    if (u === 'm' || u.startsWith('met')) return round2(value * FT_PER_M);
    return value; // ft / feet / foot / '
}

// Shared unit alternation (repeated inline in each pattern below, matching this
// file's existing style rather than factoring into a template string). "m" needs
// a trailing word boundary so it can't accidentally match the first letter of an
// unrelated word like "minutes" — the other units aren't valid standalone English
// words, so they don't need the same guard. Every pattern below captures the unit
// as its OWN group (immediately after the number group) so extractFtValue() and
// the bare-number fallback in extractCabinetryDimensions() know which unit matched.
function extractFtValue(text, patterns) {
    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            const val = parseFloat(m[1]);
            if (!isNaN(val)) return convertToFeet(val, m[2]);
        }
    }
    return null;
}

const BARE_LENGTH_PATTERN = /(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)/;

// Keyword-anchored, but tolerant of ordinary sentence phrasing in between the
// keyword and the number — e.g. "The height of the wall is 8.5ft." has 16
// filler characters between "height" and "8.5ft", which the old rigid
// single-word-gap regexes did not allow, so they silently failed to match.
const HEIGHT_PATTERNS = [
    /(?:wall\s*)?height[^\d]{0,30}?(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)/,
    /(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)[^\d]{0,20}?(?:tall|high\b|in\s*height)/
];
// Strict form (contains the literal word "total") is always safe to check.
const TOTAL_WIDTH_STRICT_PATTERNS = [
    /total[^\d]{0,25}?width[^\d]{0,25}?(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)/
];
// Looser forms ("the wall is 10ft wide") are only tried when this same message
// doesn't look like it's actually describing the BED's own width — a customer
// occasionally volunteers that unprompted even though we no longer ask for it,
// and "the wall bed is 5.5ft wide" should not get miscounted as the total wall.
const BED_WIDTH_MENTION_GUARD = /(?:wall\s*)?bed[^\d]{0,20}?(?:\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)\s*wide|(?:\d+(?:\.\d+)?)\s*(?:ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)[^\d]{0,15}?wide[^\d]{0,10}?(?:wall\s*)?bed/;
const TOTAL_WIDTH_LOOSE_PATTERNS = [
    /wall[^\d]{0,15}?(?:is|of)[^\d]{0,10}?(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)\s*wide/,
    /(\d+(?:\.\d+)?)\s*(ft|feet|foot|'|cm|centimeters?|centimetres?|met(?:er|re)s?|m\b)[^\d]{0,10}?(?:wide|width)[^\d]{0,10}?wall\b/
];

// Wall bed width is NEVER asked from the customer — it's a fixed spec of
// whichever model they're getting, and most customers (especially ones who
// haven't bought a wall bed yet) simply wouldn't know that measurement.
// Instead, we detect which model has been established in the conversation
// — named by either the customer OR the assistant's own recommendation —
// and look its width up automatically. Scans BOTH roles (unlike the height/
// total-width extraction, which only trusts the customer's own statements)
// because the assistant is very often the one who names the specific model,
// e.g. "I'd recommend the Murano Queen Sofa" with the customer just replying
// "sounds good" — never re-stating the model name themselves.
function extractSelectedWallBedModel(history, message) {
    const priorTurns = Array.isArray(history) ? history.slice(-10) : [];
    const turns = [...priorTurns, { role: 'user', content: message }];
    let selected = null;
    for (const turn of turns) {
        if (!turn || !turn.content) continue;
        const text = turn.content.toLowerCase();
        for (const model of WALLBED_MODEL_WIDTHS_FT) {
            if (model.pattern.test(text)) selected = model; // last mention (either role) wins
        }
    }
    return selected;
}

// Same scanning approach as extractSelectedWallBedModel above, but against the
// more granular WALLBED_MODEL_PRICING table — needed because several models
// share a width (and so agree under the coarser table) while having very
// different prices (e.g. Murano Queen vs. Murano Queen Sofa). Used to price
// the "wall bed" line item in a combined wall-bed + cabinetry estimate.
function extractSelectedWallBedPricing(history, message) {
    const priorTurns = Array.isArray(history) ? history.slice(-10) : [];
    const turns = [...priorTurns, { role: 'user', content: message }];
    let selected = null;
    for (const turn of turns) {
        if (!turn || !turn.content) continue;
        const text = turn.content.toLowerCase();
        for (const model of WALLBED_MODEL_PRICING) {
            if (model.pattern.test(text)) selected = model; // last mention (either role) wins
        }
    }
    return selected;
}

function extractCabinetryDimensions(history, message) {
    const priorTurns = Array.isArray(history) ? history.slice(-10) : [];
    const turns = [...priorTurns, { role: 'user', content: message }];

    let heightFt = null, totalWidthFt = null;

    for (let i = 0; i < turns.length; i++) {
        const turn = turns[i];
        if (!turn || turn.role !== 'user' || !turn.content) continue;

        const userText = (turn.content || '').toLowerCase();
        const prevAssistant = (i > 0 && turns[i - 1] && turns[i - 1].role === 'assistant')
            ? (turns[i - 1].content || '').toLowerCase()
            : '';

        // 1) Self-contained matches — checked INDEPENDENTLY (not first-match-wins),
        // so a single message stating two measurements at once (very natural for
        // a customer to do, even though the bot asks one at a time) has both
        // captured instead of losing whichever pattern happened to be checked second.
        const heightSelf = extractFtValue(userText, HEIGHT_PATTERNS);
        let totalSelf = extractFtValue(userText, TOTAL_WIDTH_STRICT_PATTERNS);
        if (totalSelf === null && !BED_WIDTH_MENTION_GUARD.test(userText)) {
            totalSelf = extractFtValue(userText, TOTAL_WIDTH_LOOSE_PATTERNS);
        }

        let matchedAny = false;
        if (heightSelf !== null) { heightFt = heightSelf; matchedAny = true; }
        if (totalSelf !== null) { totalWidthFt = totalSelf; matchedAny = true; }

        if (matchedAny) continue;

        // 2) Bare number with no context of its own — infer from what the bot just asked.
        const bareMatch = userText.match(BARE_LENGTH_PATTERN);
        if (!bareMatch) continue;
        const bareVal = parseFloat(bareMatch[1]);
        if (isNaN(bareVal)) continue;
        const bareFt = convertToFeet(bareVal, bareMatch[2]);

        if (/total\s*(?:wall\s*)?width/.test(prevAssistant)) totalWidthFt = bareFt;
        else if (/height/.test(prevAssistant)) heightFt = bareFt;
    }

    return { heightFt, totalWidthFt };
}

// Minimum ceiling a Murano model can be installed under. 2.4m is the real
// business requirement (confirmed with MOCOF) and is what knowledge/wallbeds.js
// states in prose throughout — so 2.4m is the figure of record here, and feet
// is the derived unit, not the other way round.
//
// This is deliberately NOT the same constant as SIDE_CABINET_MAX_HEIGHT_FT
// (7ft). The two were previously aliased, which quietly under-enforced this
// rule: a ceiling between 7ft and 2.4m passed as installable even though it's
// below the stated cutoff. They are unrelated measurements that happened to be
// near each other — 7ft is how tall a side cabinet is physically built, 2.4m is
// how much headroom a Murano needs — so they must be free to move independently.
const MURANO_MIN_CEILING_M = 2.4;

// round2 (hoisted, defined further down) is applied for the SAME reason
// convertToFeet() applies it: a customer who answers "2.4m" has that value
// converted to feet through convertToFeet, which rounds to 2dp — yielding
// 7.87. Comparing that against an unrounded 7.874015...ft threshold would
// flag a ceiling of exactly the stated minimum as too low. Rounding both
// sides identically keeps "2.4m" a passing answer, which it must be.
const MURANO_MIN_CEILING_FT = round2(MURANO_MIN_CEILING_M * FT_PER_M); // 7.87

// Reuses the SAME extraction the cabinetry flow already runs (wall/ceiling
// height + selected model) — this is not a new extraction path, it just
// looks at those same two facts through a different lens: is a Murano model
// on the table for a ceiling it can't actually fit under? Fires as soon as
// both facts are known, independent of whether cabinetry or price was ever
// mentioned, since this is a hard installability constraint, not a price.
function detectMuranoCeilingConflict(message, history) {
    const { heightFt } = extractCabinetryDimensions(history, message);
    const selectedModel = extractSelectedWallBedModel(history, message);
    if (!heightFt || !selectedModel) return null;
    if (heightFt >= MURANO_MIN_CEILING_FT) return null;
    if (!/murano/i.test(selectedModel.label)) return null;
    return { heightFt, minCeilingFt: MURANO_MIN_CEILING_FT, conflictingLabel: selectedModel.label };
}

// Injected into PRODUCT RECOMMENDATION RULES so the model corrects course
// immediately if it (or the customer) has already named a Murano model for
// a ceiling that can't fit one — rather than relying only on the static
// "Murano requires 2.4m+" prompt text to self-police an existing mistake.
function buildMuranoCeilingWarningBlock(message, history) {
    const conflict = detectMuranoCeilingConflict(message, history);
    if (!conflict) return '';
    return [
        '',
        `CEILING HEIGHT CONFLICT — ACT ON THIS NOW: the customer's stated wall/ceiling height is ${conflict.heightFt}ft, below the ${conflict.minCeilingFt}ft (~2.4m) minimum the Murano series requires. "${conflict.conflictingLabel}" has been named in this conversation but is NOT installable at this ceiling height. Correct course now: tell the customer plainly that ${conflict.conflictingLabel} won't fit their ceiling, and recommend the equivalent Gioco model instead.`
    ].join('\n');
}

// Runs extraction + the real formula once; both the guard-allowlist and the
// system-prompt pre-calculated block (below) read from this single source
// so they can never disagree with each other.
function getCabinetryEstimateFromContext(message, history) {
    const { heightFt, totalWidthFt } = extractCabinetryDimensions(history, message);
    const selectedModel = extractSelectedWallBedModel(history, message);
    if (!heightFt || !selectedModel) return null;

    // Side cabinets are sized against the SPECIFIC model, so resolve it off the
    // granular pricing table rather than selectedModel above. That one comes
    // from the coarse width table, which labels every Gioco variant just
    // "Gioco" — useless here, since Gioco heights range from 3.44ft to 6.92ft.
    // Falls back to the flat 7ft when the variant can't be pinned down.
    const pricedModel = extractSelectedWallBedPricing(history, message);
    const sideCabinetHeightFt = resolveSideCabinetHeightFt(pricedModel ? pricedModel.label : null);

    // Checked BEFORE calling calculateCabinetPrice() and outside the try/catch
    // below, so this specific, expected condition (wall too short to fit
    // cabinetry) is distinguishable from "not enough info yet" (e.g. total
    // width not collected) — those two cases need different messages to the
    // customer, not the same silent `return null`. calculateCabinetPrice()
    // also guards this itself (defense in depth for any other caller), but
    // checking it here first lets us attach the customer-facing reason.
    //
    // Compared against the per-model side-cabinet height, NOT the flat 7ft.
    // Using the constant rejected walls that comfortably fit a short Gioco —
    // a 5ft wall is plenty for a 3.44ft Gioco Single cabinet.
    if (heightFt < sideCabinetHeightFt) {
        return { blocked: true, reason: 'WALL_TOO_SHORT_FOR_CABINETRY', heightFt, minHeightFt: sideCabinetHeightFt };
    }

    try {
        const result = calculateCabinetPrice({
            wallHeightFt: heightFt,
            wallBedWidthFt: selectedModel.widthFt,
            totalWallWidthFt: totalWidthFt ?? undefined,
            sideCabinetHeightFt
        });

        // The customer's FINAL total for a "wall bed + surround cabinetry"
        // project is the wall bed's own price PLUS the cabinetry cost just
        // computed above — resolve the specific chosen model (not just its
        // width category) against the granular price table so variants that
        // share a width but differ in price (Murano Queen vs. Queen Sofa,
        // etc.) are priced correctly. Sale price is used as "the price" here,
        // matching how sale prices are quoted elsewhere in this file (see
        // PRODUCT RECOMMENDATION RULES). Resolved above, since the side-cabinet
        // height needs the same specific model.
        const wallBedSalePrice = pricedModel ? round2(pricedModel.sale) : null;
        const wallBedRetailPrice = pricedModel ? round2(pricedModel.retail) : null;
        const grandTotal = wallBedSalePrice !== null ? round2(wallBedSalePrice + result.total) : null;

        return {
            heightFt, bedWidthFt: selectedModel.widthFt, bedModelLabel: selectedModel.label, totalWidthFt,
            ...result,
            wallBedModelLabel: pricedModel ? pricedModel.label : selectedModel.label,
            wallBedSalePrice, wallBedRetailPrice, grandTotal
        };
    } catch {
        return null; // e.g. height > 9ft but total wall width not collected yet
    }
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// Scans the last few turns + current message for cabinetry measurements and,
// if enough are present, computes the same total the model should be stating
// — those numbers become allowed even though they're not in the static catalog.
function computeCabinetryAllowedAmounts(message, history) {
    const est = getCabinetryEstimateFromContext(message, history);
    // A blocked (wall-too-short) result has no legitimate price to allow —
    // if the model states one anyway despite the prompt instruction not to,
    // the price guardrail should treat it as unrecognized, same as any other
    // fabricated figure.
    if (!est || est.blocked) return [];
    return [
        est.sideCostPerSide, est.sideCostTotal, est.topCost, est.total,
        est.wallBedSalePrice, est.wallBedRetailPrice, est.grandTotal
    ].filter(v => v > 0);
}

function formatRM(n) {
    return `RM ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Price-intent gate ───────────────────────────────────────
// cabinetry.js's own knowledge text says the model must present a price
// "STRICTLY ONLY WHEN ASKED" — but until now nothing enforced that in code:
// buildCabinetryEstimateBlock() below appeared (and the model was told to
// present it) the moment enough measurements were known, price question or
// not, which let the live bot volunteer pricing unprompted.
//
// Checked across the same recent-turns window as extractCabinetryDimensions
// above, not just the exact current message — because the measurement
// collection flow means the customer's price question and the final missing
// measurement are usually several turns apart, e.g.:
//   "how much would this cost?" → bot asks height → "9ft"
//   → bot asks total width → "12ft"
// That last bare "12ft" has no price words of its own, but the price WAS
// asked for a few turns back and the estimate should now be shown.
const PRICE_INTENT_PATTERN = /\b(how\s*much|price|cost|estimate|quote|total)\b/i;

function hasPriceIntent(message, history) {
    const priorTurns = Array.isArray(history) ? history.slice(-10) : [];
    const turns = [...priorTurns, { role: 'user', content: message }];
    return turns.some(t => t && t.role === 'user' && t.content && PRICE_INTENT_PATTERN.test(t.content));
}

// Kept as an alias. This gate was written for — and named after — the cabinetry
// flow, but nothing in it is cabinetry-specific, and the wall-bed-only deposit
// path below needs the identical check. Both names are exported so existing
// callers and tests keep working against the same single implementation.
const hasCabinetryPriceIntent = hasPriceIntent;

// Has cabinetry come up in this conversation at all? This protects the deposit
// flow: once cabinetry is on the table, the only legitimate deposit is the
// combined wall bed + cabinetry total. Offering a cheaper wall-bed-only deposit
// midway — while measurements are still being collected and no combined price
// has been shown — would put a payment button ahead of the price text, which is
// exactly what computeDepositOffer()'s gating exists to prevent.
//
// Deliberately BROADER than the cabinetry module's routing regex in
// KNOWLEDGE_MODULES, and deliberately not reusing it. That regex is narrow on
// purpose — it must not let a generic "cabinet" (kitchen, wardrobe) claim a
// cabinetry knowledge slot — so it does not match ordinary phrasings like
// "a Murano Queen with cabinets". Here the error costs run the opposite way:
// over-matching only costs a wall-bed-only deposit that goes unoffered, while
// under-matching offers a payment for less than the quote being assembled. When
// the two biases conflict, this one wins, so the patterns stay separate.
//
// Checked across BOTH roles: the assistant is often the one to raise surround
// cabinetry, with the customer just agreeing.
const CABINETRY_MENTION_PATTERN = /cabinet|surround/i;

function hasCabinetryIntent(message, history) {
    const priorTurns = Array.isArray(history) ? history.slice(-10) : [];
    const turns = [...priorTurns, { role: 'user', content: message }];
    return turns.some(t => t && t.content && CABINETRY_MENTION_PATTERN.test(t.content));
}

// Builds a ready-made, already-correct breakdown to inject into the system
// prompt when we have enough measurements. The model is told to relay these
// exact figures rather than compute them itself — this removes reliance on
// the model's arithmetic entirely, not just the after-the-fact guard check.
function buildCabinetryEstimateBlock(message, history) {
    const est = getCabinetryEstimateFromContext(message, history);

    // Checked BEFORE the price-intent gate below and regardless of it — "this
    // can't fit" is a hard constraint the customer needs to hear as soon as
    // it's known (so the bot stops asking for total width for something
    // impossible), not a price reveal that should wait for an explicit ask.
    if (est && est.blocked && est.reason === 'WALL_TOO_SHORT_FOR_CABINETRY') {
        return [
            '',
            `SURROUND CABINETRY NOT POSSIBLE FOR THIS CUSTOMER: their stated wall height is ${est.heightFt}ft, below the ${est.minHeightFt}ft minimum needed to build the side cabinets (for this customer's chosen wall bed model the side cabinets are built ${est.minHeightFt}ft tall — that minimum varies by model, see the formula above). Do NOT calculate or state any cabinetry price. Tell the customer plainly that surround cabinetry can't fit on a wall this short, double-check the measurement in case it was a typo, and offer to help with the wall bed itself (without cabinetry) instead.`
        ].join('\n');
    }

    if (!hasPriceIntent(message, history)) return '';
    if (!est || est.blocked) return '';

    const lines = [
        '',
        'PRE-CALCULATED WALL BED + CABINETRY ESTIMATE FOR THIS CUSTOMER (already computed from their chosen model and their own measurements — use these EXACT figures, do not recalculate, re-round, or omit any line):',
    ];

    if (est.wallBedSalePrice !== null) {
        lines.push(`- Wall bed (${est.wallBedModelLabel}, sale price): ${formatRM(est.wallBedSalePrice)}`);
    }

    lines.push(
        `- Side cabinets: ${formatRM(est.sideCostPerSide)} per side × ${est.sides} side(s) = ${formatRM(est.sideCostTotal)} (${est.sideCabinetMaxHeightFt}ft tall; leftover wall width used: ${est.sideCabinetWidthFt}ft per side)`,
        `- Overhead cabinet (priced by total wall width, ${est.totalWidthFt}ft; built ${est.overheadCabinetHeightFt}ft tall): ${formatRM(est.topCost)}`
    );
    lines.push(`- Cabinetry subtotal: ${formatRM(est.total)}`);

    if (est.grandTotal !== null) {
        lines.push(`- GRAND TOTAL (wall bed + cabinetry): ${formatRM(est.grandTotal)}`);
    } else {
        lines.push('- Wall bed price not resolved for this exact model — ask the customer to confirm the specific model before stating a combined total; present the cabinetry subtotal only until then.');
    }

    return lines.join('\n');
}

// ── Deposit offer (Stripe integration) ──────────────────────
// 10% reservation deposit, applied toward the final invoice once the site
// survey confirms the real price — decided in
// stripe-payment-gateway-proposal-v2.md Section 1.
const DEPOSIT_PERCENT = 10;

// Deposit type identifiers. These are written into Stripe session metadata and
// then straight into the Google Sheet column, so they are a stored data format,
// not display strings — changing a value here changes what future Sheet rows
// say and stops matching every row already logged.
const DEPOSIT_TYPE_WITH_CABINETRY = 'wallbed_with_cabinetry';
const DEPOSIT_TYPE_WALLBED_ONLY   = 'wallbed_only';

// The Google Sheet's "Cabinets" column is a plain Yes/No so MOCOF can read a
// deposit's scope at a glance. Derived from the deposit type rather than
// tracked separately, so the two can never disagree.
//
// An unrecognised type returns '' on purpose. A future third deposit type
// would otherwise be silently recorded as "No" — a confident wrong answer in a
// business record is worse than a blank cell that visibly needs attention.
// Lives here, not in api/create-deposit.js, so it is reachable from the test
// suite without pulling in the stripe dependency.
function depositIncludesCabinets(depositType) {
    if (depositType === DEPOSIT_TYPE_WITH_CABINETRY) return 'Yes';
    if (depositType === DEPOSIT_TYPE_WALLBED_ONLY) return 'No';
    return '';
}

// Human-readable name for a deposit type, used in the notification email's
// subject and body. Sits beside depositIncludesCabinets() on purpose: both are
// renderings of the SAME field (basis.type, fixed at charge time), so keeping
// them together is what stops the email and the Sheet from ever describing one
// payment differently.
//
// Returns '' for an unrecognised type, same rule and same reason as the Yes/No
// mapping — a future third deposit type must surface as visibly missing rather
// than be quietly mislabelled as one of the two that exist today.
function depositTypeLabel(depositType) {
    if (depositType === DEPOSIT_TYPE_WITH_CABINETRY) return 'Wall Bed + Cabinetry';
    if (depositType === DEPOSIT_TYPE_WALLBED_ONLY) return 'Wall Bed Only';
    return '';
}

// THE single definition of "is a deposit payable in this conversation, and on
// what amount". Both the chat response's offer (computeDepositOffer below) and
// the actual Stripe charge (api/create-deposit.js) call this and nothing else,
// which is what stops the quoted and charged amounts from ever diverging.
//
// Two paths, deliberately ordered:
//
//  1. Wall bed + cabinetry — the combined grand total. Gating still mirrors
//     buildCabinetryEstimateBlock() EXACTLY (same price-intent check, same
//     "must be a full non-blocked grandTotal" requirement) so the button can
//     never appear ahead of, or instead of, the combined price text.
//
//  2. Wall bed only — the model's sale price alone, for a customer who never
//     raised cabinetry. Gated on hasCabinetryIntent() being FALSE, not merely
//     on the cabinetry estimate being unavailable: mid-cabinetry-flow the
//     estimate is legitimately absent while measurements are still being
//     collected, and quietly falling back to a cheaper wall-bed-only deposit
//     there would offer a payment for less than the quote being assembled.
//
// The price-intent check is deliberately scoped to path 1 only. A deposit is
// now offered after simply discussing a specific wall bed, without the
// customer having to ask "how much" first — establishing a model is enough.
// That is safe here in a way it would not be for cabinetry: the wall bed's
// sale price is a fixed catalog figure the bot has already stated, and the
// deposit card itself displays the total it is charging against, so the
// button cannot get ahead of a price the customer hasn't seen. A cabinetry
// grand total is assembled from measurements over several turns, so that path
// keeps waiting for an explicit price question.
//
// Returns null when no deposit should be offered at all.
function getDepositBasisFromContext(message, history) {
    // A wall bed that cannot physically be installed at this customer's ceiling
    // must never be taken payment for, on either path. This check was
    // previously absent: the cabinetry flow only blocks walls under the 7ft
    // side-cabinet minimum, so a 7ft–2.4m ceiling with a Murano selected
    // produced a priced estimate and an offered deposit for an uninstallable
    // bed. detectMuranoCeilingConflict() is the same constraint the system
    // prompt is told to enforce in conversation.
    if (detectMuranoCeilingConflict(message, history)) return null;

    if (hasPriceIntent(message, history)) {
        const est = getCabinetryEstimateFromContext(message, history);
        if (est && !est.blocked && est.grandTotal !== null && typeof est.grandTotal !== 'undefined') {
            return {
                type: DEPOSIT_TYPE_WITH_CABINETRY,
                wallBedModelLabel: est.wallBedModelLabel,
                total: est.grandTotal,
                heightFt: est.heightFt,
                totalWidthFt: est.totalWidthFt
            };
        }
    }

    // Cabinetry is on the table but not yet priced — keep collecting, offer
    // nothing. (Also covers a blocked wall-too-short estimate.) This is the
    // anti-downgrade guard: without it, broadening the trigger above would let
    // a mid-cabinetry customer be offered the cheaper bed-only deposit.
    if (hasCabinetryIntent(message, history)) return null;

    const pricedModel = extractSelectedWallBedPricing(history, message);
    if (!pricedModel) return null;

    return {
        type: DEPOSIT_TYPE_WALLBED_ONLY,
        wallBedModelLabel: pricedModel.label,
        total: round2(pricedModel.sale),
        heightFt: null,
        totalWidthFt: null
    };
}

// Decides whether to OFFER a deposit button in the chat response; it never
// talks to Stripe. api/create-deposit.js re-derives the basis independently
// from the same conversation when the button is actually clicked, so the
// amount charged is never trusted from what this returned to the client.
function computeDepositOffer(message, history) {
    const basis = getDepositBasisFromContext(message, history);
    if (!basis) return null;

    return {
        depositType: basis.type,
        wallBedModelLabel: basis.wallBedModelLabel,
        grandTotal: basis.total,
        depositPercent: DEPOSIT_PERCENT,
        depositAmount: round2(basis.total * DEPOSIT_PERCENT / 100)
    };
}

// Returns an array of suspicious RM figures found in the reply that don't exist
// anywhere in the real catalog AND weren't stated by the customer themselves
// (so echoing back a customer's own stated budget is never treated as hallucination),
// AND aren't a live cabinetry-estimate figure computed from their own measurements.
function findHallucinatedPrices(reply, userMessage, extraKnownAmounts = []) {
    const replyAmounts = extractAmounts(reply);
    const userAmounts = extractAmounts(userMessage || '');
    const allowedFromContext = [...userAmounts, ...extraKnownAmounts];
    const suspicious = [];
    for (const val of replyAmounts) {
        if (!isKnownAmount(val, allowedFromContext)) suspicious.push(val.toFixed(2));
    }
    return suspicious;
}

const SAFE_FALLBACK_REPLY = "I want to make sure I give you accurate pricing rather than guess — let me connect you with our team directly. Please reach out on **WhatsApp** at +60 12-568 4568 and they'll confirm the exact options and prices for you. Is there anything else I can help with in the meantime?";

// Backstop for the CRITICAL — IMAGES system-prompt rule: strips any sentence
// that still claims an inability to show/display/send a photo, in case the
// model slips one through despite the instruction (same "verify in code,
// don't just trust the prompt" principle as findHallucinatedPrices above).
const IMAGE_DISCLAIMER_SENTENCE = /\b(can'?t|cannot|unable to|don'?t have|do not have|no way to)\b[^.!?]{0,60}\b(images?|photos?|pictures?)\b|\b(images?|photos?|pictures?)\b[^.!?]{0,60}\b(can'?t|cannot|unable|not available|not possible|aren'?t available)\b/i;

function stripImageDisclaimers(text) {
    // Split on sentence-ending punctuation followed by whitespace. This
    // intentionally does NOT split on periods inside numbers like "3,219.30"
    // since there's no whitespace directly after that period.
    const sentences = text.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter(s => !IMAGE_DISCLAIMER_SENTENCE.test(s));
    if (kept.length < sentences.length) {
        const removed = sentences.filter(s => IMAGE_DISCLAIMER_SENTENCE.test(s));
        console.warn('Stripped image-disclaimer sentence(s) from reply:', removed.join(' | '));
    }
    return kept.join(' ').trim();
}

// ── Test-only named exports ─────────────────────────────────────
// These are the exact same function references used by the handler above —
// exporting them changes no behavior, it just lets test/*.test.js exercise
// this internal logic directly instead of only through the full HTTP
// handler (which would require mocking the Gemini API for every test).
export {
    getRelevantKnowledge,
    buildSystemPrompt,
    extractCabinetryDimensions,
    extractSelectedWallBedModel,
    extractSelectedWallBedPricing,
    getCabinetryEstimateFromContext,
    computeCabinetryAllowedAmounts,
    buildCabinetryEstimateBlock,
    hasPriceIntent,
    hasCabinetryPriceIntent,
    hasCabinetryIntent,
    getDepositBasisFromContext,
    DEPOSIT_TYPE_WITH_CABINETRY,
    DEPOSIT_TYPE_WALLBED_ONLY,
    depositIncludesCabinets,
    depositTypeLabel,
    detectMuranoCeilingConflict,
    buildMuranoCeilingWarningBlock,
    convertToFeet,
    findHallucinatedPrices,
    isKnownAmount,
    getGeminiApiKeys,
    callGeminiWithFallback,
    MASTER_PRICE_LIST,
    KNOWLEDGE_MODULES,
    BASIC_FURNITURE_COMPANION_KEYS,
    MURANO_MIN_CEILING_FT,
    computeDepositOffer,
    DEPOSIT_PERCENT
};

// ── Main handler ──────────────────────────────────────────────
export default async function handler(req, res) {

    // ── CORS headers ──────────────────────────────────────────
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // ── Read API keys ─────────────────────────────────────────
    const apiKeys = getGeminiApiKeys();

    if (apiKeys.length === 0) {
        console.error('No Gemini API keys set — configure GEMINI_API_KEY in Vercel');
        return res.status(500).json({
            error: 'Server configuration error — API key missing'
        });
    }

    // ── Validate request body ─────────────────────────────────
    const { message, history } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message is required' });
    }

    // ── Build & send Gemini request ───────────────────────────
    try {
        const requestBody = {
            model: GEMINI_MODEL,
            messages: [
                { role: 'system', content: buildSystemPrompt(message, history) },
                ...toGeminiHistory(history || []),
                { role: 'user', content: message.trim() }
            ],
            // temperature/top_p deliberately omitted -- confirmed via Google's
            // own docs: no longer recommended for any Gemini 3.x model.
            //
            // max_completion_tokens: Gemini 3.x models spend part of this
            // budget on internal "thinking" before writing the visible reply,
            // and thinking + visible output share ONE pool -- unlike some
            // other providers, the thinking cost is not separate from this cap.
            // Per Google's OpenAI-compat docs, reasoning_effort "low" maps to
            // roughly a 1,000-token thinking budget. The previous value here
            // (800) was smaller than that alone, so on anything non-trivial
            // the model could exhaust the entire budget mid-thought and never
            // get to write the answer -- this is the actual cause of replies
            // getting cut off. Raised well above the thinking budget so there's
            // real headroom left for the reply itself (~120 words ≈ 200 tokens,
            // more if a cabinetry estimate breakdown is included).
            max_completion_tokens: 3000,
            // Flash-family Gemini 3.x models reportedly also accept "minimal"
            // (even lower thinking budget than "low"), per third-party reports —
            // but only low/medium/high appear in Google's own official docs, so
            // sticking with the confirmed value here rather than risking a
            // rejected request on an unverified one. Worth live-testing
            // reasoning_effort: 'minimal' separately once this fix is confirmed
            // working, if you want to trim cost/latency further.
            reasoning_effort: 'low',
            stream: false
        };

        let reply = null;
        let lastError = null;

        try {
            reply = await callGeminiWithFallback(apiKeys, requestBody);
        } catch (err) {
            lastError = err;
        }

        // Post-processing chain for a successful reply, in order: price
        // guardrail (with one regeneration before giving up), then the
        // image-disclaimer strip, then image/deposit attachment. Every step
        // here is the "verify in code, don't just trust the prompt" backstop
        // for a rule the system prompt already states — the prompt asks, this
        // enforces.
        if (reply) {
            const cabinetryAllowedAmounts = computeCabinetryAllowedAmounts(message, history);
            const badPrices = findHallucinatedPrices(reply, message, cabinetryAllowedAmounts);

            if (badPrices.length > 0) {
                console.error('Reply contained unrecognized price(s):', badPrices.join(', '), '| regenerating once before falling back | original reply:', reply);

                // One retry before giving up — the model is non-deterministic, so a
                // fresh generation against the exact same request often just doesn't
                // repeat the same slip. Only fall back to SAFE_FALLBACK_REPLY if the
                // retry ALSO comes back with an unrecognized price (or fails outright).
                let retryReply = null;
                try {
                    retryReply = await callGeminiWithFallback(apiKeys, requestBody);
                } catch (err) {
                    console.error('Retry-before-fallback attempt itself failed:', err.status || 'network', err.details || err.message);
                }

                if (retryReply) {
                    const retryBadPrices = findHallucinatedPrices(retryReply, message, cabinetryAllowedAmounts);
                    if (retryBadPrices.length === 0) {
                        reply = retryReply;
                    } else {
                        console.error('Retry reply STILL contained unrecognized price(s):', retryBadPrices.join(', '), '| falling back | retry reply:', retryReply);
                        reply = SAFE_FALLBACK_REPLY;
                    }
                } else {
                    reply = SAFE_FALLBACK_REPLY;
                }
            }

            reply = stripImageDisclaimers(reply);
            const images = getRelevantImages(message, history);
            // null unless a full wall bed + cabinetry grand total is actually
            // being shown this turn — see computeDepositOffer() above. The
            // widget renders this as a real button; the AI never generates
            // it or the payment link itself (see Section 5 of the Stripe
            // proposal — the model is barred from writing links at all).
            const deposit = computeDepositOffer(message, history);
            return res.status(200).json({ success: true, message: reply, images, deposit });
        }

        const status = lastError?.status && lastError.status >= 400 ? lastError.status : 502;
        return res.status(status === 429 ? 502 : status).json({
            error: 'Gemini API error',
            details: lastError?.details || lastError?.message || 'All API keys failed'
        });

    } catch (err) {
        console.error('Handler error:', err.message || err);
        return res.status(500).json({
            error: 'Internal server error',
            details: err.message
        });
    }
}