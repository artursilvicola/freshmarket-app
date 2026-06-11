# Przekazanie aplikacji b2b.freshmarket.eu — checklista dostępów dla informatyka

> **Cel:** lista wszystkich dostępów, kont i danych, które należy przekazać informatykowi,
> żeby mógł **w pełni przejąć i prowadzić** aplikację `b2b.freshmarket.eu`.
> **Ten dokument NIE zawiera żadnych realnych sekretów** — same nazwy kont/kluczy + instrukcja,
> jak je przekazać bezpiecznie. Wartości haseł/kluczy przekazuje się **osobno, przez menedżer haseł.**
> **Powiązane:** [PRODUCTION_HANDOVER.md](PRODUCTION_HANDOVER.md) (pełny obraz techniczny) ·
> [EMAIL_INCIDENT_2026-06-10_PARALLEL_SYSTEM.md](EMAIL_INCIDENT_2026-06-10_PARALLEL_SYSTEM.md) (ostrzeżenie o równoległym systemie).

---

## 🔑 Zasada nadrzędna (przeczytaj najpierw)
1. **Wszędzie gdzie się da: zaproś jako członek zespołu / przekaż własność** — NIE udostępniaj swojego loginu/hasła.
   Dzięki temu możesz odebrać dostęp później bez zmiany własnych haseł.
2. **Surowe sekrety** (klucze API, `service_role`, hasła SMTP, hasło bazy) przekazuj **tylko**
   przez współdzielony sejf menedżera haseł (Bitwarden/1Password) lub jednorazowy szyfrowany link.
   **Nigdy mailem ani na czacie.**
