// =============================================================
// FILE: test/staffAuth.test.js
// Run with: npm test  (or: node --test test/staffAuth.test.js)
//
// Covers the pure pieces of the staff invoice tool: the session token, the
// validator that stands between staff input and a real Stripe invoice, and the
// product-name normalizer that tidies line-item descriptions.
// Both are in lib/ precisely so they can be tested — api/staff-create-invoice.js
// imports `stripe` and so cannot be loaded by this suite, and nothing here
// touches Stripe or Gemini over the network.
// =============================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    signStaffToken,
    verifyStaffToken,
    passcodeMatches,
    buildStaffCookie,
    readStaffCookie,
    isLocalRequest,
    STAFF_SESSION_TTL_MS,
    STAFF_COOKIE_NAME
} from '../lib/staffAuth.js';

import {
    validateInvoiceInput,
    parseProposedInvoice,
    MAX_INVOICE_AMOUNT_RM,
    MAX_LINE_QUANTITY
} from '../lib/invoiceInput.js';

import resolvePriceHandler from '../api/staff-resolve-price.js';
import { WALLBED_MODEL_PRICING } from '../knowledge/wallbeds.js';
import { BASIC_SOFA_PRICING } from '../knowledge/basicfurniture.js';

import {
    normalizeProductName,
    buildProductNameReference,
    PRODUCT_NAMES
} from '../lib/productNames.js';

const SECRET = 'test-staff-session-secret-do-not-use-in-production';
const HOUR = 60 * 60 * 1000;

// The module reads process.env at call time, so setting it here is enough.
// node --test runs each test FILE in its own process, so this cannot leak into
// the other suite.
process.env.STAFF_SESSION_SECRET = SECRET;

describe('staff session tokens', () => {

    test('a freshly signed token verifies', () => {
        assert.equal(verifyStaffToken(signStaffToken()), true);
    });

    test('the token carries its expiry in the clear, signed', () => {
        const now = Date.now();
        const token = signStaffToken(now);
        const [expiry, signature] = token.split('.');
        assert.equal(Number(expiry), now + STAFF_SESSION_TTL_MS);
        assert.match(signature, /^[0-9a-f]{64}$/, 'HMAC-SHA256 hex digest');
        assert.equal(STAFF_SESSION_TTL_MS, 8 * HOUR, 'sessions last 8 hours');
    });

    // The whole point of signing: a client may read the expiry but cannot move it.
    test('a tampered signature does not verify', () => {
        const token = signStaffToken();
        const dot = token.indexOf('.');
        const signature = token.slice(dot + 1);
        // Flip exactly one character of the signature.
        const flipped = (signature[0] === 'a' ? 'b' : 'a') + signature.slice(1);
        assert.equal(verifyStaffToken(token.slice(0, dot + 1) + flipped), false);
    });

    test('an extended expiry does not verify', () => {
        const token = signStaffToken();
        const [expiry, signature] = token.split('.');
        const extended = `${Number(expiry) + 100 * HOUR}.${signature}`;
        assert.equal(verifyStaffToken(extended), false, 'the signature covers the expiry');
    });

    test('an expired token does not verify', () => {
        // Signed 9 hours ago, so its 8-hour expiry passed an hour back.
        const stale = signStaffToken(Date.now() - 9 * HOUR);
        assert.equal(verifyStaffToken(stale), false);
    });

    test('a token that expires in a minute still verifies', () => {
        const almost = signStaffToken(Date.now() - STAFF_SESSION_TTL_MS + 60 * 1000);
        assert.equal(verifyStaffToken(almost), true);
    });

    test('malformed tokens are rejected rather than throwing', () => {
        const junk = ['', '.', 'abc', 'abc.def', '.abc', 'abc.', null, undefined, 42, {}, [],
            'not-a-number.0000000000000000000000000000000000000000000000000000000000000000'];
        for (const token of junk) {
            assert.equal(verifyStaffToken(token), false, 'must reject ' + JSON.stringify(token));
        }
    });

    test('a token signed with a different secret does not verify', () => {
        const token = signStaffToken();
        process.env.STAFF_SESSION_SECRET = 'a-completely-different-secret';
        try {
            assert.equal(verifyStaffToken(token), false);
        } finally {
            process.env.STAFF_SESSION_SECRET = SECRET;
        }
    });

    // Without a configured secret there is no such thing as a valid session:
    // it must fail closed, never open.
    test('with no secret configured, nothing verifies and signing throws', () => {
        const saved = process.env.STAFF_SESSION_SECRET;
        delete process.env.STAFF_SESSION_SECRET;
        try {
            assert.equal(verifyStaffToken('anything.at-all'), false);
            assert.throws(() => signStaffToken(), /STAFF_SESSION_SECRET/);
        } finally {
            process.env.STAFF_SESSION_SECRET = saved;
        }
    });
});

