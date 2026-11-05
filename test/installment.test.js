// Tests for lib/installment.js and the installment half of
// lib/invoiceInput.js — MOCOF's own installment terms.
//
// These numbers are CHARGED, not printed as reference: choosing a term adds
// interest to the invoice and Stripe collects the larger figure. So the terms,
// the arithmetic, and the refusal to honour anything outside the two offered
// terms are all pinned exactly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    INSTALLMENT_TERMS,
    INSTALLMENT_MONTHS,
    findInstallmentTerm,
    computeInstallmentPlan
} from '../lib/installment.js';
import { validateInvoiceInput, MAX_INVOICE_AMOUNT_RM } from '../lib/invoiceInput.js';

describe('the MOCOF installment terms', () => {
    test('are exactly 6 and 12 months, in order', () => {
        // Longer terms are "subject to approval" and arranged off-tool. A term
        // this table does not carry cannot be invoiced here at all, so adding
        // one is a priced business decision and should fail loudly here first.
        assert.deepEqual(INSTALLMENT_TERMS.map(t => t.months), [6, 12]);
        assert.deepEqual([...INSTALLMENT_MONTHS], [6, 12]);
    });

    test('carry the agreed rates', () => {
        assert.deepEqual(INSTALLMENT_TERMS.map(t => t.rate), [0.03, 0.05]);
    });

    test('are frozen, top level and per entry', () => {
        assert.equal(Object.isFrozen(INSTALLMENT_TERMS), true);
        assert.ok(INSTALLMENT_TERMS.every(Object.isFrozen));
        assert.equal(Object.isFrozen(INSTALLMENT_MONTHS), true);
    });

    test('the old eight-term bank table is gone', () => {
        // The previous build printed 3/6/12/18/24/36/48/60-month BANK plans as
        // display-only reference. MOCOF is the lender now, so a stray long term
        // left behind would be a rate nobody agreed to, on the money path.
        const source = readFileSync(new URL('../lib/installment.js', import.meta.url), 'utf8');
        for (const gone of ['0.025', '0.07', '0.075', '0.09', '0.12', '0.14']) {
            assert.doesNotMatch(source, new RegExp(gone.replace('.', '\\.')),
                `rate ${gone} belonged to the bank table and must not remain`);
        }
    });

    test('findInstallmentTerm accepts only an offered term', () => {
        assert.deepEqual(findInstallmentTerm(6), { months: 6, rate: 0.03 });
        assert.deepEqual(findInstallmentTerm(12), { months: 12, rate: 0.05 });
        for (const months of [3, 18, 24, 36, 48, 60, 0, -6, 6.5, '6', null, undefined, NaN]) {
            assert.equal(findInstallmentTerm(months), null, `must reject ${JSON.stringify(months)}`);
        }
    });
});

describe('computing an installment plan', () => {
    test('RM 14,000 over 6 months', () => {
        assert.deepEqual(computeInstallmentPlan(14000, 6), {
            months: 6, rate: 0.03, interestRm: 420, totalRm: 14420, monthlyRm: 2403.33
        });
    });

    test('RM 14,000 over 12 months', () => {
        assert.deepEqual(computeInstallmentPlan(14000, 12), {
            months: 12, rate: 0.05, interestRm: 700, totalRm: 14700, monthlyRm: 1225.00
        });
    });

    test('the total is the base plus the interest, exactly', () => {
        for (const base of [100, 250.55, 8999.95, 14000, 37500.01]) {
            for (const months of INSTALLMENT_MONTHS) {
                const plan = computeInstallmentPlan(base, months);
                assert.equal(plan.totalRm, Math.round((base + plan.interestRm) * 100) / 100,
                    `${base} / ${months}mo`);
                assert.ok(plan.totalRm > base, 'interest can only ever push the figure up');
            }
        }
    });

    test('every figure is rounded to the sen', () => {
        // Binary floating point leaks long decimals into anything printed, and
        // these figures are printed on an invoice AND charged.
        for (const base of [333.33, 1999.99, 7777.77, 12345.67, 0.01]) {
            for (const months of INSTALLMENT_MONTHS) {
                const plan = computeInstallmentPlan(base, months);
                for (const key of ['interestRm', 'totalRm', 'monthlyRm']) {
                    assert.equal(Math.round(plan[key] * 100) / 100, plan[key],
                        `${base} / ${months}mo ${key} = ${plan[key]}`);
                }
            }
        }
    });

    test('the monthly figure divides the rounded total', () => {
        // Both are printed on the same document, so the monthly has to agree
        // with the total beside it rather than with an intermediate nobody sees.
        for (const base of [14000, 8999.95, 250.55]) {
            for (const months of INSTALLMENT_MONTHS) {
                const plan = computeInstallmentPlan(base, months);
                assert.equal(plan.monthlyRm, Math.round((plan.totalRm / months) * 100) / 100);
            }
        }
    });

    test('an unoffered term throws rather than quietly pricing something', () => {
        // The opposite of the old display-only function, which returned an
        // empty array so a cosmetic failure could not break an invoice. These
        // numbers are charged: an unrecognised term must stop the invoice, not
        // produce one at the wrong price.
        for (const months of [3, 18, 24, 36, 48, 60, 0, -6, 6.5, '6', null, undefined, NaN]) {
            assert.throws(() => computeInstallmentPlan(14000, months), RangeError,
                `must throw for ${JSON.stringify(months)}`);
        }
    });

    test('an unusable base throws', () => {
        for (const base of [0, -1, NaN, Infinity, -Infinity, null, undefined, '14000', {}, []]) {
            assert.throws(() => computeInstallmentPlan(base, 12), TypeError,
                `must throw for ${JSON.stringify(base)}`);
        }
    });
});

