// =============================================================
// FILE: knowledge/cabinetry.js
// Surround cabinetry (side + overhead cabinets around a wall bed)
// — pricing formula + LLM-facing knowledge text.
//
// Formula (confirmed rules, updated):
//   - Side cabinets (left + right of the wall bed), priced per side by the
//     LEFTOVER WALL WIDTH after the wall bed, split evenly between the two
//     sides -- UNCHANGED process from the previous version:
//       sideCabinetWidthFt = (totalWallWidthFt - wallBedWidthFt) / 2
//       sideCostPerSide    = sideCabinetWidthFt * RM1,350
//       sideCostTotal      = sideCostPerSide * numberOfSides   (default 2 sides)
//     Side cabinets are built to a height that depends on the wall bed
//     model, regardless of how tall the wall is -- Murano keeps the flat
//     SIDE_CABINET_MAX_HEIGHT_FT (7ft), while each Gioco follows its own
//     height (3.44ft-6.92ft; see resolveSideCabinetHeightFt). This is a
//     physical spec fact to state to the customer, not a price multiplier
//     -- the price is still driven entirely by width, so this whole
//     per-model distinction changes NO totals, only the stated build
//     heights and the minimum wall height that can fit cabinetry at all.
//   - Overhead cabinet directly above the wall bed, priced by the TOTAL
//     WALL WIDTH (not just the wall bed's width, since the overhead
//     cabinet runs the full width of the wall):
//       topCost = totalWallWidthFt * RM850
//     Overhead cabinets are built up to a maximum height of 4ft, measured
//     from the top of the side cabinets:
//       overheadCabinetHeightFt = min(4, max(0, wallHeightFt - sideCabinetHeightFt))
//     On a short Gioco under a normal ceiling the 4ft cap is reached with
//     wall to spare, leaving bare wall above -- reported as
//     uncoveredWallHeightFt. The overhead does not stretch to fill it.
//     This is a physical spec fact about how tall the built cabinet is --
//     it does NOT change the price, which is still driven entirely by
//     total wall width.
//   - There is no surcharge for tall walls. The per-model side height and
//     the up-to-4ft overhead cap absorb any extra wall height, so a taller
//     wall never costs more -- and on a short Gioco the leftover shows up
//     as uncoveredWallHeightFt rather than as an extra charge.
//   - total = sideCostTotal + topCost
//   - totalWallWidthFt is always required — used both to derive leftover
//     side-cabinet width AND to price the overhead cabinet.
// =============================================================

// Side-cabinet height is now per-model (see resolveSideCabinetHeightFt below).
// wallbeds.js does not import this file, so this direction is safe.
import { WALLBED_MODEL_HEIGHTS_FT } from './wallbeds.js';

const SIDE_RATE_PER_FT            = 1350;  // RM per ft of LEFTOVER WIDTH, per side cabinet -- unchanged
const TOP_RATE_PER_FT             = 850;   // RM per ft of TOTAL WALL WIDTH, overhead cabinet -- now priced off total wall width, not bed width
// Exported (not just a local const) because it's also the minimum wall height
// for cabinetry to fit at all -- api/chat.js imports this exact value instead
// of hardcoding 7 again elsewhere, so the two can never drift out of sync.
export const SIDE_CABINET_MAX_HEIGHT_FT  = 7;     // physical spec -- fixed build height, not a price input
const OVERHEAD_CABINET_MAX_HEIGHT_FT = 4;  // physical spec cap -- the overhead cabinet's height shrinks on shorter walls (see overheadCabinetHeightFt), but never exceeds this