describe('staff passcode comparison', () => {

    test('accepts the exact passcode and rejects everything else', () => {
        assert.equal(passcodeMatches('correct horse battery', 'correct horse battery'), true);
        assert.equal(passcodeMatches('correct horse batterz', 'correct horse battery'), false);
        assert.equal(passcodeMatches('Correct Horse Battery', 'correct horse battery'), false);
    });

    // Hashing both sides first is what lets a wrong-length guess take the same
    // path as a same-length one, instead of returning early.
    test('a guess of a different length is rejected, not thrown on', () => {
        assert.equal(passcodeMatches('x', 'a-much-longer-passcode'), false);
        assert.equal(passcodeMatches('a-much-longer-guess-than-the-real-one', 'short'), false);
    });

    test('empty and non-string values never match', () => {
        for (const bad of ['', null, undefined, 0, {}, []]) {
            assert.equal(passcodeMatches(bad, 'real-passcode'), false);
            assert.equal(passcodeMatches('real-passcode', bad), false);
        }
    });
});

describe('staff session cookie', () => {

    test('carries the flags that keep it out of JS and off other sites', () => {
        const cookie = buildStaffCookie('tok');
        assert.match(cookie, /^mocof_staff_session=tok/);
        assert.match(cookie, /HttpOnly/, 'must not be readable from JavaScript');
        assert.match(cookie, /SameSite=Strict/, 'must not be sent from another site');
        assert.match(cookie, /Secure/);
        assert.match(cookie, new RegExp('Max-Age=' + Math.floor(STAFF_SESSION_TTL_MS / 1000)));
    });

    test('Secure can be dropped for local http development only', () => {
        assert.doesNotMatch(buildStaffCookie('tok', { secure: false }), /Secure/);
        assert.equal(isLocalRequest({ headers: { host: 'localhost:3000' } }), true);
        assert.equal(isLocalRequest({ headers: { host: '127.0.0.1:3000' } }), true);
        assert.equal(isLocalRequest({ headers: { host: 'mocof-chatbot.vercel.app' } }), false,
            'a deployed host must always get Secure');
    });

    test('reads its own cookie from among others', () => {
        const req = { headers: { cookie: `other=1; ${STAFF_COOKIE_NAME}=abc.def; another=2` } };
        assert.equal(readStaffCookie(req), 'abc.def');
        assert.equal(readStaffCookie({ headers: {} }), null);
        assert.equal(readStaffCookie({ headers: { cookie: 'unrelated=1' } }), null);
        assert.equal(readStaffCookie({}), null);
    });

    test('a signed token survives a round trip through the cookie', () => {
        const token = signStaffToken();
        const cookie = buildStaffCookie(token);
        const value = cookie.slice(cookie.indexOf('=') + 1, cookie.indexOf(';'));
        assert.equal(verifyStaffToken(readStaffCookie({ headers: { cookie: `${STAFF_COOKIE_NAME}=${value}` } })), true);
    });
});

