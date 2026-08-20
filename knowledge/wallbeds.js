// Structured width lookup — single source of truth for both the knowledge
// text below AND the cabinetry price calculator in api/chat.js, so the two
// can never drift out of sync with each other. Order matters: more specific
// patterns (Single/King) are checked before the broader "Queen"/"Gioco"
// patterns that also match their Sofa/Desk/Shelves/other variants.
export const WALLBED_MODEL_WIDTHS_FT = [
    { pattern: /murano\s*single/i, widthFt: 3.48, label: 'Murano Single' },
    { pattern: /murano\s*king/i,   widthFt: 6.50, label: 'Murano King' },
    { pattern: /murano\s*queen/i,  widthFt: 5.48, label: 'Murano Queen' }, // covers Queen, Queen Sofa, Queen Desk, Queen Shelves — same width
    { pattern: /gioco/i,           widthFt: 6.71, label: 'Gioco' }         // covers all Gioco models — same width regardless of variant
];

// Structured price lookup — single source of truth for both the knowledge
// text below AND the "wall bed + cabinetry" combined-estimate calculation in
// api/chat.js. This is intentionally MORE granular than WALLBED_MODEL_WIDTHS_FT
// above: several models share the same width (e.g. Murano Queen / Queen Sofa /
// Queen Desk / Queen Shelves are all 167cm wide) but have very different
// prices, so width-category matching alone is not precise enough for pricing.
//
// Each "bare" pattern (e.g. Murano Queen, Gioco Single) uses a negative
// lookahead so it does NOT match when a more specific variant word follows
// (sofa/desk/shelves for Murano Queen, desk for Gioco Single) — this makes
// match order irrelevant, since the bare pattern simply won't fire on text
// that actually names a more specific variant.
export const WALLBED_MODEL_PRICING = [
    { pattern: /murano\s*queen\s*sofa/i,             label: 'Murano Queen Sofa',    retail: 33854.44, sale: 23698.11 },
    { pattern: /murano\s*queen\s*desk/i,             label: 'Murano Queen Desk',    retail: 24687.78, sale: 17281.45 },
    { pattern: /murano\s*queen\s*shelves/i,          label: 'Murano Queen Shelves', retail: 22976.67, sale: 16083.67 },
    { pattern: /murano\s*single/i,                   label: 'Murano Single',        retail: 17232.22, sale: 12062.55 },
    { pattern: /murano\s*king/i,                     label: 'Murano King',          retail: 20269.22, sale: 15285.45 },
    { pattern: /murano\s*queen(?!\s*(sofa|desk|shelves))/i, label: 'Murano Queen',   retail: 19102.22, sale: 14371.55 },
    { pattern: /gioco\s*single\s*desk/i,             label: 'Gioco Single Desk',    retail: 25054.44, sale: 17538.11 },
    { pattern: /gioco\s*queen/i,                     label: 'Gioco Queen',          retail: 20654.45, sale: 15458.12 },
    { pattern: /gioco\s*single(?!\s*desk)/i,         label: 'Gioco Single',         retail: 18698.89, sale: 13089.22 },
    { pattern: /gioco\s*bunk/i,                      label: 'Gioco Bunk Bed',       retail: 33365.56, sale: 26692.45 }
];

