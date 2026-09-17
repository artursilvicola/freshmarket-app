# Admin payment-date editor

Branch: feat/admin-fm-payment-date, based on 9f5647a (the already-applied payment import guard).
Production has NOT been modified by this feature. No real company dates were edited in tests.

## UI

Admin -> Firms -> expanded company -> B2B Meetings: Payment date appears beside package
count and tier only while fm_b2b_enabled is true. PL/EN labels, native date picker,
Save and Discard icon buttons with tooltips, pending/error/success feedback.
Controls wrap on narrow screens. The checkbox label no longer contains other interactive
controls, so editing packages or the date cannot toggle B2B participation.
The inactive drawer feature also includes the date control without changing its feature flag.

## Safe write

- admin_set_fm_payment_date is SECURITY INVOKER with explicit logged-in, active admin checks.
- Locks company, then own profile, following existing lock order.
- Accepts only company UUID, new date and expected old date. Requires B2B enabled.
- A stale expected date returns a conflict with the current date. UI retains the draft,
  displays the conflict, and requires an explicit second save. No automatic overwrite/retry.
- UPDATE touches fm_payment_date and updated_at only. Same-date saves do not write.
- A restricted trigger writes fm_inputs_payment_date_changed to audit_log, recording
  actor, company, timestamp and before/after dates in the same transaction.
- Audit failure rolls back the date update. The existing supplier guard remains intact.
- The UI applies only a confirmed narrow response to raw company state. It does NOT invoke
  the ordinary setCompanies/bulkUpsertCompanies path, avoiding stale profile overwrites.
- The bulk mapper still excludes the date. Other profile saves cannot resend stale dates.
- No changes to packages, tiers, permissions, contacts, choices, phase, scheduling or email.

## Deployment

1. Review and merge the approved payment-import branch as well as this feature; keep other
   concurrent work intact. Do not rerun the one-time payment data import.
2. Apply supabase/migrations/20260917124901_admin_fm_payment_date.sql in a transaction.
   Requires 055 and 20260917120519_fm_payment_date_guard (already applied in production).
   Installation creates functions/triggers/grants only; it does not update company data.
3. Deploy the frontend, refresh the admin tab, inspect an enabled and disabled company.
4. For write smoke tests use an isolated database/staging, not an active participant.
   Do not activate a production test company or alter real payment dates merely for testing.
5. A frontend rollback is safe with this migration left installed. Do not remove the
   existing date protection or undo previously imported dates.

## Verification

- Full Vitest suite: 227/227 passed. Production build passed with the existing bundle-size warning.
- scripts/admin-fm-payment-date-sql-test.mjs creates and drops a dedicated local database,
  applies 001-055 plus payment migrations and tests reapply. 15 checks cover active admin
  success, no-op, supplier/buyer/anonymous refusals, inactive admin, B2B disabled, invalid
  dates, direct supplier tampering, conflict, audit rollback and two concurrent admin writes.
- Local browser harness uses the real PageAdminFirmy with synthetic data and mocked RPC,
  never production credentials. Checked desktop 1440px, mobile 390px, PL/EN, save/reload,
  visibility after toggling, no checkbox activation and control containment. Screenshots:
  outputs/admin-fm-payment-date/{desktop,mobile,mobile-en}.png in the parent workspace.
- Public-client RPC and audit write tests passed against local full-schema RLS. Hosted
  migration/deploy and a production browser smoke test remain deployment steps.

Local preview: http://127.0.0.1:5184/.codex-payment-preview.html (synthetic data only).
Private preview files and logs are not part of the commit.