describe('installments on a validated invoice', () => {
    const invoice = (extra = {}) => validateInvoiceInput({
        customerName: 'Ahmad Rahman',
        customerEmail: 'ahmad@example.com',
        lineItems: [{ description: 'Murano Queen', unitAmount: 14000 }],
        ...extra
    });

    test('no term behaves exactly as before', () => {
        const value = invoice().value;
        assert.equal(value.totalRm, 14000);
        for (const key of ['installmentPlan', 'baseTotalRm']) {
            assert.ok(!(key in value), `${key} must be absent on a pay-in-full invoice`);
        }
    });

    test('null or absent is pay-in-full, not a rejection', () => {
        for (const installmentMonths of [null, undefined]) {
            const result = invoice({ installmentMonths });
            assert.equal(result.ok, true);
            assert.ok(!('installmentPlan' in result.value));
        }
    });

    test('6 months makes the amount owed RM 14,420', () => {
        const value = invoice({ installmentMonths: 6 }).value;
        assert.equal(value.baseTotalRm, 14000, 'the line items are untouched');
        assert.equal(value.totalRm, 14420, 'totalRm is what the customer owes');
        assert.equal(value.installmentPlan.interestRm, 420);
        assert.equal(value.installmentPlan.monthlyRm, 2403.33);
    });

    test('12 months makes the amount owed RM 14,700', () => {
        const value = invoice({ installmentMonths: 12 }).value;
        assert.equal(value.totalRm, 14700);
        assert.equal(value.installmentPlan.interestRm, 700);
        assert.equal(value.installmentPlan.monthlyRm, 1225.00);
    });

    test('a term outside 6/12 is rejected, never ignored', () => {
        // Silently billing in full a customer who was promised 12 months is
        // exactly the kind of quiet wrong answer this project refuses.
        for (const installmentMonths of [3, 18, 24, 60, 0, -6, 6.5, '6', '12', 'twelve', true, {}, [], NaN]) {
            const result = invoice({ installmentMonths });
            assert.equal(result.ok, false, `must reject ${JSON.stringify(installmentMonths)}`);
            assert.match(result.error, /installment term/i);
        }
    });

    test('a client-supplied interest or total is ignored entirely', () => {
        // The only thing a request chooses is the term. Everything else is
        // recomputed from the line items on this side of the wire.
        const value = invoice({
            installmentMonths: 12,
            totalRm: 1,
            baseTotalRm: 1,
            interestRm: 1,
            installmentPlan: { months: 12, rate: 9.99, interestRm: 1, totalRm: 1, monthlyRm: 1 }
        }).value;
        assert.equal(value.totalRm, 14700);
        assert.equal(value.baseTotalRm, 14000);
        assert.deepEqual(value.installmentPlan, {
            months: 12, rate: 0.05, interestRm: 700, totalRm: 14700, monthlyRm: 1225.00
        });
    });

    test('the RM 100,000 cap binds on the INTEREST-INCLUSIVE total', () => {
        const justUnder = { lineItems: [{ description: 'Job', unitAmount: 99000 }] };
        assert.equal(invoice(justUnder).ok, true, 'RM 99,000 payable in full is fine');

        const over = invoice({ ...justUnder, installmentMonths: 12 });
        assert.equal(over.ok, false, 'RM 99,000 + 5% is RM 103,950 and must be refused');
        // The message has to name the post-interest figure, or "your RM 99,000
        // order is over the RM 100,000 limit" reads as a bug.
        assert.match(over.error, /103,950/);
        assert.match(over.error, /12 months/);
    });

    test('a term cannot be used to slip past the cap', () => {
        for (const months of INSTALLMENT_MONTHS) {
            const result = invoice({
                lineItems: [{ description: 'Job', unitAmount: MAX_INVOICE_AMOUNT_RM }],
                installmentMonths: months
            });
            assert.equal(result.ok, false, `${months}mo on a maxed-out invoice must be refused`);
        }
    });

    test('quantities are priced before the interest, not after', () => {
        // 3 x RM 1,000 = RM 3,000 base, then 5% of the whole order.
        const value = validateInvoiceInput({
            customerName: 'A', customerEmail: 'a@b.co',
            lineItems: [{ description: 'Chair', quantity: 3, unitAmount: 1000 }],
            installmentMonths: 12
        }).value;
        assert.equal(value.baseTotalRm, 3000);
        assert.equal(value.installmentPlan.interestRm, 150);
        assert.equal(value.totalRm, 3150);
    });

    test('interest applies to the whole order, not per line', () => {
        const value = validateInvoiceInput({
            customerName: 'A', customerEmail: 'a@b.co',
            lineItems: [
                { description: 'Bed', unitAmount: 10000 },
                { description: 'Delivery', unitAmount: 4000 }
            ],
            installmentMonths: 6
        }).value;
        assert.equal(value.baseTotalRm, 14000);
        assert.equal(value.totalRm, 14420, 'one 3% charge on RM 14,000, not two');
    });

    test('validateInvoiceInput still never throws, whatever the term', () => {
        // computeInstallmentPlan() throws by design; the term is checked against
        // the table first so that throw is unreachable from a request.
        for (const installmentMonths of [3, 'x', {}, [], NaN, Infinity, -1, 6.000001]) {
            assert.doesNotThrow(() => invoice({ installmentMonths }));
        }
    });
});