describe('invoice input validation', () => {

    const VALID = {
        customerName: 'Aisyah Binti Rahman',
        customerEmail: 'aisyah@example.com',
        currency: 'myr',
        lineItems: [
            { description: 'Murano Queen wall bed', amount: 14371.55 },
            { description: 'Delivery and installation', amount: 300 }
        ]
    };

    test('accepts a well-formed invoice and converts amounts to sen', () => {
        const result = validateInvoiceInput(VALID);
        assert.equal(result.ok, true, result.error);
        assert.equal(result.value.customerEmail, 'aisyah@example.com');
        assert.deepEqual(result.value.lineItems.map(i => i.unitAmountCents), [1437155, 30000]);
        assert.equal(result.value.totalRm, 14671.55);
        assert.equal(result.value.currency, 'myr');
    });

    test('rejects empty or missing line items', () => {
        for (const lineItems of [[], undefined, null, 'none', {}]) {
            const result = validateInvoiceInput({ ...VALID, lineItems });
            assert.equal(result.ok, false, 'must reject ' + JSON.stringify(lineItems));
            assert.match(result.error, /line item/i);
        }
    });

    // The money guard: nothing that isn't a real positive number gets through.
    test('rejects zero, negative, and non-numeric amounts', () => {
        for (const amount of [0, -1, -14371.55, NaN, Infinity, -Infinity, 'abc', '', null, undefined, {}, [], true]) {
            const result = validateInvoiceInput({ ...VALID, lineItems: [{ description: 'Thing', amount }] });
            assert.equal(result.ok, false, 'must reject amount ' + JSON.stringify(amount));
        }
    });

    test('accepts amounts a human typed, with commas or RM', () => {
        const result = validateInvoiceInput({
            ...VALID,
            lineItems: [{ description: 'Wall bed', amount: 'RM 14,371.55' }]
        });
        assert.equal(result.ok, true, result.error);
        assert.equal(result.value.lineItems[0].unitAmountCents, 1437155);
    });

    test('rejects a malformed email', () => {
        for (const customerEmail of ['', 'not-an-email', 'a@b', 'a@b.c', '@example.com', 'a b@example.com', null, 42]) {
            const result = validateInvoiceInput({ ...VALID, customerEmail });
            assert.equal(result.ok, false, 'must reject email ' + JSON.stringify(customerEmail));
        }
    });

    test('requires a customer name', () => {
        assert.equal(validateInvoiceInput({ ...VALID, customerName: '   ' }).ok, false);
        assert.equal(validateInvoiceInput({ ...VALID, customerName: null }).ok, false);
    });

    // Fat-finger guard — per line and in total, so splitting a mistyped figure
    // across two lines doesn't slip past.
    test('rejects amounts over the safety ceiling, per line and in total', () => {
        const overOneLine = validateInvoiceInput({
            ...VALID,
            lineItems: [{ description: 'Typo', amount: MAX_INVOICE_AMOUNT_RM + 1 }]
        });
        assert.equal(overOneLine.ok, false);
        assert.match(overOneLine.error, /limit/i);

        const overInTotal = validateInvoiceInput({
            ...VALID,
            lineItems: [
                { description: 'Half', amount: MAX_INVOICE_AMOUNT_RM * 0.6 },
                { description: 'Other half', amount: MAX_INVOICE_AMOUNT_RM * 0.6 }
            ]
        });
        assert.equal(overInTotal.ok, false);
        assert.match(overInTotal.error, /total/i);

        assert.equal(validateInvoiceInput({
            ...VALID, lineItems: [{ description: 'At the limit', amount: MAX_INVOICE_AMOUNT_RM }]
        }).ok, true, 'the ceiling itself is allowed');
    });

    test('rejects a currency other than MYR', () => {
        for (const currency of ['usd', 'sgd', 'MYRX', 123]) {
            assert.equal(validateInvoiceInput({ ...VALID, currency }).ok, false, 'must reject ' + currency);
        }
        assert.equal(validateInvoiceInput({ ...VALID, currency: 'MYR' }).ok, true, 'case-insensitive');
        const { currency, ...noCurrency } = VALID;
        assert.equal(validateInvoiceInput(noCurrency).ok, true, 'defaults to MYR');
    });

    test('rejects a missing or non-object body outright', () => {
        for (const body of [null, undefined, 'text', 42, []]) {
            assert.equal(validateInvoiceInput(body).ok, false);
        }
    });

    test('requires a description on every line', () => {
        assert.equal(validateInvoiceInput({ ...VALID, lineItems: [{ description: '  ', amount: 100 }] }).ok, false);
        assert.equal(validateInvoiceInput({ ...VALID, lineItems: [{ amount: 100 }] }).ok, false);
    });
});

describe('parsing the model-proposed invoice', () => {

    const GOOD = JSON.stringify({
        customerName: 'Aisyah',
        customerEmail: 'aisyah@example.com',
        lineItems: [{ description: 'Murano Queen', amount: 14371.55 }],
        currency: 'myr',
        clarifyingQuestion: null
    });

    test('reads a strict JSON reply', () => {
        const parsed = parseProposedInvoice(GOOD);
        assert.equal(parsed.customerName, 'Aisyah');
        assert.equal(parsed.customerEmail, 'aisyah@example.com');
        assert.equal(parsed.lineItems[0].amount, 14371.55);
        assert.equal(parsed.clarifyingQuestion, null);
    });

    // The prompt forbids fences; the code tolerates them anyway, because this
    // project verifies in code rather than trusting the model to comply.
    test('tolerates markdown fences the prompt told it not to use', () => {
        assert.equal(parseProposedInvoice('```json\n' + GOOD + '\n```').customerName, 'Aisyah');
        assert.equal(parseProposedInvoice('```\n' + GOOD + '\n```').customerName, 'Aisyah');
    });

    test('returns null for anything unparseable, rather than throwing', () => {
        for (const raw of ['', '   ', 'Sure! Here is the invoice:', '{broken', '[]', 'null', '42', null, undefined, {}]) {
            assert.equal(parseProposedInvoice(raw), null, 'must reject ' + JSON.stringify(raw));
        }
    });

    test('keeps a missing amount as null rather than zero', () => {
        const parsed = parseProposedInvoice(JSON.stringify({
            customerName: 'Aisyah',
            lineItems: [{ description: 'Wall bed', amount: null }, { description: 'Delivery' }],
            clarifyingQuestion: 'What is the price of the wall bed?'
        }));
        assert.equal(parsed.lineItems[0].amount, null, 'zero would look like a real amount in the form');
        assert.equal(parsed.lineItems[1].amount, null);
        assert.equal(parsed.clarifyingQuestion, 'What is the price of the wall bed?');
        assert.equal(parsed.customerEmail, null);
    });

    test('never hands back a currency other than MYR', () => {
        const parsed = parseProposedInvoice(JSON.stringify({ ...JSON.parse(GOOD), currency: 'usd' }));
        assert.equal(parsed.currency, 'myr');
    });
});

