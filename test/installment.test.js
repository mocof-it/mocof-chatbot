// Tests for lib/installment.js — the bank credit-card installment reference
// figures printed on the invoice PDF.
//
// These are printed numbers, not charged ones, but a customer reads them off a
// MOCOF document and plans around them, so they are pinned exactly rather than
// checked for being roughly right.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { INSTALLMENT_RATES, computeInstallmentOptions } from '../lib/installment.js';

describe('the installment rate table', () => {
    test('holds the eight terms, in ascending order', () => {
        assert.deepEqual(
            INSTALLMENT_RATES.map(entry => entry.months),
            [3, 6, 12, 18, 24, 36, 48, 60]
        );
    });

    test('pins every rate', () => {
        // Rates are uniform across every participating bank and are not
        // waivable, so this table is the whole source of truth. A changed
        // figure here is a priced business decision, and should fail loudly.
        assert.deepEqual(
            INSTALLMENT_RATES.map(entry => entry.rate),
            [0.025, 0.03, 0.05, 0.07, 0.075, 0.09, 0.12, 0.14]
        );
    });

    test('is frozen, top level and per entry', () => {
        assert.equal(Object.isFrozen(INSTALLMENT_RATES), true);
        assert.ok(INSTALLMENT_RATES.every(Object.isFrozen));
    });
});

describe('computing installment options', () => {
    test('an RM 14,000 invoice produces the quoted figures', () => {
        // The worked example the terms were signed off against. Each row is
        // total payable then monthly, both to the sen.
        const expected = [
            [3, 14350, 4783.33],
            [6, 14420, 2403.33],
            [12, 14700, 1225.00],
            [18, 14980, 832.22],
            [24, 15050, 627.08],
            [36, 15260, 423.89],
            [48, 15680, 326.67],
            [60, 15960, 266.00]
        ];
        const actual = computeInstallmentOptions(14000);

        assert.equal(actual.length, expected.length);
        for (const [months, totalRm, monthlyRm] of expected) {
            const plan = actual.find(option => option.months === months);
            assert.ok(plan, `${months} months must be offered`);
            assert.equal(plan.totalRm, totalRm, `${months}-month total`);
            assert.equal(plan.monthlyRm, monthlyRm, `${months}-month monthly`);
        }
    });

    test('options come back in table order, carrying their rate', () => {
        const actual = computeInstallmentOptions(1000);
        assert.deepEqual(actual.map(o => o.months), INSTALLMENT_RATES.map(r => r.months));
        assert.deepEqual(actual.map(o => o.rate), INSTALLMENT_RATES.map(r => r.rate));
    });

    test('both figures are rounded to the sen, never left as binary noise', () => {
        // 0.1 + 0.2 arithmetic leaks long decimals into anything printed.
        for (const price of [333.33, 1999.99, 7777.77, 12345.67, 0.01]) {
            for (const plan of computeInstallmentOptions(price)) {
                for (const key of ['totalRm', 'monthlyRm']) {
                    assert.equal(
                        Math.round(plan[key] * 100) / 100, plan[key],
                        `${price} / ${plan.months}mo ${key} = ${plan[key]}`
                    );
                }
            }
        }
    });

    test('the monthly figure divides the rounded total, not the raw product', () => {
        // Both numbers are printed on the same table, so the monthly has to be
        // consistent with the total beside it rather than with a figure the
        // customer never sees.
        for (const price of [14000, 8999.95, 250.55]) {
            for (const plan of computeInstallmentOptions(price)) {
                assert.equal(plan.monthlyRm, Math.round((plan.totalRm / plan.months) * 100) / 100);
            }
        }
    });

    test('the total is always the price plus its interest, never less', () => {
        for (const price of [100, 14000, 99999.99]) {
            for (const plan of computeInstallmentOptions(price)) {
                assert.ok(plan.totalRm >= price, `${plan.months}mo must not undercut the price`);
                assert.ok(
                    Math.abs(plan.totalRm - price * (1 + plan.rate)) <= 0.005,
                    `${plan.months}mo total must be the price plus ${plan.rate}`
                );
            }
        }
    });

    test('an unusable price yields no options rather than throwing', () => {
        // The caller runs this AFTER a real invoice has been finalized. An
        // exception there would be caught by the endpoint's handler and
        // reported as a failure for an invoice the customer has already been
        // sent — far worse than a missing reference table.
        for (const price of [0, -1, NaN, Infinity, -Infinity, null, undefined, '14000', {}, []]) {
            assert.deepEqual(
                computeInstallmentOptions(price), [],
                `${JSON.stringify(price)} must produce no options`
            );
        }
    });

    test('a fresh array comes back each call, so a caller cannot poison the table', () => {
        const first = computeInstallmentOptions(1000);
        first[0].monthlyRm = 1;
        first.length = 1;
        const second = computeInstallmentOptions(1000);
        assert.equal(second.length, 8);
        assert.equal(second[0].monthlyRm, 341.67);
    });
});
