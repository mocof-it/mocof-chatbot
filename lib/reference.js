// =============================================================
// FILE: lib/reference.js
// Generates a human-readable quote reference used as the tie-breaker
// between a chat conversation and its Stripe deposit payment.
// =============================================================

import { randomBytes } from 'node:crypto';

// Format: MQS-YYYYMMDD-XXXXXX (MQS = "MOCOF Quote/Stripe").
// NOT a sequential counter — a serverless function has no shared state
// between invocations without an external DB, so a monotonic "-001,
// -002..." suffix (as sketched in the proposal) isn't achievable without
// adding a datastore purely to count references. Collision risk instead:
// a 6-char base32 suffix is 32^6 (~1.07 billion) combinations per day,
// which is effectively collision-free at MOCOF's real volume — if that
// ever needs revisiting, switch the suffix source to a DB sequence
// instead of randomBytes.
const SUFFIX_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I — avoids human transcription errors
const SUFFIX_LENGTH = 6;

function todayStamp(date = new Date()) {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}

function randomSuffix(length = SUFFIX_LENGTH) {
    const bytes = randomBytes(length);
    let out = '';
    for (let i = 0; i < length; i++) {
        out += SUFFIX_ALPHABET[bytes[i] % SUFFIX_ALPHABET.length];
    }
    return out;
}

export function generateQuoteRef(date = new Date()) {
    return `MQS-${todayStamp(date)}-${randomSuffix()}`;
}

// Matches generateQuoteRef()'s own output — used by tests and by anything
// that needs to validate a ref came from this function (e.g. before trusting
// one echoed back from a webhook payload).
export const QUOTE_REF_PATTERN = /^MQS-\d{8}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