// ─────────────────────────────────────────────────────────────
// Product-name normalization. The two properties that matter are in tension,
// so both are pinned here: a recognisable alias should get tidied, and
// anything else must survive EXACTLY as the staff member typed it. The second
// is the important one — staff invoice real custom work, and a confidently
// wrong product name on a customer's invoice is worse than an untidy one.
// ─────────────────────────────────────────────────────────────
describe('product name normalization', () => {
    test('tidies a known alias into the catalog name', () => {
        assert.equal(normalizeProductName('murano q'), 'Murano Queen');
        assert.equal(normalizeProductName('gioco single desk'), 'Gioco Single Desk');
        assert.equal(normalizeProductName('murano k'), 'Murano King');
        assert.equal(normalizeProductName('murano sgl'), 'Murano Single');
    });

    test('ignores case, spacing and trailing noise words', () => {
        assert.equal(normalizeProductName('MURANO QUEEN SOFA'), 'Murano Queen Sofa');
        assert.equal(normalizeProductName('  murano   queen  '), 'Murano Queen');
        // "WB" for wall bed adds nothing that changes which product it is.
        assert.equal(normalizeProductName('Murano Queen WB'), 'Murano Queen');
        assert.equal(normalizeProductName('gioco bnk'), 'Gioco Bunk Bed');
    });

    test('prefers the more specific product when both fit', () => {
        // "Gioco Single" also matches this text; the longer name wins.
        assert.equal(normalizeProductName('gioco single desk'), 'Gioco Single Desk');
        assert.equal(normalizeProductName('zeta recliner chair'), 'Zeta Recliner Chair');
        assert.equal(normalizeProductName('zeta recliner'), 'Zeta Recliner');
    });

    test('leaves an unknown description exactly as typed', () => {
        for (const custom of [
            'custom cabinetry job',
            'delivery charge',
            'Site survey fee',
            'Balance payment for renovation work',
            'Deposit refund'
        ]) {
            assert.equal(normalizeProductName(custom), custom,
                'a custom line item must never be rewritten into a catalog product');
        }
    });

    test('does not rewrite when that would discard what the staff member typed', () => {
        // The colour and the word "frame" may well matter on the invoice, and
        // we cannot tell — so the whole description is left alone.
        assert.equal(normalizeProductName('velvet sofa bed royal blue'), 'velvet sofa bed royal blue');
        assert.equal(normalizeProductName('murano queen bed frame'), 'murano queen bed frame');
        assert.equal(normalizeProductName('2x murano queen'), '2x murano queen');
    });

    test('refuses to choose between two equally good matches', () => {
        // Arto Wardrobe comes in 1.6m and 1.8m; neither is more likely.
        assert.equal(normalizeProductName('arto wardrobe'), 'arto wardrobe');
        assert.equal(normalizeProductName('arto wardrobe 1.6m'), 'Arto Wardrobe 1.6m');
    });

    test('matches a one-word product name only when it is the whole description', () => {
        // "Zen" is a real product, and also an ordinary English word.
        assert.equal(normalizeProductName('Zen'), 'Zen');
        assert.equal(normalizeProductName('zen garden shelf'), 'zen garden shelf');
    });

    test('never throws, and never empties a non-empty description', () => {
        for (const input of [null, undefined, 42, {}, [], true]) {
            assert.equal(normalizeProductName(input), input, 'non-strings pass straight through');
        }
        assert.equal(normalizeProductName(''), '');
        assert.equal(normalizeProductName('   '), '   ');
        assert.equal(normalizeProductName('!!!'), '!!!');
    });

    test('the catalog is actually populated from the knowledge modules', () => {
        // A silent extraction failure would turn normalization into a no-op
        // without anything else noticing, so pin it here.
        assert.ok(PRODUCT_NAMES.length > 50, `expected a real catalog, got ${PRODUCT_NAMES.length}`);
        const names = PRODUCT_NAMES.map(p => p.name);
        for (const expected of ['Murano Queen', 'Gioco Single Desk', 'Theta Sofa', 'Ottoman Bed']) {
            assert.ok(names.includes(expected), `${expected} missing from the derived catalog`);
        }
    });

    test('the prompt reference carries names but never prices', () => {
        const reference = buildProductNameReference();
        assert.ok(reference.includes('Murano Queen'));
        // Handing the model a price list is exactly what would undermine the
        // "never invent an amount" rule the staff prompt depends on.
        assert.ok(!/RM\s*[\d,]/i.test(reference), 'the product reference must not contain any price');
        // Money-shaped figures specifically. Bare digits are fine and expected
        // — "Semplice 1200TC duvet sets" is a thread count, "Arto Wardrobe
        // 1.6m" a width — but a decimal or comma-grouped amount is not.
        assert.ok(!/\d[\d,]*\.\d{2}\b/.test(reference), 'no decimal amount in the product reference');
        assert.ok(!/\d{1,3}(,\d{3})+/.test(reference), 'no comma-grouped amount in the product reference');
    });

    test('applies to a parsed proposal, leaving custom lines untouched', () => {
        const parsed = parseProposedInvoice(JSON.stringify({
            customerName: 'Ahmad',
            customerEmail: 'ahmad@example.com',
            lineItems: [
                { description: 'murano q', amount: 14371.55 },
                { description: 'custom cabinetry job', amount: 5000 }
            ],
            currency: 'myr',
            clarifyingQuestion: null
        }));
        assert.equal(parsed.lineItems[0].description, 'Murano Queen');
        assert.equal(parsed.lineItems[1].description, 'custom cabinetry job');
        // Normalization must not have disturbed the amounts.
        assert.equal(parsed.lineItems[0].amount, 14371.55);
        assert.equal(parsed.lineItems[1].amount, 5000);
    });
});

