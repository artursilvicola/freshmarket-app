# FM 2026 payment-priority dates: applied 17 September 2026

## Approved rule

Artur approved every row marked ZGODNE in the source sheet, including the four
previously labelled PREMIUM. Use column G without reinterpretation of older notes.
Every company absent from the sheet counts as paid on 2026-09-17 for algorithm
priority. This is an administrative priority date, not accounting proof of payment.
Package counts and Business/Premium tiers must not change.

Source: https://docs.google.com/spreadsheets/d/1EkRNfEkcDuVeVq8WdEh92k9NNkHCJzUsevk5bZtjbWs/edit?gid=1316469414
Range: 'Firmy B2B'!A7:L111. Reviewed snapshot: 105 rows, 105 unique company UUIDs,
105 ZGODNE statuses, valid ISO dates. UUIDs, not fuzzy names, identify companies.

## Production result

- Schema migration 20260917120519 / fm_payment_date_guard applied at 14:05 Warsaw.
- Data migration 20260917121000 / fm_payment_dates_20260917_approved applied at 14:10.
- 105 sheet dates match the database exactly; zero mismatches.
- One additional active participant, Hellenic Land - Saitis ABEE, has 2026-09-17.
- All 106 active participants have a date, with 106 matching server-side audit rows.
- No company has a null date. Existing and future unlisted companies default to 17 September.
- No package counts, tiers, participation flags, phase, deadlines, decisions, queues,
  or plans changed. No emails, algorithm execution, or plan publication.

The first import was rolled back by its exact-name guard: Fresh roots had become
Fresh Roots. Read-only inspection confirmed identical UUID, country and two packages.
Only that row's expected current spelling was refreshed. The original source name
remains in the private input and audit; the current name was preserved in the database.
An initial execute_sql attempt could not create a temporary table because that tool
uses a read-only transaction. Neither failed attempt committed any import data.

## Protection and algorithm

The new DATE column has default 2026-09-17. A separate invoker trigger preserves the
old date on non-admin UPDATE and forces the default on non-admin INSERT. The existing
055 protected-fields trigger is untouched. No grants, RLS or buyer-contact access changed.
Admin/service writes continue to use the existing fm_is_privileged_session helper.

The current frontend (origin/main c60269f at inspection) already reads fm_payment_date
into paymentDate. The algorithm uses score descending, payment date ascending,
package tier and stable order to break remaining ties. Dates do not override buyer
decisions. No frontend rebuild or deployment was required. Refresh an already-open
admin application before a future calculation so it loads the new values.

## Backup and comparison

Private directory: C:\Users\Artur\FreshMarket-Backups\

- FM-PAYMENTS-20260917-before: 13:59:56 Warsaw, SHA-256
  f5df60c02240f07d6d08175453e7cbdcd1c10b6206b19a5d25c90bc89ca97889
- FM-PAYMENTS-20260917-after: 14:10:39 Warsaw, SHA-256
  e3074712d45ddcd1979f4ab1bdc9dd05006a7e0fc30ac957397ab2ffaa4fba30

Both snapshots are Windows DPAPI CurrentUser encrypted, with restricted ACLs,
transport hash verification and decrypt/readback verification. They contain full
company rows and FM input/context records, plus fm_plan_private; they are not full
Auth/Storage/database backups. Do not upload the decrypted payload to git.

Record-level comparison: 923 supplier selections, 163 buyer responses, 119 hidden
networks and 90 confirmations preserved. All preference, wishlist, queue, station,
retailer, settings and plan records unchanged. Existing company fields are identical
after excluding fm_payment_date and updated_at. One new company and its profile were
created concurrently at 14:00:49, outside this import; it remains outside FM and has
the approved default date. There are no removed companies or profiles.

The private before directory contains import-source.json and import-approved-dates.sql.
The after directory contains payment-comparison.json and its read-only comparator.
The audited batch is fm-payment-dates-20260917-approved-g, action
fm_inputs_payment_date_import. It records source row, date before/after, authorization
and backup hash per participant. The one-time data payload is deliberately not in git.
Do not rerun it: duplicate batch, changed participant set, identity, package count
or existing date aborts the entire transaction.

## Tests and remaining work

scripts/fm-payment-date-local-test.mjs: 11/11 on an isolated local PostgreSQL database,
covering the reviewed import, unchanged unrelated fields, source-name audit, repeat
import refusal, supplier/admin date protection, migration reapply and atomic STOPs.
Four synthetic algorithm checks also passed (earlier date at equal score, buyer
acceptance priority, changed-date winner, Premium at equal score/date).
These are not a new full application E2E or event-plan rehearsal.

The local test uses the existing local pg dependency/runtime and accepts the private
input directory as its only argument; it never loads production credentials. Production
checks were read-only after the two approved migrations. Choice/response/confirmation
hashes are identical immediately before and after the writes.

Code is on fix/fm-payment-import-20260917 for incorporation into main. No main merge or
Netlify deployment was performed. Fozzy matching, withdrawn retailers and actual plan
calculation remain separate tasks. The existing fm_backup_inputs RPC still exports its
older company-column subset; use the full encrypted snapshot when backing up dates.

Do not restore whole company rows from the older snapshot. Any correction should touch
only the intended dates in a guarded transaction with a fresh backup and audit, keeping
the protection trigger and all 055 access restrictions in place.
