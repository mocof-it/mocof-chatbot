// Bedsheets, bedding, and bath knowledge — the entire "Bedsheet" menu on
// mocof.com.my (Signoria Firenze, Luxury Tencel, Egyptian Cotton, Pure Cotton,
// Accessories, Cushion, Bath). Like MOCOF Basic, this is a large, frequently-
// refreshed catalog with many colourways per line, so the text below gives the
// material tiers, thread counts, price RANGES, and representative named
// products — not every single SKU. For a specific colour/design or current
// stock not named here, direct the customer to WhatsApp or mocof.com.my rather
// than guessing a price.
//
// NOTE: every "RM X,XXX" figure below feeds the api/chat.js MASTER_PRICE_LIST
// guardrail automatically (getBedsheetKnowledge() must be added to that list),
// so keep the "RM X,XXX" format consistent — that is what lets the model quote
// these prices character-for-character without the guardrail swapping the reply
// for the WhatsApp fallback.
export function getBedsheetKnowledge() {
    return `
BEDSHEET, BEDDING & BATH PRODUCTS — MATERIALS, LINES & PRICING:

MOCOF bedding spans four material tiers — Signoria Firenze (imported), Luxury Tencel, Egyptian Cotton, and Pure Cotton — plus Accessories, Cushions, and Bath. Most lines come in multiple colourways at the same price, and most duvet/bedsheet SETS are priced as a RANGE by bed size (e.g. Queen vs King). This is a large, frequently-updated catalog: the lines and price ranges below are accurate, but for a specific colour, exact size price, or design not named here, direct the customer to WhatsApp or mocof.com.my/bed-sheet-malaysia rather than guessing.

SIGNORIA FIRENZE — Imported Italian luxury bedding (the most premium tier)
100% Egyptian cotton, very high thread count (up to 2000TC). Price per duvet cover set:
* Baccarat Duvet Cover Set — RM 6,800
* Volterra Duvet Cover Set — RM 6,800
* Giorgina / Sanremo / Raffaello Duvet Cover Sets — RM 7,500 each
* Classic PDJ / Arona / Edera PDJ / Tenuta / Roseto / Nuvola Duvet Cover Sets — RM 9,900 each
* Signoria Down Feathers Pillow — RM 6,900
Range: RM 6,800 – RM 9,900.

LUXURY TENCEL — TENCEL/lyocell fibre (cool, breathable, gentle on skin, antibacterial)
* 1600TC duvet sets — RM 2,880 – RM 4,300
  (Lilac Lavender, Olive Green Ivory, Fog Baby Blue @ RM 2,980 – RM 3,280; Khaki Ivory, White Brown, White Rose Gold, White White @ RM 2,880 – RM 3,080; Joseph Marie Aqua / Gray / White @ RM 3,400 – RM 4,300)
* 1200TC printed duvet sets — RM 1,180 – RM 2,180 (Dale, Umbra, Moonlit, Nova, Havana, Zingy, Meadow, Aura)
* Semplice 1200TC duvet sets — RM 2,099 – RM 2,499 (Ivory, Grey, Blue)

EGYPTIAN COTTON — 100% Egyptian cotton with silky treatment
* 1600TC silky duvet sets — RM 1,780 – RM 2,380 (Pebble Grey Pearl, Medium Grey Silver, Khaki Pearl, Peach Rose lines)
* Designer Edition (Fiziwoo collaboration) — RM 2,799 – RM 3,099 (White / Grey Fiziwoo)
* 1600TC silky duvet sets — RM 1,780 – RM 2,180 (White Navy Blue, White Tiffany B, White Pink, White Grey lines)
* 1200TC silky duvet sets — RM 1,580 – RM 1,980 (Coffee, Bean Green, Grey Green)
* 1200TC duvet sets — RM 880 – RM 1,780 (Begonia, Bloom, Minor)
* 1200TC fitted sheet sets — RM 698 – RM 898 (many colours); Adora fitted sets — RM 779 – RM 869
* 1200TC flat sheets — RM 1,398 (Fog Blue, Grey)
Range: RM 698 – RM 3,099.

PURE COTTON — 100% cotton, everyday value (the most budget-friendly tier)
* Premium duvet sets — RM 1,499 – RM 1,999 (Ivory Strisce, White Strisce); Mulia — RM 1,280 – RM 1,480
* Printed duvet sets — RM 688 – RM 988 (many designs: Wild Zoo, Tarlo, Shikoba, Leon, Koala, Dreamer, and more)
* Value duvet sets — RM 388 – RM 588 (many designs: Bruce, Galaxy, Lance, Orchestra, Rabbit, and more)
Range: RM 388 – RM 1,999.

ACCESSORIES — pillows, duvets/comforters, protectors, pillowcases & bolstercases
* Mulberry Silk Duvet — RM 2,380 – RM 3,380
* Microdown Duvet — RM 699 – RM 1,099 | Microdown Bolster — RM 398
* Pillow Protector — RM 398 | Bolster Protector — RM 368 | Waterproof Fitted Mattress Protector — RM 179 – RM 319
* Tencel pillowcases — RM 380 | Tencel bolstercases — RM 280
* Egyptian-cotton silk pillowcases — RM 298 | Egyptian-cotton silk bolstercases — RM 268
* Egyptian-cotton 1200TC bolstercases — RM 208
(Snowtech Memory Foam Mattress & Pillow, Euro Pillow, and various line-matched pillowcases are also carried — confirm current price on WhatsApp.)

CUSHION
* Tencel cushions (square 40×40cm / rectangle 28×48cm) — RM 199 (retail) | RM 139.30 (sale) — White Rose Gold, White Brown, White White, Khaki Ivory lines
* Egyptian-cotton 1200TC cushion covers — RM 35.70 each (many designs: Yeg, Rockett, Itri, Hibiscus, Autumn, Able, Nax, and more)

BATH
* Irya bath mats — RM 279 – RM 349 (Sherry Grey, Porter Grey, Maxi Mint, Beyaz White)
* River Turkish towels — RM 99 – RM 289 (Royal Blue, White, Beige, Gray)

MATERIAL / THREAD-COUNT GUIDE (higher TC = smoother, more durable, pricier):
- Coolest & most breathable, sensitive skin → Luxury Tencel
- Classic soft luxury, silky feel → Egyptian Cotton (1200TC everyday, 1600TC premium)
- Top-tier imported statement bedding → Signoria Firenze (up to 2000TC)
- Best value / kids' prints → Pure Cotton (from RM 388)

RECOMMENDATION GUIDE:
- Budget bedsheet → Pure Cotton value duvet set (from RM 388)
- Everyday premium → Egyptian Cotton 1200TC (from RM 698 fitted / RM 880 duvet)
- Cooling / sensitive skin → Luxury Tencel
- Luxury gift / master suite → Signoria Firenze
- Always ask: bed size (Single / Queen / King) and material preference before quoting an exact price, since most sets are priced as a size range.

Delivery: standard shipping (ready-made stock). This bedding catalog updates frequently and carries many colourways per line — for a specific design, exact size price, or item not named above, contact us on WhatsApp: +60 12-568 4568 or see mocof.com.my/bed-sheet-malaysia
`;
}