// =============================================================
// POST /api/staff-resolve-price — the lookup the staff invoice form calls to
// pre-fill a price. Testable directly (unlike api/staff-create-invoice.js) only
// because it imports nothing but lib/staffAuth.js: no stripe, no network.
//
// Two properties matter here. It must refuse an unauthenticated caller like
// every other staff route, and a product it cannot price must come back as a
// plain "no" — an error would make the form look broken while a staff member is
// halfway through filling it in, when a custom line having no catalogue price
// is completely normal.
// =============================================================
describe('staff price lookup endpoint', () => {
    const cookie = `${STAFF_COOKIE_NAME}=${signStaffToken()}`;

    function makeRes() {
        const res = { statusCode: null, body: null, headers: {} };
        res.setHeader = (k, v) => { res.headers[k] = v; };
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (payload) => { res.body = payload; return res; };
        res.end = () => res;
        return res;
    }
    const call = async (req) => { const res = makeRes(); await resolvePriceHandler(req, res); return res; };
    const authed = (body) => ({ method: 'POST', headers: { host: 'x', cookie }, body });

    test('refuses a caller with no session, and leaks nothing', async () => {
        const res = await call({ method: 'POST', headers: { host: 'x' }, body: { productName: 'Murano Queen' } });
        assert.equal(res.statusCode, 401);
        assert.equal(res.body?.salePrice ?? null, null, 'a 401 must not carry a price');
    });

    test('refuses a forged session cookie', async () => {
        const res = await call({
            method: 'POST',
            headers: { host: 'x', cookie: `${STAFF_COOKIE_NAME}=${Date.now() + 999999}.${'a'.repeat(64)}` },
            body: { productName: 'Murano Queen' }
        });
        assert.equal(res.statusCode, 401);
    });

    test('rejects anything but POST', async () => {
        const res = await call({ method: 'GET', headers: { host: 'x', cookie }, body: {} });
        assert.equal(res.statusCode, 405);
    });

    test('resolves a catalog product to its canonical name and sale price', async () => {
        for (const [productName, label, salePrice] of [
            ['Murano Queen', 'Murano Queen', 14371.55],
            ['murano q', 'Murano Queen', 14371.55],
            ['gioco single desk', 'Gioco Single Desk', 17538.11],
            ['lumina', 'Lumina Sofa', 7069.30]
        ]) {
            const res = await call(authed({ productName }));
            assert.equal(res.statusCode, 200);
            assert.deepEqual(res.body, { resolved: true, label, salePrice }, `for "${productName}"`);
        }
    });

    test('an unpriceable product is a 200 "no", never an error', async () => {
        // The form treats this as "type the amount in yourself".
        for (const productName of ['delivery charge', 'custom cabinetry job', 'site survey fee', 'nebulatte', 'not a product at all']) {
            const res = await call(authed({ productName }));
            assert.equal(res.statusCode, 200, `"${productName}" must not error`);
            assert.deepEqual(res.body, { resolved: false, label: null, salePrice: null });
        }
    });

    test('an empty or blank name is not an error either', async () => {
        // The field is asked about whenever it changes, including being cleared.
        for (const productName of ['', '   ']) {
            const res = await call(authed({ productName }));
            assert.equal(res.statusCode, 200);
            assert.equal(res.body.resolved, false);
        }
    });

    test('rejects a non-string, a missing field, and an oversized name', async () => {
        for (const body of [{ productName: 42 }, { productName: null }, { productName: ['x'] }, {}]) {
            const res = await call(authed(body));
            assert.equal(res.statusCode, 400, `for ${JSON.stringify(body)}`);
        }
        assert.equal((await call(authed({ productName: 'x'.repeat(201) }))).statusCode, 400);
        assert.equal((await call(authed({ productName: 'x'.repeat(200) }))).statusCode, 200, '200 chars is within the cap');
    });

    test('a missing body does not crash the handler', async () => {
        const res = await call({ method: 'POST', headers: { host: 'x', cookie } });
        assert.equal(res.statusCode, 400);
    });

    test('never caches — a price change must not be served stale', async () => {
        const res = await call(authed({ productName: 'Murano Queen' }));
        assert.equal(res.headers['Cache-Control'], 'no-store');
    });

    test('the price it returns always matches the catalog table', async () => {
        // Guards against this endpoint and the tables drifting apart, which
        // would put a figure on an invoice that the bot never quotes.
        for (const model of WALLBED_MODEL_PRICING) {
            const res = await call(authed({ productName: model.label }));
            assert.equal(res.body.salePrice, model.sale, `${model.label} sale price`);
        }
        for (const sofa of BASIC_SOFA_PRICING) {
            const res = await call(authed({ productName: sofa.label }));
            assert.equal(res.body.salePrice, sofa.sale, `${sofa.label} sale price`);
        }
    });
});

