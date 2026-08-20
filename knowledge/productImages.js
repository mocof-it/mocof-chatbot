// =============================================================
// FILE: knowledge/productImages.js
// Structured product image lookup — mirrors the pattern used by
// WALLBED_MODEL_WIDTHS_FT in wallbeds.js: real image URLs, matched
// in code, never left to the model to invent.
//
// Order + negative lookaheads matter here: "Murano Basic Series" is
// the shared product photo for the plain Queen/King/Single configs
// (they're sold on one combined product page on the site), so its
// pattern must NOT fire when a Sofa/Desk/Shelves variant is what's
// actually being asked about — otherwise a question about the
// Queen Sofa would return both the Sofa photo AND the generic one.
// =============================================================
export const PRODUCT_IMAGES = [
    // ── Murano — variant-specific photos (checked first) ──
    {
        pattern: /murano\s*queen\s*sofa/i,
        label: 'Murano Queen Sofa',
        url: 'https://static.wixstatic.com/media/118d88_a7af654d5dce4b2ca7cffd83cdca4437~mv2_d_5148_3135_s_4_2.jpg/v1/fill/w_674,h_410,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_a7af654d5dce4b2ca7cffd83cdca4437~mv2_d_5148_3135_s_4_2.jpg'
    },
    {
        pattern: /murano\s*queen\s*desk/i,
        label: 'Murano Queen Desk',
        url: 'https://static.wixstatic.com/media/118d88_be526b528574446ca85c2f28b3ca93c7~mv2.png/v1/fill/w_674,h_674,al_c,q_90,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_be526b528574446ca85c2f28b3ca93c7~mv2.png'
    },
    {
        pattern: /murano\s*queen\s*shelves/i,
        label: 'Murano Queen Shelves',
        url: 'https://static.wixstatic.com/media/118d88_ec1d6bd1cb324e82bea4624b1d39a884~mv2.jpg/v1/fill/w_674,h_674,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_ec1d6bd1cb324e82bea4624b1d39a884~mv2.jpg'
    },

    // ── Murano — plain configs share one photo (Basic Series) ──
    // Negative lookahead skips this when a Sofa/Desk/Shelves variant
    // is actually what's being asked about (matched above instead).
    {
        pattern: /murano\s*(queen|king|single)(?!\s*(sofa|desk|shelves))/i,
        label: 'Murano Basic Series',
        url: 'https://static.wixstatic.com/media/118d88_081f1896093f49678d2fb5e325e4a734~mv2.jpg/v1/fill/w_602,h_674,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_081f1896093f49678d2fb5e325e4a734~mv2.jpg'
    },

    // ── Gioco — variant-specific photos (checked first) ──
    {
        pattern: /gioco\s*single\s*desk/i,
        label: 'Gioco Single Desk',
        url: 'https://static.wixstatic.com/media/118d88_03d3a09abda14cc5864bf3849e08c481~mv2.jpg/v1/fill/w_483,h_483,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_03d3a09abda14cc5864bf3849e08c481~mv2.jpg'
    },
    {
        pattern: /gioco\s*bunk/i,
        label: 'Gioco Bunk Bed',
        url: 'https://static.wixstatic.com/media/118d88_a9d7b36ace33482386dcb35b754ccedf~mv2.jpg/v1/fill/w_483,h_483,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_a9d7b36ace33482386dcb35b754ccedf~mv2.jpg'
    },

    // ── Gioco — plain configs share one photo (Basic Series) ──
    {
        pattern: /gioco\s*(queen|single)(?!\s*desk)/i,
        label: 'Gioco Basic Series',
        url: 'https://static.wixstatic.com/media/118d88_c1a2026b658a4da5b5052fe1b251f790~mv2_d_4160_3120_s_4_2.jpg/v1/fill/w_644,h_483,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_c1a2026b658a4da5b5052fe1b251f790~mv2_d_4160_3120_s_4_2.jpg'
    },

    // ── Orzo Hori Sofa Bed — has Open/Closed photos ──
    // Closed pattern uses a negative lookahead so it doesn't ALSO fire
    // when "open" is mentioned (same double-match problem as Murano).
    {
        pattern: /orzo\s*hori(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Orzo Hori Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/118d88_94f5df5b90b240a7b952f6ceaa02823d~mv2.jpg/v1/fill/w_732,h_549,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_94f5df5b90b240a7b952f6ceaa02823d~mv2.jpg'
    },
    {
        pattern: /orzo\s*hori(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Orzo Hori Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/118d88_f2e71edbaa58498093a4722bbe6a3922~mv2.jpg/v1/fill/w_732,h_549,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_f2e71edbaa58498093a4722bbe6a3922~mv2.jpg'
    },

    // ── Orzo (Single) Sofa Bed — checked after Orzo Hori so plain
    // "orzo" doesn't also match when "hori" is the actual subject ──
    {
        pattern: /orzo(?!\s*hori)\b(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Orzo Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/118d88_78849485629e4dadb8e25880cba38ae6~mv2_d_2790_1927_s_2.jpg/v1/fill/w_749,h_533,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_78849485629e4dadb8e25880cba38ae6~mv2_d_2790_1927_s_2.jpg'
    },
    {
        pattern: /orzo(?!\s*hori)(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Orzo Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/118d88_a2f2bf56e5644658b403c708fcec71d2~mv2_d_3540_2523_s_4_2.jpg/v1/fill/w_749,h_533,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_a2f2bf56e5644658b403c708fcec71d2~mv2_d_3540_2523_s_4_2.jpg'
    },

    // ── Duo Sofa Bunk Bed — has Open/Closed photos ──
    {
        pattern: /duo.*bunk(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Duo Sofa Bunk Bed (Open)',
        url: 'https://static.wixstatic.com/media/118d88_2bd4395595914c52948b9e22ddec6d95~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_2bd4395595914c52948b9e22ddec6d95~mv2.jpg'
    },
    {
        pattern: /duo.*bunk(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Duo Sofa Bunk Bed (Closed)',
        url: 'https://static.wixstatic.com/media/118d88_66f518577c15474096e927eb5b9df3e1~mv2.jpg/v1/fill/w_644,h_644,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_66f518577c15474096e927eb5b9df3e1~mv2.jpg'
    },

    // ── Ottoman Bed — single photo, no open/closed variant supplied ──
    {
        pattern: /ottoman/i,
        label: 'Ottoman Bed',
        url: 'https://static.wixstatic.com/media/a4c6ea_78c96cd18d494dc3a51f352e022379f3~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,enc_avif,quality_auto/a4c6ea_78c96cd18d494dc3a51f352e022379f3~mv2.jpg'
    },

    // ── Tables ──
    {
        pattern: /levante/i,
        label: 'Levante Table',
        url: 'https://static.wixstatic.com/media/72b6a8_360fe8274d0143e6afe75d43d1734ad8~mv2.jpeg/v1/fill/w_749,h_563,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_360fe8274d0143e6afe75d43d1734ad8~mv2.jpeg'
    },
    // Ulisse XL checked before plain Ulisse, with a negative lookahead
    // on the plain pattern so a question about the XL doesn't also
    // return the standard 10-pax photo.
    {
        pattern: /ulisse\s*xl/i,
        label: 'Ulisse XL Table (14 Pax)',
        url: 'https://static.wixstatic.com/media/118d88_0ffa7de154f345e1b242aada8c7281e2~mv2.jpg/v1/fill/w_644,h_644,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_0ffa7de154f345e1b242aada8c7281e2~mv2.jpg'
    },
    {
        pattern: /ulisse(?!\s*xl)/i,
        label: 'Ulisse Table (10 Pax)',
        url: 'https://static.wixstatic.com/media/118d88_b5a7ebc7b3934e4da2b850fb8dfca0ac~mv2_d_2048_1530_s_2.jpg/v1/fill/w_749,h_561,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_b5a7ebc7b3934e4da2b850fb8dfca0ac~mv2_d_2048_1530_s_2.jpg'
    },
    {
        pattern: /tower\s*maxi/i,
        label: 'Tower Maxi Table (18 Pax)',
        url: 'https://static.wixstatic.com/media/118d88_63bf6110467e49f39c350229651fd80f~mv2.jpg/v1/fill/w_576,h_576,al_c,q_80,enc_avif,quality_auto/118d88_63bf6110467e49f39c350229651fd80f~mv2.jpg'
    },
    {
        pattern: /ares\s*fold/i,
        label: 'Ares Fold Table (10 Pax)',
        url: 'https://static.wixstatic.com/media/118d88_7753dea440d6421bab71463bcc7985b3~mv2.jpg/v1/fill/w_580,h_580,al_c,q_80,enc_avif,quality_auto/118d88_7753dea440d6421bab71463bcc7985b3~mv2.jpg'
    },
    {
        pattern: /tavoletto/i,
        label: 'Tavoletto Table with Hidden Bed',
        url: 'https://static.wixstatic.com/media/118d88_1a7689808cb54e7598bdb81596778dd8~mv2_d_1732_1299_s_2.jpg/v1/fill/w_644,h_644,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_1a7689808cb54e7598bdb81596778dd8~mv2_d_1732_1299_s_2.jpg'
    },
    {
        pattern: /4\s*x\s*4/i,
        label: '4x4 Dining Table (14 Pax)',
        url: 'https://static.wixstatic.com/media/118d88_d520c562d762483ca87b6d4e2745fe12~mv2_d_7216_5232_s_4_2.jpg/v1/fill/w_644,h_644,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/118d88_d520c562d762483ca87b6d4e2745fe12~mv2_d_7216_5232_s_4_2.jpg'
    },
    {
        pattern: /geniale/i,
        label: 'Geniale Table (4 Pax)',
        url: 'https://static.wixstatic.com/media/118d88_f5405f9fbfd54c77901de3b071ef1f66~mv2.jpg/v1/fill/w_580,h_580,al_c,q_80,enc_avif,quality_auto/118d88_f5405f9fbfd54c77901de3b071ef1f66~mv2.jpg'
    },
    {
        pattern: /bessy/i,
        label: 'Bessy Table (8 Pax)',
        url: 'https://static.wixstatic.com/media/118d88_b4aae694dd774a2a938dcefaeae6d6ce~mv2.jpg/v1/fill/w_580,h_580,al_c,q_80,enc_avif,quality_auto/118d88_b4aae694dd774a2a938dcefaeae6d6ce~mv2.jpg'
    },

    // ── Recliner ──
    // "Cloth Cover" variant checked first so plain "Zeta" doesn't also match it.
    {
        pattern: /zeta.*clothe?\s*cover/i,
        label: 'Zeta Recliner (Cloth Cover)',
        url: 'https://static.wixstatic.com/media/be2f9f_63b4bd663c4d4da2b32352c575c387ff~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_63b4bd663c4d4da2b32352c575c387ff~mv2.jpg'
    },
    {
        pattern: /zeta(?!.*clothe?\s*cover)/i,
        label: 'Zeta Recliner Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_77c9e118a88c4e6ea2c5a4c7760d389b~mv2.png/v1/fill/w_624,h_624,al_c,q_90,enc_avif,quality_auto/be2f9f_77c9e118a88c4e6ea2c5a4c7760d389b~mv2.png'
    },

    // ── TV Cabinets ──
    {
        pattern: /birch/i,
        label: 'Birch TV Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_b1fe1fd3520a45ed806ff9df25a7313b~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_b1fe1fd3520a45ed806ff9df25a7313b~mv2.jpg'
    },
    {
        pattern: /riza/i,
        label: 'Riza TV Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_a099f3736d084652b2d629c75d61de65~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_a099f3736d084652b2d629c75d61de65~mv2.jpg'
    },
    {
        pattern: /maven/i,
        label: 'Maven TV Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_311a8d37abd448738b9daa6b72a6e210~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_311a8d37abd448738b9daa6b72a6e210~mv2.jpg'
    },
    {
        pattern: /zorra/i,
        label: 'Zorra TV Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_c8bbf3f2e4d649b2b0b11fb04eada36d~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_c8bbf3f2e4d649b2b0b11fb04eada36d~mv2.jpg'
    },
    {
        pattern: /varo/i,
        label: 'Varo TV Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_2d3a9ed46fed4ae0afd29f9dcaddeaaf~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_2d3a9ed46fed4ae0afd29f9dcaddeaaf~mv2.jpg'
    },

    // ── Entryway (shoe rack / hallstands) ──
    {
        pattern: /draco/i,
        label: 'Draco Shoe Rack',
        url: 'https://static.wixstatic.com/media/be2f9f_8db2b239834041dfa37aa8faebab8dd2~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_8db2b239834041dfa37aa8faebab8dd2~mv2.jpg'
    },
    {
        pattern: /olola/i,
        label: 'Olola Hood Rack',
        url: 'https://static.wixstatic.com/media/be2f9f_191c05e6063a4d8d8b467792a9ccf417~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_191c05e6063a4d8d8b467792a9ccf417~mv2.jpg'
    },
    {
        pattern: /sade/i,
        label: 'Sade Hallstand',
        url: 'https://static.wixstatic.com/media/be2f9f_8afb48f6b6ff48189448766b3df32ee2~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_8afb48f6b6ff48189448766b3df32ee2~mv2.jpg'
    },
    {
        pattern: /nix/i,
        label: 'Nix Hallstand',
        url: 'https://static.wixstatic.com/media/be2f9f_4e1bc778d86a40b183a7d92e696b6523~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_4e1bc778d86a40b183a7d92e696b6523~mv2.jpg'
    },

    // ── Basic Sofas ──
    // "Nebula" uses a negative lookahead so it doesn't also match
    // "Nebulatte" (a different product — a coffee table, listed below).
    {
        pattern: /perch/i,
        label: 'Perch Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_91d7e51045804a568ebe1202c0a8a616~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_91d7e51045804a568ebe1202c0a8a616~mv2.jpg'
    },
    {
        pattern: /cozelle/i,
        label: 'Cozelle Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_c5aba423013e4907ab45f282bc8ac2c8~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_c5aba423013e4907ab45f282bc8ac2c8~mv2.jpg'
    },
    {
        pattern: /casa/i,
        label: 'Casa Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_c03e1af15a2646b9b607801b5c74387e~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_c03e1af15a2646b9b607801b5c74387e~mv2.jpg'
    },
    {
        pattern: /celestia/i,
        label: 'Celestia Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_bc4bf405ff7848c98346fec11c10355a~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_bc4bf405ff7848c98346fec11c10355a~mv2.jpg'
    },
    {
        pattern: /orbit/i,
        label: 'Orbit Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_851f9f815c4949a6af5cd9e4e0e575c5~mv2.png/v1/fill/w_734,h_486,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_851f9f815c4949a6af5cd9e4e0e575c5~mv2.png'
    },
    {
        pattern: /zenon/i,
        label: 'Zenon Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_797b993d95474f31b88107f5d94dfd7d~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_797b993d95474f31b88107f5d94dfd7d~mv2.jpg'
    },
    {
        pattern: /moria/i,
        label: 'Moria Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_4321b1b678884973b7f026815e299357~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_4321b1b678884973b7f026815e299357~mv2.jpg'
    },
    {
        pattern: /lumina/i,
        label: 'Lumina Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_676e8585b8ac4cef8da2b62bc65a7a1d~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_676e8585b8ac4cef8da2b62bc65a7a1d~mv2.jpg'
    },
    {
        pattern: /zenith/i,
        label: 'Zenith Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_cf271f59dcb14d068a413ca268a9df70~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_cf271f59dcb14d068a413ca268a9df70~mv2.jpg'
    },
    {
        pattern: /crorix/i,
        label: 'Crorix Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_33482299680748678d0ea9c1adb244bd~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_33482299680748678d0ea9c1adb244bd~mv2.jpg'
    },
    {
        pattern: /solaris/i,
        label: 'Solaris Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_13ae0b88191d4b49ae8e4acd9f43bc07~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_13ae0b88191d4b49ae8e4acd9f43bc07~mv2.jpg'
    },
    {
        pattern: /nebula(?!tte)/i,
        label: 'Nebula Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_38613d4c6780466e87ed04afcb324082~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_38613d4c6780466e87ed04afcb324082~mv2.jpg'
    },
    {
        pattern: /neva/i,
        label: 'Neva Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_dea923e3446b469da5040c22feaf32a5~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_dea923e3446b469da5040c22feaf32a5~mv2.jpg'
    },
    {
        pattern: /pluto/i,
        label: 'Pluto Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_2e5b9555fee64de5bec0b991093a6941~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_2e5b9555fee64de5bec0b991093a6941~mv2.jpg'
    },
    {
        pattern: /drion/i,
        label: 'Drion Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_0384bb5d2a2b466a9187bf4e146e5e05~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_0384bb5d2a2b466a9187bf4e146e5e05~mv2.jpg'
    },
    {
        pattern: /flare/i,
        label: 'Flare Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_9cabac2b7f214425b56daa4a0ebbdb42~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_9cabac2b7f214425b56daa4a0ebbdb42~mv2.jpg'
    },
    {
        pattern: /marlie/i,
        label: 'Marlie Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_b0c1146da7f14b8096dac4d6a8ecd578~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_b0c1146da7f14b8096dac4d6a8ecd578~mv2.jpg'
    },
    {
        pattern: /colony/i,
        label: 'Colony Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_6c5d19906bf340608aa2cc6f8a7e0b1f~mv2.webp/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_6c5d19906bf340608aa2cc6f8a7e0b1f~mv2.webp'
    },
    {
        pattern: /theta/i,
        label: 'Theta Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_3264df3c8e78478691d6670a770e48dd~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_3264df3c8e78478691d6670a770e48dd~mv2.jpg'
    },
    {
        pattern: /dream/i,
        label: 'Dream Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_ffb8f8efe8484455a57ab924ecc43a5a~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_ffb8f8efe8484455a57ab924ecc43a5a~mv2.jpg'
    },
    {
        pattern: /canis/i,
        label: 'Canis L Shape Sofa',
        url: 'https://static.wixstatic.com/media/be2f9f_c2d98588f39b492eb352db62ac639915~mv2.jpg/v1/fill/w_749,h_498,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_c2d98588f39b492eb352db62ac639915~mv2.jpg'
    },

    // ── Basic Sofa Bed: Kivo + Velvet (6 colours), each Open/Closed ──
    {
        pattern: /kivo(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Kivo Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/be2f9f_ca767b0299c14835b0d93ca2b310da16~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_ca767b0299c14835b0d93ca2b310da16~mv2.jpg'
    },
    {
        pattern: /kivo(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Kivo Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/be2f9f_0dc27d39e8f34a7c8da65c32e5495a38~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_0dc27d39e8f34a7c8da65c32e5495a38~mv2.jpg'
    },
    {
        pattern: /pastel\s*pink(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Pastel Pink Velvet Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/72b6a8_a4385df0cddd4240994de5e5c85d0192~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_a4385df0cddd4240994de5e5c85d0192~mv2.jpg'
    },
    {
        pattern: /pastel\s*pink(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Pastel Pink Velvet Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/72b6a8_86fceab5a4184e9c9aceedd2f31bbbd4~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_86fceab5a4184e9c9aceedd2f31bbbd4~mv2.jpg'
    },
    {
        pattern: /royal\s*blue(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Royal Blue Velvet Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/72b6a8_6aae424d856240b98197e90faef07ce0~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_6aae424d856240b98197e90faef07ce0~mv2.jpg'
    },
    {
        pattern: /royal\s*blue(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Royal Blue Velvet Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/72b6a8_f0bc677d2da14e1bb32f1e46c1947bd2~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_f0bc677d2da14e1bb32f1e46c1947bd2~mv2.jpg'
    },
    {
        pattern: /jade\s*green(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Jade Green Velvet Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/72b6a8_19a7131058964edbabb0bfec9a189741~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_19a7131058964edbabb0bfec9a189741~mv2.jpg'
    },
    {
        pattern: /jade\s*green(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Jade Green Velvet Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/72b6a8_d2a4dabd52e444c691580c4a2e722a7d~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_d2a4dabd52e444c691580c4a2e722a7d~mv2.jpg'
    },
    {
        pattern: /aegean\s*blue(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Aegean Blue Velvet Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/72b6a8_b442b7f3a0e04e85894d8e31775e487f~mv2.jpg/v1/fill/w_714,h_476,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_b442b7f3a0e04e85894d8e31775e487f~mv2.jpg'
    },
    {
        pattern: /aegean\s*blue(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Aegean Blue Velvet Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/72b6a8_42b9021674854889a2ad547433339139~mv2.jpg/v1/fill/w_734,h_470,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_42b9021674854889a2ad547433339139~mv2.jpg'
    },
    {
        pattern: /mustard\s*yellow(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Mustard Yellow Velvet Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/72b6a8_8150abb1d42f42aeb02101b480f44c45~mv2.jpg/v1/fill/w_749,h_498,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_8150abb1d42f42aeb02101b480f44c45~mv2.jpg'
    },
    {
        pattern: /mustard\s*yellow(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'Mustard Yellow Velvet Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/72b6a8_18d7d4487a954ecf937995808248ade5~mv2.jpg/v1/fill/w_749,h_498,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_18d7d4487a954ecf937995808248ade5~mv2.jpg'
    },
    {
        pattern: /french\s*blue(?=.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'French Blue Velvet Sofa Bed (Open)',
        url: 'https://static.wixstatic.com/media/72b6a8_b757647ae7e3486fb9a85d0701ff21c8~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_b757647ae7e3486fb9a85d0701ff21c8~mv2.jpg'
    },
    {
        pattern: /french\s*blue(?!.*\b(open|opened|unfold|unfolded|extended)\b)/i,
        label: 'French Blue Velvet Sofa Bed (Closed)',
        url: 'https://static.wixstatic.com/media/72b6a8_24a8bde7666047b09c2a6380eb607a54~mv2.jpg/v1/fill/w_734,h_489,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/72b6a8_24a8bde7666047b09c2a6380eb607a54~mv2.jpg'
    },

    // ── Coffee Tables & Stool ──
    {
        pattern: /nebulatte/i,
        label: 'Nebulatte Coffee Table',
        url: 'https://static.wixstatic.com/media/be2f9f_178f6631470b43cdb72be1bb76515bb2~mv2.jpg/v1/fill/w_665,h_498,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_178f6631470b43cdb72be1bb76515bb2~mv2.jpg'
    },
    {
        pattern: /dock/i,
        label: 'Dock Coffee Table',
        url: 'https://static.wixstatic.com/media/be2f9f_0fd6dc7bb3ff4397a1295ef19111a258~mv2.jpg/v1/fill/w_490,h_734,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_0fd6dc7bb3ff4397a1295ef19111a258~mv2.jpg'
    },
    {
        pattern: /zovo/i,
        label: 'Zovo Coffee Table',
        url: 'https://static.wixstatic.com/media/be2f9f_75841a4e6a7842409fd8e4aac3002a4b~mv2.jpg/v1/fill/w_665,h_498,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_75841a4e6a7842409fd8e4aac3002a4b~mv2.jpg'
    },
    {
        pattern: /pebble/i,
        label: 'Pebble Coffee Table',
        url: 'https://static.wixstatic.com/media/be2f9f_62e1e1f2958947f4a32933908dd7921a~mv2.jpg/v1/fill/w_665,h_498,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_62e1e1f2958947f4a32933908dd7921a~mv2.jpg'
    },
    {
        pattern: /librae/i,
        label: 'Librae Coffee Table',
        url: 'https://static.wixstatic.com/media/be2f9f_4222b9771c364174acf74b6583b88d80~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_4222b9771c364174acf74b6583b88d80~mv2.jpg'
    },
    {
        pattern: /starry/i,
        label: 'Starry Coffee Table',
        url: 'https://static.wixstatic.com/media/be2f9f_59f0e731ed59458aae1959528214d4ca~mv2.jpg/v1/fill/w_665,h_498,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_59f0e731ed59458aae1959528214d4ca~mv2.jpg'
    },
    {
        pattern: /luna\s*stool/i,
        label: 'Luna Stool',
        url: 'https://static.wixstatic.com/media/be2f9f_db74b4993b1d449ab6a0b6b1a3a77e6c~mv2.jpg/v1/fill/w_665,h_498,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_db74b4993b1d449ab6a0b6b1a3a77e6c~mv2.jpg'
    },

    // ── Basic Stools ──
    {
        pattern: /\bhush\b/i,
        label: 'Hush Stool',
        url: 'https://static.wixstatic.com/media/be2f9f_615994c727f04827beed22e2fb6de2e9~mv2.jpg/v1/fill/w_527,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_615994c727f04827beed22e2fb6de2e9~mv2.jpg'
    },
    {
        pattern: /\bholo\b/i,
        label: 'Holo Stool',
        url: 'https://static.wixstatic.com/media/be2f9f_ddd37701f6c949ae84ab9c7fb2661690~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_ddd37701f6c949ae84ab9c7fb2661690~mv2.jpg'
    },

    // ── Basic Chairs ──
    {
        pattern: /\bvine\b/i,
        label: 'Vine Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_24a13e46264f4d7b85cf84bef0ebde98~mv2.jpg/v1/fill/w_490,h_734,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_24a13e46264f4d7b85cf84bef0ebde98~mv2.jpg'
    },
    {
        pattern: /\bvellum\b/i,
        label: 'Vellum Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_63363500f6a7404fa08667fb72ce5a76~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_63363500f6a7404fa08667fb72ce5a76~mv2.jpg'
    },
    {
        pattern: /\bmodo\b/i,
        label: 'Modo Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_198b1380dbc146ee99055a1e033bb215~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_198b1380dbc146ee99055a1e033bb215~mv2.jpg'
    },
    {
        pattern: /\betho\b/i,
        label: 'Etho Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_f4efb5fccec24494be2b341db6c839b3~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_f4efb5fccec24494be2b341db6c839b3~mv2.jpg'
    },
    {
        pattern: /\bnexo\b/i,
        label: 'Nexo Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_3033606681494999acbbc7bc99da1250~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_3033606681494999acbbc7bc99da1250~mv2.jpg'
    },
    {
        pattern: /\btetra\b/i,
        label: 'Tetra Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_2186c86f74c04751b3e218d317949965~mv2.jpg/v1/fill/w_489,h_734,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_2186c86f74c04751b3e218d317949965~mv2.jpg'
    },
    {
        pattern: /\bjolly\b/i,
        label: 'Jolly Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_f48d63d9b4e641cb8bf7e6135f0abec4~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_f48d63d9b4e641cb8bf7e6135f0abec4~mv2.jpg'
    },
    {
        pattern: /bar\s*chair/i,
        label: 'Bar Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_52ed4768db444de3b34ddec62f1eb7cc~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_52ed4768db444de3b34ddec62f1eb7cc~mv2.jpg'
    },
    {
        pattern: /\bsolis\b/i,
        label: 'Solis Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_b02bce20ad744d0fbe399320068efdcf~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_b02bce20ad744d0fbe399320068efdcf~mv2.jpg'
    },
    {
        pattern: /\bzen\b/i,
        label: 'Zen Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_587aaac914284a679aba7af1a54bcb3b~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_587aaac914284a679aba7af1a54bcb3b~mv2.jpg'
    },
    {
        pattern: /buzz\s*chair/i,
        label: 'Buzz Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_2982ddb9642d4e989a5f150f47f1115d~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_2982ddb9642d4e989a5f150f47f1115d~mv2.jpg'
    },
    {
        pattern: /lars\s*chair/i,
        label: 'Lars Chair',
        url: 'https://static.wixstatic.com/media/be2f9f_0a64a1e16d9a4c2fb0be50415c52f1e7~mv2.jpg/v1/fill/w_338,h_338,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_0a64a1e16d9a4c2fb0be50415c52f1e7~mv2.jpg'
    },

    // ── Basic Trolley ──
    {
        pattern: /\bvion\b/i,
        label: 'Vion Trolley',
        url: 'https://static.wixstatic.com/media/be2f9f_30c0c61899dc40f49aba01d3ddc2a31f~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_30c0c61899dc40f49aba01d3ddc2a31f~mv2.jpg'
    },
    {
        pattern: /\blurn\b/i,
        label: 'Lurn Trolley',
        url: 'https://static.wixstatic.com/media/be2f9f_3b657a5b8da44565bb56343de85eb9c2~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_3b657a5b8da44565bb56343de85eb9c2~mv2.jpg'
    },

    // ── Basic Dining Table ──
    // Knowledge base spells this "Rootsy"; matching both spellings since
    // the image link supplied was labelled "Roosty" -- worth confirming
    // which is the actual spelling used on the live site.
    {
        pattern: /\bprova\b/i,
        label: 'Prova Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_a5a4715f1f3040b69e43250fade28d62~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_a5a4715f1f3040b69e43250fade28d62~mv2.jpg'
    },
    {
        pattern: /\bbrilla\b/i,
        label: 'Brilla Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_e5ab32610c754f1294488c6a4046d75b~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_e5ab32610c754f1294488c6a4046d75b~mv2.jpg'
    },
    {
        pattern: /\belzia\b/i,
        label: 'Elzia Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_31cda7da07254071ba59c07f9e13b5f2~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_31cda7da07254071ba59c07f9e13b5f2~mv2.jpg'
    },
    {
        pattern: /\bgrano\b/i,
        label: 'Grano Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_4809c0965c62466abcbf291c363399d7~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_4809c0965c62466abcbf291c363399d7~mv2.jpg'
    },
    {
        pattern: /\bvalor\b/i,
        label: 'Valor Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_3927a5234c2a473f908f457f3d798f1f~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_3927a5234c2a473f908f457f3d798f1f~mv2.jpg'
    },
    {
        pattern: /rootsy|roosty/i,
        label: 'Rootsy Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_5767e6f8962c4d1485c6c0374973ac27~mv2.jpg/v1/fill/w_489,h_734,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_5767e6f8962c4d1485c6c0374973ac27~mv2.jpg'
    },
    {
        pattern: /\bpallio\b/i,
        label: 'Pallio Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_ab95c7c4357541aebe824107fa942ed4~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_ab95c7c4357541aebe824107fa942ed4~mv2.jpg'
    },
    {
        pattern: /\bproxima\b/i,
        label: 'Proxima Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_cbd378c67c97410c9d6c4305b39db5df~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_cbd378c67c97410c9d6c4305b39db5df~mv2.jpg'
    },
    {
        pattern: /\bvenus\b/i,
        label: 'Venus Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_feafc1604195400cb5e188ba675d2747~mv2.jpg/v1/fill/w_749,h_749,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_feafc1604195400cb5e188ba675d2747~mv2.jpg'
    },
    {
        pattern: /\bsone\b/i,
        label: 'Sone Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_72871f3ea02b445da50cad223ae5af75~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_72871f3ea02b445da50cad223ae5af75~mv2.jpg'
    },
    {
        pattern: /\bbella\b/i,
        label: 'Bella Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_902d28af821946868e3b1187ac415e0d~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_902d28af821946868e3b1187ac415e0d~mv2.jpg'
    },
    {
        pattern: /\bmelba\b/i,
        label: 'Melba Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_ec1c84ab7e684b289d6c6a4d2493024a~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_ec1c84ab7e684b289d6c6a4d2493024a~mv2.jpg'
    },
    {
        pattern: /\bsolara\b/i,
        label: 'Solara Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_8d1263cb11d0414bb0c9729d323ef528~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_8d1263cb11d0414bb0c9729d323ef528~mv2.jpg'
    },
    {
        pattern: /\bprimo\b/i,
        label: 'Primo Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_9793d8e57cca4cfeb7a5bdbd3015f33f~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_9793d8e57cca4cfeb7a5bdbd3015f33f~mv2.jpg'
    },

    // ── Basic Cabinet & Shelf ──
    {
        pattern: /\bthora\b/i,
        label: 'Thora Dining Table',
        url: 'https://static.wixstatic.com/media/be2f9f_e94f46f1eec647b59d5a0fe9b4860ac6~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_e94f46f1eec647b59d5a0fe9b4860ac6~mv2.jpg'
    },
    {
        pattern: /\bresili\b/i,
        label: 'Resili Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_e14edc23c9474f339a70ab908b45e41f~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_e14edc23c9474f339a70ab908b45e41f~mv2.jpg'
    },
    {
        pattern: /\beclipse\b/i,
        label: 'Eclipse Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_057b468db59b4b25b4527750fc9500ab~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_057b468db59b4b25b4527750fc9500ab~mv2.jpg'
    },
    {
        pattern: /\bclover\b/i,
        label: 'Clover Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_bf473b7a7fe7455994a99bdd635e9009~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_bf473b7a7fe7455994a99bdd635e9009~mv2.jpg'
    },
    {
        pattern: /\beden\b/i,
        label: 'Eden Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_e6274a54531b49828c7e880165aa3631~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_e6274a54531b49828c7e880165aa3631~mv2.jpg'
    },
    {
        pattern: /\bliro\b/i,
        label: 'Liro Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_8025a78546e54959b396d2fc02b4cbc3~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_8025a78546e54959b396d2fc02b4cbc3~mv2.jpg'
    },
    {
        pattern: /\bvelvia\b/i,
        label: 'Velvia Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_6daec4f8b4b248d9adf5f955d856dec1~mv2.jpg/v1/fill/w_704,h_704,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_6daec4f8b4b248d9adf5f955d856dec1~mv2.jpg'
    },
    {
        pattern: /petrus.*storage/i,
        label: 'Petrus Storage Shelf',
        url: 'https://static.wixstatic.com/media/be2f9f_8ee2c3531f994ed9a88b017c5fe4f5c6~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_8ee2c3531f994ed9a88b017c5fe4f5c6~mv2.jpg'
    },
    {
        pattern: /petrus(?!.*storage)/i,
        label: 'Petrus Shelf',
        url: 'https://static.wixstatic.com/media/be2f9f_3bc114ef39eb46efaafd5e67b401eccf~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_3bc114ef39eb46efaafd5e67b401eccf~mv2.jpg'
    },
    {
        pattern: /\bheem\b/i,
        label: 'Heem Book Shelf',
        url: 'https://static.wixstatic.com/media/be2f9f_bae3fd058e26460e9a268284fe316b99~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_bae3fd058e26460e9a268284fe316b99~mv2.jpg'
    },
    {
        pattern: /axil/i,
        label: 'Axil Corner Book Shelf',
        url: 'https://static.wixstatic.com/media/be2f9f_b94a1800f455430aa0358a05241e8826~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_b94a1800f455430aa0358a05241e8826~mv2.jpg'
    },

    // ── Wardrobes (matches basicfurniture.js pointer to the WARDROBE knowledge base) ──
    {
        pattern: /andro.*open/i,
        label: 'Andro Open Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_38261a3bf4b34d1885532a0c191dfc36~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_38261a3bf4b34d1885532a0c191dfc36~mv2.jpg'
    },
    {
        pattern: /andro(?!.*open)/i,
        label: 'Andro Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_09d5e6b42cec4edd97fe5c44de47c46f~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_09d5e6b42cec4edd97fe5c44de47c46f~mv2.jpg'
    },
    {
        pattern: /\bloom\b/i,
        label: 'Loom Open Cabinet',
        url: 'https://static.wixstatic.com/media/be2f9f_4d841b357da6435f9c3623145580de1d~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_4d841b357da6435f9c3623145580de1d~mv2.jpg'
    },
    {
        pattern: /\bforge\b/i,
        label: 'Forge Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_edc539117d834098a468df7376ff536e~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_edc539117d834098a468df7376ff536e~mv2.jpg'
    },
    {
        pattern: /\bhara\b/i,
        label: 'Hara Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_3509d66d5c614fec98ce540e7b2b1f6c~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_3509d66d5c614fec98ce540e7b2b1f6c~mv2.jpg'
    },
    {
        pattern: /\beuclio\b/i,
        label: 'Euclio Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_be23ab395c2446ad929eda8b7b7c854f~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_be23ab395c2446ad929eda8b7b7c854f~mv2.jpg'
    },
    {
        pattern: /\berga\b/i,
        label: 'Erga Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_0b1f6abb51444909bb45a5b26e8749f8~mv2.jpg/v1/fill/w_734,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_0b1f6abb51444909bb45a5b26e8749f8~mv2.jpg'
    },
    {
        pattern: /\banta\b/i,
        label: 'Anta Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_32f0801df28744c2af204532cb043bfe~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_32f0801df28744c2af204532cb043bfe~mv2.jpg'
    },

    // ── Basic Bed Frame ──
    {
        pattern: /\barvo\b/i,
        label: 'Arvo Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_438258d5ad2c48b0b6b1dceca7abcce5~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_438258d5ad2c48b0b6b1dceca7abcce5~mv2.jpg'
    },
    {
        pattern: /\barto\b/i,
        label: 'Arto Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_8efce5b84bb9413ab904c304218c2d81~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_8efce5b84bb9413ab904c304218c2d81~mv2.jpg'
    },
    {
        pattern: /\blyco\b/i,
        label: 'Lyco Wardrobe',
        url: 'https://static.wixstatic.com/media/be2f9f_041607a2123b4e41a055e730431cfe9d~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_041607a2123b4e41a055e730431cfe9d~mv2.jpg'
    },
    {
        pattern: /\bfeilo\b/i,
        label: 'Feilo Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_0bf34e79b32f420f85e92a4d2f981f5f~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_0bf34e79b32f420f85e92a4d2f981f5f~mv2.jpg'
    },
    {
        pattern: /\bvale\b/i,
        label: 'Vale Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_4f948aaff29049e6a32381a5fb16f848~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_4f948aaff29049e6a32381a5fb16f848~mv2.jpg'
    },
    {
        pattern: /\bclaria\b/i,
        label: 'Claria Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_21d8159b3d314603abc658d5b307d35b~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_21d8159b3d314603abc658d5b307d35b~mv2.jpg'
    },
    {
        pattern: /\bmesa\b/i,
        label: 'Mesa Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_815465424d8849e796e13a29a6067372~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_815465424d8849e796e13a29a6067372~mv2.jpg'
    },
    {
        pattern: /\brove\b/i,
        label: 'Rove Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_4c73e427d2544c97ae5d52c9fb762829~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_4c73e427d2544c97ae5d52c9fb762829~mv2.jpg'
    },
    {
        pattern: /\blevo\b/i,
        label: 'Levo Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_a5377c643ca34ebaa969da61a2c162fd~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_a5377c643ca34ebaa969da61a2c162fd~mv2.jpg'
    },
    {
        pattern: /\bmira\b/i,
        label: 'Mira Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_98e05707c92c415f95d9a86f987e40b7~mv2.jpg/v1/fill/w_557,h_734,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_98e05707c92c415f95d9a86f987e40b7~mv2.jpg'
    },
    {
        pattern: /\bletho\b/i,
        label: 'Letho Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_af870bc9978341038df039fc996e276d~mv2.jpg/v1/fill/w_556,h_733,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_af870bc9978341038df039fc996e276d~mv2.jpg'
    },
    {
        pattern: /\bmoza\b/i,
        label: 'Moza Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_12853e85b84e4e11922d5569c2bc84a7~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_12853e85b84e4e11922d5569c2bc84a7~mv2.jpg'
    },
    {
        pattern: /\bnook\b/i,
        label: 'Nook Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_ae0a5a2481a24af1bd5cb7bae6965b2b~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_ae0a5a2481a24af1bd5cb7bae6965b2b~mv2.jpg'
    },
    {
        pattern: /\bavo\b/i,
        label: 'Avo Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_704846f9dd484d9a992bb588a2bb3c99~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_704846f9dd484d9a992bb588a2bb3c99~mv2.jpg'
    },
    {
        pattern: /\borion\b/i,
        label: 'Orion Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_9c7af47a88044156afc88982aa551ab8~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_9c7af47a88044156afc88982aa551ab8~mv2.jpg'
    },
    {
        pattern: /\bstellar\b/i,
        label: 'Stellar Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_bb4cc73c68fc4f14a8daf7085916d5e5~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_bb4cc73c68fc4f14a8daf7085916d5e5~mv2.jpg'
    },
    {
        pattern: /\bcrolla\b/i,
        label: 'Crolla Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_571e78d7b3d347e887e5cf04c6723438~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_571e78d7b3d347e887e5cf04c6723438~mv2.jpg'
    },
    {
        pattern: /\blambda\b/i,
        label: 'Lambda Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_00b72f2bde6b4834949741f73484fb07~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_00b72f2bde6b4834949741f73484fb07~mv2.jpg'
    },
    {
        pattern: /\bapus\b/i,
        label: 'Apus Bedframe',
        url: 'https://static.wixstatic.com/media/be2f9f_c74528c227f54d65b2927c4761e4d39a~mv2.jpg/v1/fill/w_577,h_733,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_c74528c227f54d65b2927c4761e4d39a~mv2.jpg'
    },

    // ── Reference / lifestyle photos (not tied to one specific product) ──
    // Triggers on wall bed + cabinet TOPIC discussed together with an
    // explicit visual-intent word (reference/example/show/etc.) -- e.g.
    // "reference for wall bed and cabinets", "example of wallbed with
    // storage", "how does a wall bed with cabinetry look". Deliberately
    // requires that third visual-intent word so this doesn't also attach
    // itself to plain pricing or dimension questions about the same topic.
    {
        pattern: /(?=.*\b(wall\s*beds?|wallbeds?|murphy\s*beds?)\b)(?=.*\b(cabinets?|cabinetry|storage|shelv\w*)\b)(?=.*\b(references?|examples?|samples?|ideas?|inspirations?|layouts?|configurations?|configure\w*|customi[sz]e\w*|look\s*like|shows?|pictures?|photos?|pics?|images?)\b)/i,
        label: 'Wall Bed + Cabinetry Reference Photo',
        url: '/images/wallbed-cabinetry-reference.jpeg'
    },

    // ── Basic Study Table ──
    {
        pattern: /\belevatia\b/i,
        label: 'Elevatia Study Table',
        url: 'https://static.wixstatic.com/media/be2f9f_35b3ef0a2a1f4d1786545f609cec5157~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_35b3ef0a2a1f4d1786545f609cec5157~mv2.jpg'
    },
    {
        pattern: /\bglint\b/i,
        label: 'Glint Table',
        url: 'https://static.wixstatic.com/media/be2f9f_08b5321c5c69422ba19996d3272c8829~mv2.jpg/v1/fill/w_459,h_459,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/be2f9f_08b5321c5c69422ba19996d3272c8829~mv2.jpg'
    },

    // Add kitchen the same way once its image links are available.
];

const MAX_IMAGES_PER_REPLY = 2;

// Phrases that signal "I want to SEE something" rather than just
// mentioning a product in passing. Only these trigger the history
// fallback below.
const IMAGE_REQUEST_HINT = /\b(show|see|picture|photo|pic|image|look\s*like)\b/i;

// A number + unit (8ft, 2.5 metres, 30cm...) strongly signals the customer
// is ANSWERING a measurement question (e.g. the bot's own "what's the wall
// height?" during a cabinetry quote) rather than browsing/asking to view a
// product -- even if a model name happens to be in the same message. This
// suppresses the reflexive "mention a name, get a photo" behaviour for that
// specific case, without touching normal "show me the Murano Queen" requests
// (IMAGE_REQUEST_HINT above still overrides this suppression when present).
const MEASUREMENT_ANSWER_PATTERN = /\b\d+(\.\d+)?\s*(ft|feet|foot|'|inches?|inch|"|cm|centimet(er|re)s?|met(er|re)s?|m)\b/i;

function matchProducts(text) {
    const seen = new Set();
    const matches = [];
    for (const entry of PRODUCT_IMAGES) {
        if (text.match(entry.pattern) && !seen.has(entry.url)) {
            seen.add(entry.url);
            matches.push({ label: entry.label, url: entry.url });
            if (matches.length >= MAX_IMAGES_PER_REPLY) break;
        }
    }
    return matches;
}

// Matches the CURRENT message only, by default — this is what stops an
// old product (e.g. "Ottoman" from two turns ago) from re-attaching its
// photo to an unrelated later reply (e.g. "Show me Levante table").
// History is only consulted as a narrow fallback: when the customer
// clearly asks to see something ("show me a photo of that") without
// naming a product, in which case we look at just the ONE most recent
// exchange, not several turns back.
export function getRelevantImages(message, history) {
    const lowerMessage = (message || '').toLowerCase();
    const hasVisualIntent = IMAGE_REQUEST_HINT.test(lowerMessage);

    // e.g. "Murano Queen, and the wall is 8ft high" answering a form
    // question -- skip image matching entirely unless they also explicitly
    // asked to see something in the same message.
    if (MEASUREMENT_ANSWER_PATTERN.test(lowerMessage) && !hasVisualIntent) return [];

    const directMatches = matchProducts(lowerMessage);
    if (directMatches.length > 0) return directMatches;

    if (!hasVisualIntent) return [];

    const lastTurnText = Array.isArray(history)
        ? history.slice(-2).map(m => (m && m.content) ? m.content : '').join(' ').toLowerCase()
        : '';
    return matchProducts(lastTurnText);
}