// ── Drift guard ─────────────────────────────────────────────────
// public/staff.html carries its own copy of the terms, for one reason: the
// summary previews the interest before any invoice exists, and a browser cannot
// import a server module. Nothing printed for a customer comes from that copy —
// but a stale rate there would quote a figure the server then refuses to
// charge, so the two are pinned together here.
describe('the staff page mirrors the server rate table', () => {
    const page = readFileSync(new URL('../public/staff.html', import.meta.url), 'utf8');

    test('MOCOF_INSTALLMENT_TERMS matches INSTALLMENT_TERMS exactly', () => {
        const block = page.match(/var MOCOF_INSTALLMENT_TERMS = \[([\s\S]*?)\];/);
        assert.ok(block, 'the page must declare MOCOF_INSTALLMENT_TERMS');

        const mirrored = [...block[1].matchAll(/months:\s*(\d+),\s*rate:\s*([\d.]+)/g)]
            .map(([, months, rate]) => ({ months: Number(months), rate: Number(rate) }));

        assert.deepEqual(mirrored, INSTALLMENT_TERMS.map(t => ({ months: t.months, rate: t.rate })));
    });

    test('the page offers exactly the terms the server accepts', () => {
        // A <option> the validator would reject is a dead end the staff member
        // only discovers after filling the whole form in.
        const offered = [...page.matchAll(/<option value="(\d+)">/g)].map(([, v]) => Number(v));
        assert.deepEqual(offered, [...INSTALLMENT_MONTHS]);
    });

    test('no bank-plan wording survives on the page', () => {
        // MOCOF is the lender. Telling a customer their bank approves the plan
        // would be wrong about who they owe.
        for (const gone of ['Maybank', 'Standard Chartered', 'participating bank', 'your bank']) {
            assert.doesNotMatch(page, new RegExp(gone, 'i'), `"${gone}" must be gone`);
        }
    });
});