// =============================================================
// Quantities, and the customer-facing detail fields.
//
// Quantity is the second factor in a line total, so it is as much a money
// input as the price is — these pin that it cannot smuggle a bad number past
// the RM 100,000 caps, and that the pre-quantity request shape still works,
// since every caller written before quantities existed sends a flat `amount`.
//
// The detail fields (address, contact, sales person, location) are the
// opposite kind of input: printed, never calculated. They are trimmed rather
// than rejected, because refusing to invoice over a long address line would be
// a worse outcome than a truncated one.
// =============================================================
describe('invoice line quantities', () => {
    const BASE = { customerName: 'Aisyah', customerEmail: 'aisyah@example.com' };
    const withLines = (lineItems, extra = {}) => validateInvoiceInput({ ...BASE, ...extra, lineItems });

    test('defaults to 1 when absent, null, or an empty box', () => {
        for (const quantity of [undefined, null, '', '   ']) {
            const result = withLines([{ description: 'Wall bed', quantity, unitAmount: 100 }]);
            assert.equal(result.ok, true, result.error);
            assert.equal(result.value.lineItems[0].quantity, 1, `for ${JSON.stringify(quantity)}`);
            assert.equal(result.value.totalRm, 100);
        }
    });

    test('accepts a whole number, as a number or a typed string', () => {
        assert.equal(withLines([{ description: 'X', quantity: 4, unitAmount: 25 }]).value.lineItems[0].quantity, 4);
        assert.equal(withLines([{ description: 'X', quantity: '4', unitAmount: 25 }]).value.lineItems[0].quantity, 4);
        assert.equal(withLines([{ description: 'X', quantity: ' 4 ', unitAmount: 25 }]).value.lineItems[0].quantity, 4);
    });

    test('rejects a fraction rather than rounding it', () => {
        // Rounding would change what the customer is billed for, and we cannot
        // know which way the staff member meant it.
        for (const quantity of [2.5, '2.5', 0.5, '1.0']) {
            const result = withLines([{ description: 'X', quantity, unitAmount: 10 }]);
            assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(quantity)}`);
            assert.match(result.error, /whole-number quantity/);
        }
    });

    test('rejects zero, negatives, and nonsense', () => {
        for (const quantity of [0, '0', -1, -3, 'two', true, {}, [], NaN, Infinity]) {
            assert.equal(withLines([{ description: 'X', quantity, unitAmount: 10 }]).ok, false,
                `expected rejection for ${JSON.stringify(quantity)}`);
        }
    });

    test('enforces a quantity ceiling, with the limit itself allowed', () => {
        assert.equal(withLines([{ description: 'X', quantity: MAX_LINE_QUANTITY, unitAmount: 0.01 }]).ok, true);
        const over = withLines([{ description: 'X', quantity: MAX_LINE_QUANTITY + 1, unitAmount: 0.01 }]);
        assert.equal(over.ok, false);
        assert.match(over.error, /quantity limit/);
    });

    test('the line total is quantity × unit price', () => {
        const result = withLines([
            { description: 'Wall bed', quantity: 2, unitAmount: 1000 },
            { description: 'Delivery', quantity: 3, unitAmount: 150 }
        ]);
        assert.equal(result.ok, true, result.error);
        assert.equal(result.value.totalRm, 2450);
        // Stripe is handed the UNIT price and multiplies by quantity itself.
        assert.deepEqual(result.value.lineItems.map(i => [i.quantity, i.unitAmountCents]), [[2, 100000], [3, 15000]]);
    });

    test('the per-line cap binds on the LINE TOTAL, not the unit price', () => {
        // The whole point of adding quantity to the cap: RM 2,000 is a fine
        // unit price, and 60 of them is not a fine invoice line.
        const over = withLines([{ description: 'X', quantity: 60, unitAmount: 2000 }]);
        assert.equal(over.ok, false, '60 × 2000 = 120,000 must be rejected');
        assert.match(over.error, /safety limit/);

        // Exactly at the ceiling is still allowed.
        const atCap = withLines([{ description: 'X', quantity: 50, unitAmount: 2000 }]);
        assert.equal(atCap.ok, true, atCap.error);
        assert.equal(atCap.value.totalRm, MAX_INVOICE_AMOUNT_RM);
    });

    test('the invoice cap sums line totals, not unit prices', () => {
        // Neither line is over on its own; together they are.
        const result = withLines([
            { description: 'A', quantity: 30, unitAmount: 2000 },
            { description: 'B', quantity: 30, unitAmount: 2000 }
        ]);
        assert.equal(result.ok, false);
        assert.match(result.error, /invoice total exceeds/);
    });

    test('reads the unit price from unitAmount, or from a legacy amount', () => {
        const modern = withLines([{ description: 'X', quantity: 2, unitAmount: 500 }]);
        const legacy = withLines([{ description: 'X', quantity: 2, amount: 500 }]);
        assert.equal(modern.value.lineItems[0].unitAmount, 500);
        assert.equal(legacy.value.lineItems[0].unitAmount, 500, 'a bare amount IS the unit price');
        assert.equal(legacy.value.totalRm, 1000);
        // unitAmount wins when both are present — it is the field the form sends.
        const both = withLines([{ description: 'X', unitAmount: 500, amount: 9999 }]);
        assert.equal(both.value.lineItems[0].unitAmount, 500);
    });

    test('the pre-quantity request shape still validates unchanged', () => {
        // Anything written before quantities existed sends {description, amount}
        // and must keep working, as one of each.
        const result = withLines([{ description: 'Murano Queen', amount: 14371.55 }]);
        assert.equal(result.ok, true, result.error);
        assert.deepEqual(result.value.lineItems[0], {
            description: 'Murano Queen', quantity: 1, unitAmount: 14371.55, unitAmountCents: 1437155
        });
        assert.equal(result.value.totalRm, 14371.55);
    });
});

describe('invoice customer-facing detail fields', () => {
    const BASE = {
        customerName: 'Aisyah',
        customerEmail: 'aisyah@example.com',
        lineItems: [{ description: 'Wall bed', unitAmount: 100 }]
    };
    const withExtra = (extra) => validateInvoiceInput({ ...BASE, ...extra });

    test('an invoice with none of them is unchanged', () => {
        const value = withExtra({}).value;
        for (const key of ['address', 'contact', 'salesPerson', 'location']) {
            assert.ok(!(key in value), `${key} must be absent, not empty`);
        }
    });

    test('a full address comes back in Stripe shape, defaulted to Malaysia', () => {
        const value = withExtra({
            address: { line1: ' 12 Jalan Satu ', line2: 'Unit 5', city: 'Kuala Lumpur', postalCode: '50000', state: 'WP' }
        }).value;
        assert.deepEqual(value.address, {
            line1: '12 Jalan Satu', country: 'MY', line2: 'Unit 5',
            city: 'Kuala Lumpur', postal_code: '50000', state: 'WP'
        });
    });

    test('line1 alone is enough, and the rest are omitted', () => {
        assert.deepEqual(withExtra({ address: { line1: '12 Jalan Satu' } }).value.address,
            { line1: '12 Jalan Satu', country: 'MY' });
    });

    test('an address with no line1 is dropped entirely', () => {
        // A city with no street is not worth printing, and a half-filled
        // address would overwrite a good one on a returning customer.
        for (const address of [{ city: 'KL', postalCode: '50000' }, { line1: '  ' }, {}, null, 'nope', []]) {
            assert.ok(!('address' in withExtra({ address }).value), `for ${JSON.stringify(address)}`);
        }
    });

    test('contact, sales person and location are trimmed and kept', () => {
        const value = withExtra({ contact: ' 012-345 6789 ', salesPerson: ' Aisyah ', location: ' Puchong ' }).value;
        assert.equal(value.contact, '012-345 6789');
        assert.equal(value.salesPerson, 'Aisyah');
        assert.equal(value.location, 'Puchong');
    });

    test('blank or non-string details are omitted, never sent empty', () => {
        // An empty custom field renders as an empty row on the customer's invoice.
        const value = withExtra({ contact: '   ', salesPerson: '', location: 42 }).value;
        for (const key of ['contact', 'salesPerson', 'location']) {
            assert.ok(!(key in value), `${key} must be absent`);
        }
    });

    test('over-length text is trimmed, never a reason to refuse the invoice', () => {
        const value = withExtra({
            contact: 'x'.repeat(500),
            address: { line1: 'y'.repeat(500) }
        }).value;
        assert.equal(value.contact.length, 100);
        assert.equal(value.address.line1.length, 200);
    });

    test('none of them can make a valid invoice invalid', () => {
        const result = withExtra({
            address: { line1: 'x'.repeat(999) }, contact: 'y'.repeat(999),
            salesPerson: { nope: true }, location: ['also nope']
        });
        assert.equal(result.ok, true, result.ok ? '' : result.error);
        assert.equal(result.value.totalRm, 100, 'the money is untouched by any of this');
    });
});

describe('buyer identifiers (IC/passport and TIN)', () => {
    const BASE = {
        customerName: 'Aisyah',
        customerEmail: 'aisyah@example.com',
        lineItems: [{ description: 'Wall bed', unitAmount: 100 }]
    };
    const withExtra = (extra) => validateInvoiceInput({ ...BASE, ...extra });

    test('both are captured and trimmed', () => {
        const value = withExtra({ icPassport: '  900101-14-5533  ', tin: ' IG5544332211 ' }).value;
        assert.equal(value.icPassport, '900101-14-5533');
        assert.equal(value.tin, 'IG5544332211');
    });

    test('an invoice without them carries neither key', () => {
        const value = withExtra({}).value;
        for (const key of ['icPassport', 'tin']) {
            assert.ok(!(key in value), `${key} must be absent, not empty`);
        }
    });

    test('blank or non-string values are omitted rather than sent empty', () => {
        // An empty metadata value would overwrite whatever an earlier invoice
        // captured for this customer.
        const value = withExtra({ icPassport: '   ', tin: 12345 }).value;
        for (const key of ['icPassport', 'tin']) {
            assert.ok(!(key in value), `${key} must be absent`);
        }
    });

    test('over-length input is cut to 40 characters, never refused', () => {
        const value = withExtra({ icPassport: 'A'.repeat(200), tin: 'B'.repeat(200) }).value;
        assert.equal(value.icPassport.length, 40);
        assert.equal(value.tin.length, 40);
    });

    test('unfamiliar formats are kept as typed', () => {
        // Passport and TIN formats vary by country and by taxpayer type;
        // rejecting one we do not recognise would block an invoice over a
        // field that carries no money.
        for (const id of ['X1234567', 'C 01 234 567 89', 'e-Invoice/EI00000000010']) {
            assert.equal(withExtra({ icPassport: id }).value.icPassport, id);
        }
    });

    test('neither can make a valid invoice invalid', () => {
        const result = withExtra({ icPassport: { nope: true }, tin: ['also nope'] });
        assert.equal(result.ok, true, result.ok ? '' : result.error);
        assert.equal(result.value.totalRm, 100, 'the money is untouched by either of them');
    });
});
