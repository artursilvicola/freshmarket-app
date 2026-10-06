# PreConnect email copy and supplier notification review

Prepared for Claude on 2026-10-06. Branch: `fix/preconnect-mail-copy`, based on
`303ff27`. Not deployed; no production data changes or emails sent during this change.

## Requested behavior

Use proposals terminology in the buyer mailing. Do not email the supplier merely
because the administrator sent the optional retailer mailing: the buyer may have
already viewed the proposal in the application, independently of that mailing.
Keep notifications of buyer reads and the existing credit settlement rules.

## Changes

- `render-retailer-email.js`: Polish introduction uses the appropriate form of
  "propozycja", including singular accusative and counts 12, 22, 112 and 122.
  English retains the existing submission/submissions terminology.
- `send-retailer-batch.js`: removed the supplier notification after the successful
  buyer mailing. Buyer emails, magic links, eligibility, and the narrow
  `mark_legacy_sends_retailer_emailed` RPC are unchanged.
- `supplier-email-templates.js`: removed both retired template aliases
  `offer_sent_to_retailer` and `offers_sent_to_retailer`. The generic notification
  endpoint rejects them without sending an email. Approval mail in PL and EN no
  longer promises a later mailing confirmation; it directs users to the panel.
- Supplier read notifications remain enabled. No changes to billing, category
  routing, RLS, RPC definitions, database schema, or saved user content.

## Recipient language

Buyer batch mail uses each buyer's `profiles.locale`, not the administrator's
language. Supplier read mail uses the supplier owner's `profiles.locale`. Missing
locale defaults to Polish. These behaviors were already present and are now
covered by regression tests with the real renderers.

Email boilerplate is localized. Supplier-entered text is not automatically
translated during sending: English buyer mail uses saved `offer.i18n_en` fields
where present and otherwise retains the original text. This patch does not claim
that every free-text field will always be translated.

## Verification

- `npm test`: 78 files, 619 tests passed.
- `npm run build`: passed; Vite reports its large-chunk size warning.
- `git diff --check`: passed.
- Tests cover PL plural forms, mixed PL/EN recipients, missing locale, no supplier
  email after successful mailing despite an available active supplier recipient,
  rejection of retired template names, corrected approval copy, and retained
  supplier read mail in PL/EN. Existing credit/race regression tests also pass.
- Database and email transport are mocked; no post-deployment live check was run.

## Review and release

Review this branch before any separately authorized production deployment.
No migration is needed. A later smoke test should use only isolated test accounts:
one buyer mailing, no supplier sent confirmation, correct recipient language,
and the existing supplier read notification when the test buyer views the proposal.
Do not replay production sends or reset delivery/billing markers for this check.
