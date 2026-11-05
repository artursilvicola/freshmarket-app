# Campaign names and manual audience - review

Scope: standard audiences create their names automatically. Only selected_companies
requires a custom name. PostgreSQL assigns a unique sequence number and Warsaw
creation date. Existing names remain unchanged. Sequence numbers may have gaps.

The selected_companies audience does not filter by credit balance. Existing base
exclusions and suppressions still apply. Recipients must be selected explicitly.
PL/EN generic content is provided without claims about specific buyer demand.

Migration: 20261105170000_marketing_campaign_names.sql. Applied only to the isolated
test project. Production and main were not changed in this task.

Verification:
- Focused tests including real SQL via PGlite: 51 passed.
- Full suite: 881 passed, 18 skipped. Build passed.
- SQL smoke: 74 migrations loaded; checks passed.
- Browser, isolated test server localhost:8890: created standard campaign
  'Brak waznych kredytow | #11 | 05.11.2026' and custom campaign
  'TEST - wybrane firmy | #12 | 05.11.2026' (UI preserves Polish characters).
- Both persisted after reload. Custom name required only for manual audience.
- Manual audience showed 7 eligible test companies with differing balances;
  excluded companies remained excluded. No messages were approved or sent.

Real mail test remains NOT DONE. User authorized only
artur.stasiak+dostawca@freshmarket.eu. No Outlook recipient supplied.
The current production send flag enables both test and batch endpoints. It was
not enabled here. Do not describe browser/SQL tests as real delivery verification.

Before deploying: review migration, apply it before the new create handler, then
deploy application. Keep mailing disabled except during an explicitly controlled
test; no permission to send a supplier campaign is implied by the test recipient.
