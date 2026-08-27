# Google Sheets logging — credential ownership

This document explains a setup issue you'll likely hit configuring
`lib/sheetsLogger.js`, and why the fix is a specific kind of Google account, not
just "any account that works."

## The problem

`lib/sheetsLogger.js` authenticates to the Google Sheets API as a **service
account**, using a downloadable JSON key (`GOOGLE_SERVICE_ACCOUNT_EMAIL` +
`GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`). Many Google Cloud organizations —
including Workspace domains set up in the last few years — enforce an
organization policy called `iam.disableServiceAccountKeyCreation` by default.
When it's active, attempting to create a service-account key fails with:

> An organization policy that blocks service account key creation has been
> enforced on your organization.

This is a security default, not a bug, and it typically can't be worked around
by an individual developer without elevated org-level permissions
(`Organization Policy Administrator`, a role distinct from being a Workspace
super admin).

## Why the fix isn't "use a personal Google account"

It's tempting to just create the Cloud project and service account under
whichever personal Google account is handy — a personal account has no
Workspace/Cloud org attached to it, so it's never subject to this policy, and
it unblocks you immediately.

**Don't do this for a production integration.** Whoever's personal account
holds the credential becomes a silent single point of failure and an access
question the day they're no longer involved with the project — which, for an
intern or contractor role, is a certainty, not a risk. Nobody should need to
ask a former team member to rotate a key, and the business shouldn't have a
production integration it doesn't actually control.

## The actual fix: a Google account MOCOF owns

A dedicated Google account has been created for this: **`mocof.chatbot@gmail.com`**.
It hosts the Cloud project, the service account, and the Sheets API enablement
for this integration — owned by MOCOF as a business, not by any individual
developer.

This solves both problems at once:

- **No org policy blocker.** A standalone account with no Workspace/Cloud org
  node attached isn't subject to `iam.disableServiceAccountKeyCreation` —
  that policy only applies to Cloud projects living under an organization.
  An unaffiliated account is exempt by construction, the same mechanism that
  makes the "personal Gmail" workaround technically work — just owned by the
  right party this time.
- **No succession problem.** When a developer's involvement ends, MOCOF
  retains full control: rotate the key, hand credentials to the next
  developer, or shut the integration down — none of it depends on any one
  person.

**Important — this only holds if MOCOF actually controls the account itself.**
Naming it `mocof.chatbot@gmail.com` doesn't by itself make it business-owned —
that's only true once its own login credentials (password, and whatever phone
number or recovery email is attached to it) are in MOCOF's password manager
or held by someone at the business, not sitting only in the developer's head,
personal password manager, or browser autofill. If that hasn't happened yet,
do it before this account is considered production-ready — the whole point
was to avoid a credential only one person can access.

The target Google Sheet doesn't need to live under this same account — sharing
a Sheet with an email address works regardless of which Cloud org that email's
project belongs to, exactly like sharing with any external collaborator. The
Sheet can stay in MOCOF's real Workspace/Drive; only the *service account*
needs to live under the dedicated account.

## Setup steps (already completed — kept here for reference)

These have already been done under `mocof.chatbot@gmail.com` for this
project. Kept here in case the account or key ever needs to be recreated, or
you're setting up a similar Google API integration elsewhere.

1. Dedicated Google account created (`mocof.chatbot@gmail.com`), owned and
   controlled by MOCOF.
2. Under that account, in Google Cloud Console: created a project, enabled
   the **Google Sheets API** (APIs & Services → Library).
3. IAM & Admin → Service Accounts → Create Service Account. No project-level
   roles needed — access is granted by sharing the Sheet directly, next.
4. Service account → Keys tab → Add Key → Create new key → JSON downloaded.
   Treat this file like a password.
5. The destination Google Sheet (wherever it lives — MOCOF's real
   Workspace/Drive is fine) → Share → added the service account's email
   (`...@<project-id>.iam.gserviceaccount.com`, from the JSON's
   `client_email`) as an **Editor**.
6. From the JSON: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
   `private_key` → `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`. Sheet ID (from its
   URL, between `/d/` and `/edit`) → `GOOGLE_SHEETS_SPREADSHEET_ID`. These
   are set in Vercel → Project Settings → Environment Variables.

## The Sheet's columns

`logDepositToSheet()` appends one row per confirmed deposit into the range
`<tab>!A:K`. Use this as the header row when creating or updating the sheet —
the columns must be in exactly this order:

| Col | Header | Value |
|---|---|---|
| A | Timestamp | ISO 8601, set when the row is written |
| B | Quote Ref | `MQS-YYYYMMDD-XXXXXX` |
| C | Wall Bed Model | e.g. `Murano Queen Sofa` |
| D | Grand Total | Full quoted amount, RM |
| E | Deposit % | Currently always `10` |
| F | Deposit Paid | Amount actually charged, RM |
| G | Customer Email | From Stripe Checkout |
| H | Customer Name | From Stripe Checkout |
| I | Customer Phone | From Stripe Checkout |
| J | Stripe Session ID | `cs_...` |
| K | Cabinets | `Yes` / `No` |

Columns G–I are collected by Stripe's hosted checkout page, not by the chat
widget — the widget never asks for contact details. Any of them can be blank
if Stripe didn't capture one.

**This is a stored data format.** Two rules when changing it:

- The write range in `lib/sheetsLogger.js` must be exactly as wide as the row
  array. A row longer than its range is silently **truncated** by the Sheets
  API rather than rejected, so a mismatch loses data with no error anywhere.
- Prefer appending new columns at the end. Inserting one shifts every column
  after it, and rows already written keep the old layout — they'd need
  rearranging by hand.

The same table is in [CLAUDE.md](CLAUDE.md) alongside the rest of the
architecture notes, and `test/consistency.test.js` pins the order, the row
width against the range, and the Yes/No mapping. Update all three together.

## If MOCOF has an IT-managed Workspace and wants this centralized there instead

Have whoever administers that Workspace grant a **project-level exception**
rather than disabling the policy org-wide:

1. IAM & Admin → Organization Policies
2. Find `iam.disableServiceAccountKeyCreation`
3. Manage policy → add a rule scoped to just this specific Cloud project → set
   to not enforced

This requires someone with the `Organization Policy Administrator` role
specifically (not just Workspace super admin — those aren't the same
permission) and is slower to arrange than the dedicated-account approach, but
keeps everything under one governed org if that matters for your setup.

## For whoever inherits this project

The Google Sheets credentials are provisioned under `mocof.chatbot@gmail.com`,
a Google account owned by MOCOF — not tied to any individual developer's
personal account. Its login credentials should be in MOCOF's password
manager or held by someone at the business (see the note above); if you find
they're only known to a former developer, treat that as something to fix
immediately — reset the account password and rotate the service-account key.