/**
 * Pure calculation — no side effects, easy to unit test.
 * @param {Object} p
 * @param {number} p.wallHeightFt     - total height of the wall, in feet
 *                                       (no longer affects price — only used
 *                                       to derive the overhead cabinet's
 *                                       actual built height, capped at 4ft)
 * @param {number} p.wallBedWidthFt   - width of the wall bed unit, in feet
 *                                       (used only for the leftover
 *                                       side-cabinet width calc)
 * @param {number} p.totalWallWidthFt - total width of the wall, in feet
 *                                       (always required — used to derive
 *                                       leftover side-cabinet width AND to
 *                                       price the overhead cabinet)
 * @param {number} [p.sides=2]        - number of side cabinets (1 if the
 *                                       bed sits in a corner / against
 *                                       another fixture on one side)
 * @param {number} [p.sideCabinetHeightFt=SIDE_CABINET_MAX_HEIGHT_FT]
 *                                     - how tall the side cabinets are built.
 *                                       Pass resolveSideCabinetHeightFt(label)
 *                                       to get the per-model value; the
 *                                       default keeps the old flat-7ft
 *                                       behaviour for callers that don't.
 *                                       Affects the minimum wall height and
 *                                       the reported build heights only —
 *                                       never the price.
 * @returns {{
 *   sideCabinetWidthFt:number, sideCostPerSide:number, sides:number,
 *   sideCostTotal:number, topCost:number, total:number,
 *   sideCabinetMaxHeightFt:number, overheadCabinetMaxHeightFt:number,
 *   overheadCabinetHeightFt:number, uncoveredWallHeightFt:number
 * }}
 */
