# PreConnect commercial contact actions review

Prepared for Claude. Branch: `fix/preconnect-contact-actions`, based on
`01458df`. Not deployed. No production records, RLS policies, migrations,
mail templates, category routing or credit accounting were changed.

## Scope

The buyer proposal detail rendered six email actions even when the supplier
had no commercial email. It only checked `contacts[0]`, so a valid address
in a later contact was also ignored. The contact card rendered empty phone
and email links.

The detail now derives usable contacts exclusively from the supplier's
`contacts` array. It trims strings, skips empty records and invalid email
addresses, retains phone-only contacts and selects the first usable email.
It never substitutes an account operator's email or the module's demo
company contacts while the actual supplier is missing.

Without an email, the six mail actions are absent and a PL/EN explanation
is shown. Available phone contacts remain visible. A company with no usable
contact gets an honest empty contact card. With an email, all six existing
localized subjects and message bodies remain available. The sent-to-read
callback and backend accounting are unchanged.

## Verification

- `npx vitest run`: 80 files, 639/639 tests passed (20 added).
- `npm run build`: passed; existing large-chunk warning remains.
- `git diff --check`: passed.
- Tests import the real `PageBuyerDetail` with the database boundary mocked.
  Cases include PL/EN empty states, phone-only contacts, invalid/whitespace
  addresses, the second contact supplying the address, plus aliases,
  delayed contacts, unavailable supplier, operator privacy, and unchanged
  read callback behavior on contact hydration.
- Local browser fixture: Polish empty state; English six valid email
  actions and phone contact; DOM check: six email actions, zero empty links.
  The fixture used a stub Supabase client, synthetic data and no backend.
  No email client or actual delivery was invoked. Temporary fixture removed.
- Live buyer RLS access to existing commercial contacts was not tested.
  After approval/deploy, verify one known populated supplier and one empty
  supplier from the test buyer account, without sending a contact message.

## Administrator contact list

A single read-only SELECT in the production Supabase dashboard at
2026-10-06 13:38 UTC (15:38 CEST) found 32 distinct companies among 133 active
PreConnect companies with no nonblank `company_contacts.email`.
31 have no contact records; Grupo YES has two contact records without email.
This count is about missing email, not a syntactic audit of all stored emails.

The administrator-only workbook contains company, profile country, operator
name, operator email, operator phone, account language and missing-contact
status. All 32 have operator emails; 15 have no recorded operator name and
16 have no phone. Data is reproduced as stored, not independently verified.
Do not infer a person's name from their address or publish these contacts
as the supplier's commercial contacts.

The source and workbook are outside Git:
`C:/Users/Artur/OneDrive/Dokumenty/1FMK2026/outputs/preconnect-contact-audit-2026-10-06/`

Workbook: `PreConnect_32_firmy_kontakty_operatorow_2026-10-06.xlsx`.
All 32 company names, emails and phone cells were compared against the CSV
source in the exported XLSX XML. Phone cells are stored as text, retaining
plus signs and leading zeros. Missing values are explicitly labeled.
The local preview renderer interprets some numeric-looking phone strings
as numbers despite text formatting; the actual XLSX string values were
verified independently to avoid modifying the source numbers for display.

Similar company names with different UUIDs were not merged. No contact
details are embedded in this review document or committed to Git.

## Next steps

Review this branch before deployment. The user deferred the live mailing
smoke test until after this contact fix and list. That test needs a fresh
test proposal, must not reuse a billed proposal, and should verify the buyer
wording and absence of the removed supplier sent-notification. No real
recipient should receive a test mailing; restore test account activation
states afterwards. Other known issues remain separate tasks.