export function getWallBedKnowledge() {
    return `
WALL BED PRODUCTS — PRICING & DIMENSIONS:

MURANO SERIES — Vertical Wall Bed (Standard ceiling 2.4m and above)
- Mechanism: European compressed air piston — soft open, soft close
- Load capacity: 200kg | Up to 10,000 open/close cycles
- Includes: 10-inch DP Tech Double Posture Coil Mattress
- Best for: Standard ceilings (2.4m+), living rooms, guest rooms

MURANO MODELS:

[Internal note — do not quote or paraphrase this paragraph to the customer]: Murano Queen, Murano Queen Sofa, Murano Queen Desk, and Murano Queen Shelves are four alternate configurations of the same queen-size wall bed unit — a customer picks ONE configuration only, and they cannot be combined, paired, or stacked (e.g. Murano Queen Shelves cannot be "added" to a Murano Queen or Murano Queen Sofa — Shelves IS the configuration, not an accessory). Murano Single and Murano King only exist in the plain configuration (no Sofa/Desk/Shelves variant). A SEPARATE free-standing cabinet or wardrobe next to the wall bed is a different product — see WARDROBE & STORAGE SOLUTIONS instead. Only surface this exclusivity rule if the customer explicitly asks about combining two named variants; never volunteer it otherwise.

* Murano Queen
  - Price: RM 19,102.22 (retail) | RM 14,371.55 (sale)
  - Width: 167cm | Height: 209.5cm | Depth Closed: 45cm | Depth Opened: 220cm
  - Features: Washable headboard, compressed air mechanism, safety point lock

* Murano King
  - Price: RM 20,269.22 (retail) | RM 15,285.45 (sale)
  - Width: 198cm | Height: 209.5cm | Depth Closed: 45cm | Depth Opened: 220cm
  - Features: Washable headboard, compressed air mechanism, safety point lock

* Murano Single
  - Price: RM 17,232.22 (retail) | RM 12,062.55 (sale)
  - Width: 106cm | Height: 209.5cm | Depth Closed: 45cm | Depth Opened: 220cm
  - Features: Washable headboard, compressed air mechanism, safety point lock

* Murano Queen Sofa (MOST POPULAR for living rooms) — alternate configuration, not an add-on to Murano Queen
  - Price: RM 33,854.44 (retail) | RM 23,698.11 (sale)
  - Width: 167cm | Height: 209.5cm | Depth Closed: 127cm | Depth Opened: 220cm
  - Features: 3-seater sofa hides under bed when opened, Sunbrella Performance Fabric, 5cm or 15cm armrests

* Murano Queen Desk — alternate configuration, not an add-on to Murano Queen
  - Price: RM 24,687.78 (retail) | RM 17,281.45 (sale)
  - Dimensions: Custom based on room width
  - Features: Integrated front-facing study desk, pivots flat under bed — no need to clear items

* Murano Queen Shelves — alternate configuration, not an add-on to Murano Queen
  - Price: RM 22,976.67 (retail) | RM 16,083.67 (sale)
  - Dimensions: Custom based on room width
  - Features: Integrated decorative and book shelving, customizable EDL laminate doors, built directly into the bed frame itself (not a separate cabinet)

GIOCO SERIES — Horizontal Wall Bed (Low ceiling below 2.4m or study rooms)
- Best for: Low ceilings, study rooms, narrow wall clearances
- European steel base slates, compressed air mechanism
- Includes: 10-inch DP Tech Double Posture Coil Mattress

GIOCO MODELS (each model below is a SEPARATE, independently purchasable product — unlike the Murano Queen variants, these are not configurations of one shared unit):

* Gioco Single Desk (MOST POPULAR for study rooms)
  - Price: RM 25,054.44 (retail) | RM 17,538.11 (sale)
  - Width: 204.6cm | Height: 105cm | Depth Closed: 106cm | Depth Opened: 119cm
  - Features: Synchronized desk stays perfectly level as bed folds down, max desk load 15kg, melamine white base, EDL laminate ends

* Gioco Queen
  - Price: RM 20,654.45 (retail) | RM 15,458.12 (sale)
  - Width: 204.6cm | Height: 170cm | Depth Closed: 45cm | Depth Opened: 181cm
  - Features: Horizontal fold, compressed air mechanism, soft open/close
  - Note: listed on the website storefront together with Gioco Single as one product page — confirm current price with WhatsApp before quoting if in doubt

* Gioco Single
  - Price: RM 18,698.89 (retail) | RM 13,089.22 (sale)
  - Width: 204.6cm | Height: 105cm | Depth Closed: 45cm | Depth Opened: 110cm
  - Features: Horizontal fold, ideal for very compact rooms and low ceilings

* Gioco Bunk Bed
  - Price: RM 33,365.56 (retail) | RM 26,692.45 (sale)
  - Dimensions: Custom twin-stack configuration
  - Features: Double horizontal fold, integrates with adjacent wardrobes or cabinetry

RECOMMENDATION GUIDE:
- Study room → Gioco Single Desk (desk stays usable at all times)
- Living room → Murano Queen Sofa (sofa hides under bed when opened)
- Guest room, standard ceiling → Murano Queen
- Large master bedroom → Murano King
- Low ceiling below 2.4m → Gioco Series
- Always ask: ceiling height AND room purpose before recommending

INSTALLATION:
- Professional installation included
- Site survey required before order confirmation
- Lead time: 4–16 weeks (depending on stock availability)
- Free delivery and installation within Klang Valley
- Singapore / East Malaysia: customised shipping quote required

For exact quotes and customisation, contact us on WhatsApp: +60 12-568 4568
`;
}