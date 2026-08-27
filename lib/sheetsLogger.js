// =============================================================
// FILE: lib/sheetsLogger.js
// Appends a row to a Google Sheet for every confirmed deposit, so MOCOF
// can see who paid, how much, and for what without digging through Vercel
// logs or Resend. Rebuilds the "lead logging" feature that was removed
// from main on Aug 20 — this time scoped to deposits only, called from
// stripe-webhook.js.
//
// Uses a Google service account + a hand-signed JWT via Node's built-in
// crypto module, exchanged for a short-lived access token via Google's
// OAuth token endpoint, then a plain REST call to the Sheets API. No
// googleapis/google-auth-library dependency — same "raw fetch, no SDK"
// approach as notifyCompany()'s Resend integration, since this project
// otherwise has zero runtime dependencies beyond stripe.
//
// Env vars (all optional — if any are missing, this just logs and
// no-ops, exactly like notifyCompany() does without EMAIL_API_KEY):
//   GOOGLE_SHEETS_SPREADSHEET_ID     — the ID from the sheet's URL
//   GOOGLE_SERVICE_ACCOUNT_EMAIL     — from the service account JSON key
//   GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY — from the same JSON key (see setup
//                                        notes below for the \n handling)
//   GOOGLE_SHEETS_TAB_NAME           — defaults to "Deposits" if unset
// =============================================================

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
}

// Vercel's env var UI stores multi-line values as literal "\n" escape
// sequences rather than real newlines — the private key has to have its
// actual PEM line breaks restored before crypto.createSign() can use it.
function normalizePrivateKey(key) {
    return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

async function getAccessToken(clientEmail, privateKey) {
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const claimSet = base64url(JSON.stringify({
        iss: clientEmail,
        scope: SCOPE,
        aud: TOKEN_URL,
        iat: now,
        exp: now + 3600
    }));

    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claimSet}`);
    signer.end();
    const signature = base64url(signer.sign(normalizePrivateKey(privateKey)));

    const jwt = `${header}.${claimSet}.${signature}`;

    const res = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt
        })
    });

    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Google token exchange failed: ${res.status} ${errText}`);
    }

    const data = await res.json();
    return data.access_token;
}

// Never let a logging failure reach the caller — same rule as
// notifyCompany(). The deposit is already durably recorded by Stripe;
// this is a convenience log, not the source of truth, so it must never
// turn a successful webhook into a 500 that makes Stripe retry.
export async function logDepositToSheet(details) {
    const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
    const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

    if (!spreadsheetId || !clientEmail || !privateKey) {
        console.log('Deposit not logged to Sheets (no Sheets config set):', JSON.stringify(details));
        return;
    }

    const tabName = process.env.GOOGLE_SHEETS_TAB_NAME || 'Deposits';

    try {
        const accessToken = await getAccessToken(clientEmail, privateKey);

        // Column order is a stored data format — rows already in the Sheet are
        // written this way, and `range` below must always be exactly as wide as
        // this array. A row LONGER than its range is silently truncated by the
        // Sheets API rather than rejected, so a mismatch loses data quietly.
        // Documented in CLAUDE.md and GOOGLE_SHEETS_CREDENTIALS.md; covered by
        // test/consistency.test.js.
        //
        // The three customer contact fields are grouped together deliberately
        // rather than appended at the end. That INSERTED two columns ahead of
        // Stripe Session ID, moving it from H to J — any row written before
        // this change is misaligned from column H onward and needs fixing by
        // hand. Prefer appending at the end for future additions; only reorder
        // again if the Sheet is known to be empty.
        const row = [
            new Date().toISOString(),
            details.quoteRef || '',
            details.wallBedModel || '',
            details.grandTotal || '',
            details.depositPercent || '',
            details.depositAmountPaid || '',
            details.customerEmail || '',
            details.customerName || '',
            details.customerPhone || '',
            details.stripeSessionId || '',
            details.cabinets || ''
        ];

        const range = `${tabName}!A:K`;
        const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`;

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ values: [row] })
        });

        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error('logDepositToSheet: Sheets API returned an error:', res.status, errText);
            return;
        }

        console.log('Deposit logged to Sheet:', details.stripeSessionId);
    } catch (err) {
        console.error('logDepositToSheet: failed to log deposit:', err.message || err);
    }
}

// ── Test-only named exports ─────────────────────────────────────
// Same rationale as api/chat.js's own test-only export block: these are the
// exact function references used by logDepositToSheet() above. Exporting them
// changes no behavior — it just lets test/*.test.js exercise the hand-rolled
// JWT signing directly, which otherwise could only be reached by configuring a
// live Google service account and letting the function make real network calls.
export {
    base64url,
    normalizePrivateKey,
    getAccessToken
};