3. **Najmniejsze uprawnienia na start**, eskaluj w razie potrzeby.
4. **Po przekazaniu — ZROTUJ** wszystkie sekrety przekazane jako surowe wartości (lista w sekcji „Rotacja").
5. **Konta finansowe (PayU) i rejestrator domeny — własność zostaje przy firmie**; informatyk dostaje
   dostęp operacyjny.

---

## 1. Kod źródłowy — GitHub
- [ ] **Repo aplikacji:** `github.com/artursilvicola/freshmarket-app` (`main` = produkcja)
      → Settings → Collaborators → **Admin**, lub **Transfer ownership**.
- [ ] **Kod równoległego systemu** (leży w repo, niecommitowany): `b2b-email-system-DONE.md`,
      `b2b-supabase-email-deploy/*.ts` (Edge Function `send-email`) — **musi go dostać**.
- [ ] **Zaznacz:** `freshmarket-eu-content/` (Astro CMS, `freshmarket.eu`) to **osobny projekt**, nie część b2b.

## 2. Hosting i deploy — Netlify
- [ ] **Zespół Netlify:** `app.netlify.com/teams/artur-silvicola` → Members → zaproś (Owner/Admin).
- [ ] **Site produkcyjny:** `b2b.freshmarket.eu` (auto-deploy z `main`).
- [ ] **Drugi site:** `freshmarketb2b.netlify.app` (równoległy system) — pokaż oba.
- [ ] **Zmienne środowiskowe:** Site → Settings → Environment (pełna lista w PRODUCTION_HANDOVER.md, sekcja H).

## 3. Baza + backend — Supabase (najważniejsze)
- [ ] **Projekt:** `sklyfuvzjikkqerxtulo` (PostgreSQL+RLS, Auth, Storage, Edge Functions, **pg_cron**)
      → Organization → Members → Invite (Owner/Admin).
- [ ] **Migracje:** `supabase/migrations/001…044` — **aplikowane RĘCZNIE** w SQL Editor (NIE z gita).
- [ ] **Edge Function `send-email`** + jej **sekrety w Vault**.
- [ ] **pg_cron** — crony bazodanowe (audyt: [SUPABASE_MAIL_CRON_AUDIT.sql](SUPABASE_MAIL_CRON_AUDIT.sql)).
- [ ] **Klucze (przez sejf):** `SUPABASE_URL`, `anon key`, **`service_role key`**, hasło bazy / connection string.

## 4. Maile
- [ ] **Resend:** `RESEND_API_KEY`, zweryfikowana domena `freshmarket.eu`, webhook, rekordy DNS (DKIM/SPF)
      → resend.com → Team → dodaj członka; klucz przez sejf.
- [ ] **Skrzynki:** `newsletter@`, `hello@`, `kontakt@freshmarket.eu` (hosting **cyber-folks**, `s56.cyber-folks.pl`).

## 5. Płatności — PayU (FINANSOWE — ostrożnie)
- [ ] **Panel PayU (merchant):** `PAYU_POS_ID`, `PAYU_SECOND_KEY`, `PAYU_OAUTH_CLIENT_ID/SECRET`, `PAYU_ENV`.
- [ ] **Własność konta zostaje u firmy.** Informatyk: dostęp operacyjny + wartości konfiguracji przez sejf.
      Konta bankowego/rozliczeniowego **nie przekazujesz**.

## 6. AI — OpenAI
- [ ] `OPENAI_API_KEY`, `OPENAI_MODEL` (domyślnie `gpt-4.1-mini`) → dodaj do organizacji lub klucz przez sejf.

## 7. Domena i DNS
- [ ] **Rejestrator domeny `freshmarket.eu`** (prawdopodobnie **cyber-folks**) — dostęp do panelu DNS.
- [ ] **Rekordy:** subdomena `b2b` → Netlify; MX/DKIM/SPF dla maili.
- [ ] **Proforma:** env `PROFORMA_SELLER_NIP` / `PROFORMA_BANK_IBAN` mają **placeholdery — do ustawienia** (dane firmy/IBAN).

## 8. Dokumenty „pełny obraz" (przekaż wszystkie)
- [ ] `docs/production/PRODUCTION_HANDOVER.md` ← **dokument-matka** (czyta najpierw).
- [ ] `docs/production/EMAIL_INCIDENT_2026-06-10_PARALLEL_SYSTEM.md` ← ostrzeżenie o równoległym systemie.
- [ ] `docs/production/SUPABASE_MAIL_CRON_AUDIT.sql` ← audyt: co w bazie wysyła maile.
- [ ] `docs/legal/*`, `docs/account-lifecycle/*`, `docs/billing/*`, `src/config/features.js`, `E2E_TEST_PLAN.md`.
- [ ] ⚠️ `DOSTĘPY_CODEX.md` — **sprawdź, czy nie ma tam realnych tokenów**; jeśli tak → przekaż przez sejf, nie repo.

## 9. Krytyczne ostrzeżenia (powiedz wprost)
- 🛑 **Dwa systemy na jednej bazie Supabase** (`b2b.freshmarket.eu` + `freshmarketb2b`) — decyzja: który jest produkcją.
- 🛑 **Migracje NIE jadą z gita** — ręcznie w SQL Editor.
- 🛑 **`ACCOUNT_HARD_DELETE` zostaje OFF** — nie włączać bez sandboxu + prawnika + backupu.
- 🛑 **Nie re-enable crona `fm-14d-reminder`** bez naprawy (patrz dokument incydentu).
- 🛑 **Token `anon` zahardkodowany w funkcjach DB** — do przeniesienia do sekretu.

---

## 🔁 Rotacja po przekazaniu (zrób po nadaniu dostępów)
Zrotuj wszystkie sekrety przekazane jako surowe wartości:
- [ ] Supabase `service_role key` (+ ew. hasło bazy)
- [ ] `RESEND_API_KEY`
- [ ] Klucze PayU (`PAYU_SECOND_KEY`, OAuth secret)
- [ ] `OPENAI_API_KEY`
- [ ] Hasło SMTP skrzynek (cyber-folks)
- [ ] Token `anon` w funkcjach DB (przy okazji naprawy równoległego systemu)

---

## ✅ Test „czy ma pełną kontrolę" (1. dzień informatyka)
- [ ] Klonuje repo, `npm install` + `npm run build` (zielony).
- [ ] Netlify: testowy deploy z `main`, widzi env vars.
- [ ] Supabase: SQL Editor, odpala `SUPABASE_MAIL_CRON_AUDIT.sql` (read-only).
- [ ] Resend: widzi wysłane maile; kontroluje DNS domeny.
- [ ] PayU: logowanie (sandbox) + testowa płatność.
- [ ] Przeczytał `PRODUCTION_HANDOVER.md` + dokument incydentu.

---

## 📋 Tabela do odhaczania — kto / gdzie / jaki dostęp / data
| # | System | Zakres / rola | Jak nadano | Data nadania | Status | Uwagi |
|---|---|---|---|---|---|---|
| 1 | GitHub `freshmarket-app` | Admin / transfer | | | ☐ | |
| 2 | Netlify (zespół + site b2b) | Owner/Admin | | | ☐ | |
| 3 | Netlify (site freshmarketb2b) | Owner/Admin | | | ☐ | |
| 4 | Supabase `sklyfuvzjikkqerxtulo` | Owner/Admin | | | ☐ | |
| 5 | Supabase `service_role key` | sekret (sejf) | | | ☐ | rotować po |
| 6 | Resend | członek + `RESEND_API_KEY` | | | ☐ | rotować po |
| 7 | Skrzynki `@freshmarket.eu` (cyber-folks) | admin maili | | | ☐ | |
| 8 | PayU (panel merchant) | dostęp operacyjny | | | ☐ | własność u firmy |
| 9 | OpenAI | org + `OPENAI_API_KEY` | | | ☐ | rotować po |
| 10 | Rejestrator domeny / DNS | panel DNS | | | ☐ | własność u firmy |
| 11 | Dokumentacja `docs/*` | przekazana | | | ☐ | |

> Legenda statusu: ☐ do zrobienia · ⏳ w toku · ✅ nadane i potwierdzone.