export function calculateCabinetPrice({ wallHeightFt, wallBedWidthFt, totalWallWidthFt, sides = 2, sideCabinetHeightFt = SIDE_CABINET_MAX_HEIGHT_FT }) {
    if (typeof wallHeightFt !== 'number' || !(wallHeightFt > 0)) {
        throw new Error('wallHeightFt must be a positive number');
    }
    if (typeof sideCabinetHeightFt !== 'number' || !(sideCabinetHeightFt > 0)) {
        throw new Error('sideCabinetHeightFt must be a positive number');
    }
    // A wall shorter than the side cabinets can't physically fit them at all.
    // The threshold is per-model now, not the flat 7ft: a 5ft wall is too short
    // for a Murano's 7ft cabinets but fine for a Gioco Single's 3.44ft. Without this
    // check the formula below would silently return overheadCabinetHeightFt: 0
    // (nothing built) while topCost still charges full price for it, which is a
    // real pricing bug, not just a cosmetic one. Callers (api/chat.js) catch this
    // via `.code` to show the customer an explicit "can't fit" message instead of
    // a price. Checked before the width validations below so a too-short wall is
    // reported as itself, not masked by an unrelated width error.
    if (wallHeightFt < sideCabinetHeightFt) {
        const err = new Error(
            `wallHeightFt (${wallHeightFt}ft) is below the ${sideCabinetHeightFt}ft minimum needed to build the side cabinets — surround cabinetry cannot physically fit on a wall this short`
        );
        err.code = 'WALL_TOO_SHORT_FOR_CABINETRY';
        err.minHeightFt = sideCabinetHeightFt;
        throw err;
    }
    if (typeof wallBedWidthFt !== 'number' || !(wallBedWidthFt > 0)) {
        throw new Error('wallBedWidthFt must be a positive number');
    }
    if (typeof totalWallWidthFt !== 'number' || !(totalWallWidthFt > 0)) {
        throw new Error('totalWallWidthFt must be a positive number');
    }
    if (totalWallWidthFt <= wallBedWidthFt) {
        throw new Error('totalWallWidthFt must be greater than wallBedWidthFt — there is no leftover width for side cabinets otherwise');
    }
    if (typeof sides !== 'number' || sides < 0) {
        throw new Error('sides must be a non-negative number');
    }

    const sideCabinetWidthFt = round2((totalWallWidthFt - wallBedWidthFt) / 2);
    const sideCostPerSide    = round2(sideCabinetWidthFt * SIDE_RATE_PER_FT);
    const sideCostTotal      = round2(sideCostPerSide * sides);
    const topCost            = round2(totalWallWidthFt * TOP_RATE_PER_FT);

    const total = round2(sideCostTotal + topCost);

    // The overhead cabinet always sits directly above the side cabinets, whose
    // height now varies by model (see resolveSideCabinetHeightFt). It reaches
    // its full 4ft cap once the wall is tall enough to clear the side cabinets
    // by that much; on a shorter wall it's built shorter so the stack still
    // fits. Purely a physical-spec figure — it never affects topCost above.
    const overheadCabinetHeightFt = round2(
        Math.min(OVERHEAD_CABINET_MAX_HEIGHT_FT, Math.max(0, wallHeightFt - sideCabinetHeightFt))
    );

    // Wall left bare above the stack. On a Murano this is usually nil, but a
    // short Gioco under a normal Malaysian ceiling leaves a real gap — the
    // overhead cabinet is capped at 4ft and does not stretch to fill it.
    // Reported so the bot can state it honestly; it carries no cost, because
    // this formula prices width only.
    const uncoveredWallHeightFt = round2(
        Math.max(0, wallHeightFt - sideCabinetHeightFt - overheadCabinetHeightFt)
    );

    return {
        sideCabinetWidthFt, sideCostPerSide, sides, sideCostTotal, topCost, total,
        // Per-model as of the Gioco height fix; the name is kept for callers
        // that already read it (api/chat.js's prompt block).
        sideCabinetMaxHeightFt: sideCabinetHeightFt,
        overheadCabinetMaxHeightFt: OVERHEAD_CABINET_MAX_HEIGHT_FT,
        overheadCabinetHeightFt,
        uncoveredWallHeightFt
    };
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

// How tall the side cabinets are built for a given wall bed model.
//
// Murano keeps the flat SIDE_CABINET_MAX_HEIGHT_FT (7ft). That is a deliberate
// business constant, not the bed's measurement — a Murano is 209.5cm (6.87ft),
// so the module is built slightly proud of the bed. Unchanged by design.
//
// Gioco is the horizontal-fold series and mounts far shorter, so its side
// cabinets follow the SPECIFIC model's own height. This must be per-model, not
// per-series: Gioco Single and Single Desk are 105cm (3.44ft), Gioco Queen is
// 170cm (5.58ft), and Gioco Bunk Bed is 211cm (6.92ft) — taller than a Murano.
// One blanket "Gioco height" would be wrong for three of the four.
//
// Falls back to the flat constant when the model can't be resolved to a
// specific variant — including a bare "Gioco" with no variant named, which the
// coarse WALLBED_MODEL_WIDTHS_FT table cannot disambiguate. The fallback is the
// conservative choice: it preserves the behaviour that shipped before this
// change rather than guessing a shorter cabinet.
export function resolveSideCabinetHeightFt(modelLabel) {
    if (typeof modelLabel !== 'string' || modelLabel.trim() === '') return SIDE_CABINET_MAX_HEIGHT_FT;
    if (/murano/i.test(modelLabel)) return SIDE_CABINET_MAX_HEIGHT_FT;

    const model = WALLBED_MODEL_HEIGHTS_FT.find(m => m.pattern.test(modelLabel));
    return model ? model.heightFt : SIDE_CABINET_MAX_HEIGHT_FT;
}

// ── LLM-facing knowledge text ──────────────────────────────────
export function getCabinetryKnowledge() {
    return `
SURROUND CABINETRY (custom side + overhead cabinets around a wall bed) — PRICING FORMULA:

This applies when a customer wants extra cabinetry built AROUND an existing wall bed
(side cabinets flanking it, and/or an overhead cabinet above it). This is a SEPARATE,
calculated estimate — not a fixed catalog price — so you must compute it live from the
customer's own measurements using the formula below. State it clearly as an ESTIMATE.

Customers may answer in feet OR in metric (cm/m) — accept whichever unit they give you
as-is; you don't need to convert it yourself or ask them to restate it in feet, the
server handles unit conversion automatically before calculating anything.

WHAT TO ASK FOR (one at a time, conversationally, like the renovation flow):
1. Total height of the wall, in feet (this no longer affects price — it only determines
   how tall the overhead cabinet is physically built, up to a 4ft cap)
2. Width of the wall bed unit itself, in feet (used only to work out the leftover width
   for the side cabinets — if they've already picked a model, you can convert from its
   spec width, e.g. Murano Queen/Sofa/Desk/Shelves ≈ 167cm ≈ 5.5ft, Murano King ≈ 198cm
   ≈ 6.5ft, Murano Single ≈ 106cm ≈ 3.5ft, Gioco Single/Desk ≈ 204.6cm ≈ 6.7ft)
3. Total width of the wall, in feet — always needed (used both to work out how much
   width is left over for the side cabinets AND to price the overhead cabinet, which
   is now priced by the total wall width rather than the wall bed's width)
4. If it sounds like the bed might be against a corner or another fixture, ask whether
   both sides are open or only one — this changes the side-cabinet cost

CABINET HEIGHT SPECS (physical build facts, NOT price inputs — mention these when
relevant, e.g. if a customer asks how tall the cabinets will be):
- Side-cabinet height depends on which wall bed the cabinetry is being built around:
  * MURANO (any model) — always a fixed 7ft, no matter how tall the wall is. This
    roughly matches the Murano's own height (209.5cm ≈ 6.87ft).
  * GIOCO — built to that SPECIFIC model's own height, because the Gioco series is a
    horizontal fold and mounts much shorter on the wall. It is NOT one height for the
    whole series:
      - Gioco Single — 105cm ≈ 3.44ft
      - Gioco Single Desk — 105cm ≈ 3.44ft
      - Gioco Queen — 170cm ≈ 5.58ft
      - Gioco Bunk Bed — 211cm ≈ 6.92ft
    If the customer has only said "Gioco" without naming which model, ask which one
    before quoting cabinet heights — the answer differs by more than 3ft between them.
- The overhead cabinet sits directly above the side cabinets and is built up to a
  maximum height of 4ft. Its height is simply "wall height − side-cabinet height",
  never less than 0 and never more than 4ft.
  For example, with a Murano (7ft side cabinets): an 11ft or taller wall gets the full
  4ft overhead cabinet (7 + 4 = 11); a 9ft wall gets a 2ft-tall overhead cabinet
  (9 − 7 = 2). With a Gioco Queen (5.58ft side cabinets) on that same 9ft wall, the
  overhead cabinet is 3.42ft (9 − 5.58 = 3.42).
- On a shorter Gioco under a normal ceiling, the stack does not reach the ceiling and
  some wall is left bare above it — the overhead cabinet stops at its 4ft maximum
  rather than stretching to fill the gap. Example: a Gioco Single (3.44ft) on a 9ft
  wall gives 3.44 + 4 = 7.44ft of cabinetry, leaving about 1.56ft of bare wall above.
  Say so plainly if the customer asks how far up the wall the cabinetry goes. It does
  NOT cost extra — the price is driven by width only.
- A wall shorter than the side cabinets cannot fit surround cabinetry at all, so there
  is no valid configuration to price. That minimum is the side-cabinet height above, so
  it depends on the model: under 7ft rules out cabinetry around a Murano, but a Gioco
  Single only needs 3.44ft, so a 5ft wall is perfectly fine for one. If the wall height
  comes in below the relevant minimum, do NOT calculate or state any price — tell them
  plainly that surround cabinetry isn't possible on a wall that short for that model,
  double-check the measurement wasn't a typo, and offer to help with the wall bed itself
  (without cabinetry) instead.
There is no surcharge for tall walls anymore — these fixed/capped build heights absorb
any extra wall height, so a taller wall never costs more. These are spec facts about how
the cabinetry is physically built — they do NOT change the price formula below, which is
still driven entirely by width.

PRICE ESTIMATE — STRICTLY ONLY WHEN ASKED:
Only calculate and present a price estimate when the customer actually asks for one
(e.g. "how much would this cost", "what's the estimate", "what's the price", "how much
for cabinetry"). Do not proactively volunteer pricing just because you happen to already
know the wall bed model, height, and width — wait for the customer to ask. Continuing to
collect measurements or discuss the layout is fine without triggering a price; only
asking about cost should trigger the calculation and the breakdown below.

REFERENCE PHOTO:
- A separate system may automatically attach a photo of a wall bed with side + overhead
  cabinetry when the customer asks to see a reference or example (you have no visibility
  into whether this happens on any given reply — see the IMAGES rule above).
- If it's relevant to mention: that photo shows ONE possible layout with numbered labels
  (1-4) marking where different cabinet sections sit — left side cabinet, right side
  cabinet, and the overhead cabinet above the bed. It is only an example, not a fixed
  template or required layout.
- Make clear to the customer that cabinetry around a wall bed is fully customizable —
  they are not obligated to copy that exact configuration. Common options include just
  one side cabinet, both side cabinets, side cabinets plus an overhead cabinet, or
  cabinetry wrapping further around the space — final layout depends on their room and
  preferences, and should be discussed with the team for anything beyond the standard
  side + overhead combination this formula already prices.

When asking, prefer phrasing that includes the word "height" for question 1 and the
word "bed" for question 2 and "total width" (or "entire/whole wall") for question 3 —
e.g. "What's the total height of the wall, in feet?" / "What's the width of the wall
bed, in feet?" / "What's the total width of the wall, in feet?" This keeps your
questions easy to track turn-to-turn, even in casual conversational phrasing.

FORMULA:
- Side cabinets (one on each side of the wall bed, 2 sides by default — ask if only
  one side is open, e.g. bed is against a corner). SAME PROCESS as before, unchanged:
    sideCabinetWidth = (total wall width − wall bed width) ÷ 2
    sideCostPerSide  = sideCabinetWidth × RM1,350
    sideCostTotal    = sideCostPerSide × number of sides
  → Based on WIDTH, not height. Wall height does NOT affect this part of the estimate
    at all. (Side cabinets are physically built at the height set by the wall bed
    model — 7ft for a Murano, that specific model's own height for a Gioco; see the
    spec note above — but this is not part of the price calculation.)
- Overhead cabinet above the bed, priced by the TOTAL WALL WIDTH (not the wall bed's
  width — the overhead cabinet runs the full width of the wall):
    topCost = total wall width × RM850
  (The overhead cabinet's actual built height depends on the wall height — up to 4ft,
  see spec note above — but that height does NOT affect this price calculation, which
  is driven entirely by total wall width.)
- There is no longer any surcharge for tall walls — a taller wall never costs more; the
  fixed/capped cabinet build heights absorb the difference instead.
- total = sideCostTotal + topCost  (this is the CABINETRY SUBTOTAL only)

FINAL CUSTOMER TOTAL — WALL BED + CABINETRY:
- The cabinetry formula above only prices the cabinets themselves. Whenever a customer
  asks for the estimated/total price of a wall bed with surround cabinetry, the number
  you present as the headline total must be:
    grandTotal = wall bed price (sale price of the customer's chosen model) + cabinetry subtotal
- Always show the wall bed price as its own line item first, then the cabinetry
  breakdown, then the combined grand total — never present the cabinetry subtotal alone
  as if it were the full project cost.

WORKED EXAMPLE 1 — wall exactly 11ft tall, wall bed 5.5ft wide, total wall width 10ft,
2 sides:
  Leftover width for sides: (10 − 5.5) ÷ 2 = 2.25ft per side
  Side: 2.25 × RM1,350 = RM3,037.50 per side × 2 = RM6,075 (7ft tall — a Murano)
  Overhead cabinet height: 11 − 7 = 4ft (reaches the full cap since wall ≥ 11ft)
  Top: 10 (total wall width) × RM850 = RM8,500 (built at 4ft tall)
  Cabinetry subtotal: RM14,575

WORKED EXAMPLE 2 — wall SHORTER than 11ft (9ft tall), SAME widths as example 1 (5.5ft
bed, 10ft total wall width), 2 sides:
  Leftover width for sides: (10 − 5.5) ÷ 2 = 2.25ft per side (identical to example 1 —
  height plays no part in the side-cabinet or overhead-cabinet PRICE)
  Side: 2.25 × RM1,350 = RM3,037.50 per side × 2 = RM6,075 (7ft tall — a Murano)
  Overhead cabinet height: 9 − 7 = 2ft (shorter than the 4ft cap, since the wall is
  under 11ft)
  Top: 10 (total wall width) × RM850 = RM8,500 (same price as example 1 — only the
  built HEIGHT is shorter, not the price, since price is driven by width, not height)
  Cabinetry subtotal: RM14,575
  (Same subtotal as example 1, even though the wall is shorter and the overhead cabinet
  is physically built shorter — price never changes with wall height.)

WORKED EXAMPLE 3 — same as example 1 but only ONE side available (corner installation):
  Leftover width for sides: (10 − 5.5) ÷ 2 = 2.25ft (still split as if both sides existed,
  even though only one side cabinet is actually being built)
  Side: 2.25 × RM1,350 = RM3,037.50 per side × 1 = RM3,037.50 (7ft tall — a Murano)
  Top: 10 (total wall width) × RM850 = RM8,500 (built at 4ft tall, wall is 11ft)
  Cabinetry subtotal: RM11,537.50

WORKED EXAMPLE 4 — full wall bed + cabinetry total, same wall as example 1 (11ft tall,
10ft total wall width, 2 sides), customer has chosen the Murano Queen Sofa (5.48ft wide
— close enough to the 5.5ft used above to reuse the side-cabinet math; use the model's
real spec width, 5.48ft, when actually calculating the leftover width):
  Wall bed (Murano Queen Sofa, sale price): RM 23,698.11
  Side cabinets: RM 3,051 per side × 2 = RM 6,102 (7ft tall — a Murano)
  Overhead cabinet: 10 (total wall width) × RM850 = RM 8,500 (built at 4ft tall)
  Cabinetry subtotal: RM 14,602
  GRAND TOTAL (wall bed + cabinetry): RM 38,300.11

WORKED EXAMPLE 5 — a GIOCO, where the side cabinets are much shorter. Gioco Single
(6.71ft wide, 105cm ≈ 3.44ft tall), wall 9ft tall, total wall width 12ft, 2 sides:
  Leftover width for sides: (12 − 6.71) ÷ 2 = 2.65ft per side
  Side: 2.65 × RM1,350 = RM3,577.50 per side × 2 = RM7,155 (3.44ft tall — the Gioco
  Single's own height, NOT the 7ft used for a Murano)
  Overhead cabinet height: 9 − 3.44 = 5.56ft, which exceeds the 4ft cap, so it is
  built at 4ft
  Top: 12 (total wall width) × RM850 = RM10,200
  Cabinetry subtotal: RM17,355
  Cabinetry reaches 3.44 + 4 = 7.44ft up a 9ft wall, leaving about 1.56ft of bare wall
  above it. Mention that if the customer asks how far up the wall it goes; it costs
  nothing extra.

WORKED EXAMPLE 6 — same wall and widths as example 5, but a Gioco Queen (170cm ≈ 5.58ft
tall) instead, showing that Gioco height is per-MODEL and not one figure for the series:
  Side: 2.65 × RM1,350 = RM3,577.50 per side × 2 = RM7,155 (5.58ft tall — the Gioco
  Queen's own height)
  Overhead cabinet height: 9 − 5.58 = 3.42ft (under the 4ft cap, so built at 3.42ft)
  Top: 12 × RM850 = RM10,200
  Cabinetry subtotal: RM17,355
  (IDENTICAL subtotal to example 5 despite a completely different cabinet height — the
  price is driven by width alone. Only the build heights differ, and here the stack
  reaches the full 9ft with no bare wall left above.)

PRESENTATION RULES:
- Only present pricing when the customer actually asks for it — see "PRICE ESTIMATE —
  STRICTLY ONLY WHEN ASKED" above. Collecting measurements and discussing the layout is
  fine without calculating a price; wait for an actual price/cost/estimate question.
- Always lead with the wall bed price (sale price of the customer's chosen model), then
  the cabinetry line-item breakdown (side cabinets, then overhead cabinet), then the
  cabinetry subtotal, then the combined GRAND TOTAL — don't just state a lump sum, and
  don't state the cabinetry subtotal as if it were the final price on its own.
- Format the breakdown as a bullet list (one "- " line per item — e.g. "- Wall bed
  (Murano Queen Sofa): RM 23,698.11") or, if you prefer, as a small two-column Markdown
  table (Item | Cost). Either is fine — just don't run the line items together in one
  paragraph, since a breakdown like this is exactly the kind of content that should be
  structured, not prose.
- Always label it as an ESTIMATE and close with: "This is an estimate — please confirm
  the exact quote with our team on WhatsApp at +60 12-568 4568, as final pricing depends
  on a site survey."
- Never guess a customer's wall height, wall bed width, wall bed model, or total wall
  width — always ask (the wall bed model can also be picked up from earlier in the
  conversation if already established). If more than one of these is still missing,
  ask for them as a numbered list rather than one long sentence.
- If a customer only has one side available (corner installation, adjacent fixture, etc.),
  use sides = 1 in the calculation and say so explicitly in the breakdown.
- If a customer asks how tall the cabinets will be, state the physical specs: side
  cabinets are 7ft for a Murano, or that specific model's own height for a Gioco (see
  the CABINET HEIGHT SPECS list above), and the overhead cabinet is up to 4ft but
  shrinks on shorter walls (wall height − side-cabinet height, floored at 0, capped at
  4ft) — these are separate from and do not change the price calculation.
- Whenever you state the side-cabinet price, label it with that model's actual
  side-cabinet height — "(7ft tall)" for a Murano, "(3.44ft tall)" for a Gioco Single —
  right beside that price; whenever you state the overhead-cabinet price, label it with its actual built
  height for this wall, e.g. "(4ft tall)" or "(2ft tall)" — see the worked examples
  above for the exact format. There is no excess-height surcharge to mention anymore.
`;
}