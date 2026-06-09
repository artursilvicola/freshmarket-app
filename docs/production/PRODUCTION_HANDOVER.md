# Fresh Market B2B PreConnect — Pakiet przekazania do produkcji (HANDOVER)

> **Domena:** https://b2b.freshmarket.eu · **Właściciel:** Fresh Market / KJOW Sp. z o.o.
> **Dokument:** kompletny pakiet wiedzy dla informatyka/DevOps, testerów, prawnika i biznesu.
> **Status kodu:** ten dokument NIE zmienia kodu, flag, danych ani migracji — tylko opis.
>
> **Kto co czyta:** DevOps → B, C, H, I, J · Testerzy → D, E, F · Prawnik → A, D, G, I ·
> Właściciel/zarząd → A, K.

---

## A. Opis aplikacji

**Czym jest:** B2B PreConnect to platforma kojarząca **dostawców** (producenci/eksporterzy
owoców, warzyw, kwiatów) z **kupcami sieci handlowych** w modelu kredytowym. Dostawca kupuje
„kredyty PreConnect" (1 kredyt = 1 wysłanie propozycji do 1 sieci), dodaje propozycje
asortymentowe, admin je moderuje i wysyła do paneli kupców oraz w miesięcznym mailingu do sieci.

**Dla kogo (role):**
- **Dostawca** — rejestruje firmę, kupuje kredyty, dodaje propozycje, śledzi odczyty/rozliczenia.
- **Kupiec (sieć)** — przegląda propozycje w swoim panelu, oznacza zainteresowanie.
- **Admin** — moderuje propozycje, zarządza firmami/sieciami, mailingiem, rozliczeniami.
- **Super-admin** — dodatkowo: Branding, Administratorzy (zespół), narzędzia testowe.

**Główne moduły:**
- Rejestracja dostawcy (samoobsługowa, wymaga NIP) + aktywacja przez admina.
- Panel dostawcy: profil firmy, oferty, propozycje, Finanse (kredyty/pakiety/proformy), Wysyłki.
- **PreConnect**: propozycja dostawcy → moderacja → panel kupca → mailing do sieci.
- **Pierwszy wtorek miesiąca**: stały termin mailingu PreConnect do sieci.
- Panel kupca: lista propozycji, oznaczanie odczytu/zainteresowania.
- Admin: Pipeline (moderacja/sieci/dostawcy), Firmy, Sieci, Rozliczenia, Wiadomości, Branding.
- **Rozliczenia**: przychód + rozliczenie kredytów PreConnect (per firma).
- **Proformy**: dokument przy płatności przelewem.
- **Kredyty**: ważność 12 miesięcy, przypomnienie 14 dni przed wygaśnięciem.
- **FM 2026**: osobny moduł targów Fresh Market (preferencje dostawców, harmonogram spotkań).
- **Wiadomości**: czat admin ↔ dostawca/kupiec.

---

## B. Architektura techniczna

| Warstwa | Technologia / lokalizacja |
|---|---|
| **Frontend** | React + Vite, react-i18next (PL/EN). Build: `npm run build` → `dist/`. |
| Główny kod | `src/legacy/PreconnectFM.jsx` (monolit ~11k linii — większość UI), `src/lib/db.js` (warstwa danych), `src/auth/AuthProvider.jsx` (sesja/role), `src/i18n/{pl,en}/legacy.json` |
| **Backend / Functions** | **Netlify Functions** (`netlify/functions/*.js`, ESM) — 19 funkcji (PayU, proformy, maile, AI, admin-user mgmt, webhooki) |
| **Baza** | **Supabase** (PostgreSQL + RLS). Migracje: `supabase/migrations/NNN_*.sql` (001–044) |
| **Auth** | **Supabase Auth** (`auth.users`). Role: `profiles.role` (supplier/buyer/admin) + `profiles.admin_level` ('super'/NULL) |
| **Storage** | Supabase Storage, bucket **`brand-assets`** (logo brandu) → URL w `fm_settings.brand_logo_url` |
| **Maile** | **Resend** (`RESEND_API_KEY`). From: `newsletter@freshmarket.eu`. Webhook: `resend-webhook.js` |
| **Płatności** | **PayU** (karta/online) + **przelew bankowy → proforma** (HTML) |
| **Feature flagi** | `src/config/features.js` (jedno źródło — sekcja C) |
| **Legal** | `public/regulamin.html` (PL **2.0**), `public/regulations.html` (EN 2.0 draft), wersje w `src/lib/legal-versions.js` (`TERMS_VERSION=2.0`), źródła w `docs/legal/` |

**Hosting/CD:** push do `main` (GitHub `artursilvicola/freshmarket-app`) → Netlify auto-deploy.
**Migracje Supabase NIE jadą z gita** — aplikowane RĘCZNIE w Supabase SQL Editor po deployu.

---

## C. Aktualny stan produkcyjny / feature flags

> Źródło: `src/config/features.js`. „Flaga ON" = funkcja aktywna na prod.

### Flagi ON (aktywne na produkcji)
| Flaga | Znaczenie |
|---|---|
| `NIP_REQUIRED` | NIP firmy obowiązkowy: rejestracja, zapis profilu, zakup kredytów |
| `CREDITS_VALIDITY_UI` | Ważność kredytów 12 mc widoczna (przed/po zakupie, panel Finanse) |
| `BANK_TRANSFER_PROFORMA` | Przelew → generowanie proformy HTML + mail |
| `ADMIN_SETTLEMENTS` | Moduł „Rozliczenia" (przychód + kredyty PreConnect) |
| `ADMIN_DASHBOARD_POLISH` | Uporządkowany Dashboard admina (KPI/moduły/FM/danger zone) |
| `ADMIN_PIPELINE_CLEANUP` | Finanse usunięte z Pipeline → żyją w Rozliczeniach |
| `ADMIN_ACCESS_POLISH` | Grupy menu (Operacyjne/Finanse/System) + Branding/reset tylko super-admin (UI-only) |
| `ADMIN_PIPELINE_SPLIT` | Pipeline w 3 zakładkach (moderacja / sieci-mailing / dostawcy-tracking, master-detail) |
| `PRECONNECT_MAILING_DATE_LOGIC` | Mailing = pierwszy wtorek miesiąca; status „Zaplanowane do mailingu" |
| `CREDIT_EXPIRY_REMINDER` | Mail 14 dni przed wygaśnięciem kredytów (idempotentny) |
| `ACCOUNT_LIFECYCLE` | Zegar aktywności (`last_active_at`) + ostrzeżenia 30/7 dni przed progiem 24 mc nieaktywności |
| (pre-existing) `ADMIN_COMPANIES_2_0_LIST`, `ADMIN_PIPELINE_2_0_TABLE`, `ADMIN_PIPELINE_2_0_MAILING_BASKET`, `CREDITS_UI_SUPPLIER`, `RETAILER_REQUIREMENTS` | redesign listy firm / tabela Pipeline / koszyk mailingu / kredyty-copy / wymagania sieci |

### Flagi OFF
| Flaga | Status |
|---|---|
| `ADMIN_COMPANIES_2_0_DRAWER`, `ADMIN_COMPANIES_2_0_FILTERS` | przygotowane, niewłączone |
| **`ACCOUNT_HARD_DELETE`** | **OFF — patrz niżej** |

### 🛑 `ACCOUNT_HARD_DELETE = false` — KRYTYCZNE
Steruje DESTRUKCYJNYM wykonaniem (archiwizacja/anonimizacja/twarde usuwanie kont po 24 mc).
**NIE jest podpięty do żadnej logiki** i **NIE WOLNO go włączać** bez:
1. osobnego **sandboxu** (test na kopii bazy), 2. **decyzji prawnej** (RODO, §16, 14 dni
powiadomienia), 3. **sign-offu właściciela**, 4. pełnego **backupu**.
`ACCOUNT_LIFECYCLE=true` daje tylko **zegar + ostrzeżenia** — NIE usuwa nic.

---

## D. Procesy biznesowe

1. **Rejestracja dostawcy** — samoobsługa (`register-supplier-self.js`), **NIP wymagany**;
   konto startuje jako `pending_review` → admin **aktywuje** (status `active`) lub odrzuca/zawiesza.
2. **Zakup kredytów** — dostawca wybiera pakiet (`package_plans`); blokada bez NIP.
3. **Ważność kredytów 12 mc** — `packages.expires_at = data zakupu + 12 mc`; pula liczona z widoku
   `company_capacity` (tylko niewygasłe). UI pokazuje „ważne do DD.MM.RRRR".
4. **Przypomnienie 14 dni** — przy hydracji sweep `claim_due_expiry_reminders` → mail (raz/pakiet).
5. **Płatność kartą/PayU** — `create-payu-order.js` → PayU → webhook `payu-notify.js` →
   `purchase_package` (idempotentny po payment_ref) aktywuje pakiet.
6. **Przelew → proforma** — `generate-proforma.js`: wymaga NIP, cena z `package_plans`, VAT 23%,
   numer `PF/RRRR/NNNNNN`, HTML + mail. Pakiet „oczekuje na płatność".
7. **Admin oznacza proformę opłaconą** — aktywuje pakiet ręcznie (mig 043).
8. **Dodawanie propozycji** — dostawca tworzy propozycję do sieci (1 kredyt).
9. **Moderacja** — admin: podgląd, AI-uwagi, zatwierdź/odrzuć, wiadomość do dostawcy.
10. **Wysyłka do panelu kupca** — „Wyślij zatwierdzone" (status `approved → sent`).
11. **Mailing do sieci** — **pierwszy wtorek miesiąca**; admin ręcznie „Wyślij e-mail do sieci".
12. **14 dni na odczyt** — licznik od **daty mailingu** (`mailingSentAt` / planowany pierwszy wtorek).
13. **Zwrot kredytu przy braku odczytu** — RPC `expire_legacy_sends_14d` (mig 044, kotwica = data
    mailingu) → status `unread_expired` → zwrot kredytu.
14. **Tracking i rozliczenia** — admin widzi odczyty/zwroty; Rozliczenia: przychód + kredyty per firma.

---

## E. Testy funkcjonalne wg ról

### 1. Dostawca
- [ ] Rejestracja (z NIP) → status `pending_review`; bez NIP → blokada + komunikat.
- [ ] Logowanie; edycja profilu firmy (NIP wymagany do zapisu).
- [ ] Zakup kredytów: karta/PayU → pakiet aktywny; przelew → proforma (mail + „Pobierz proformę").
- [ ] „Twoje kredyty ważne do: DD.MM.RRRR" po zakupie; karta pakietu w Finanse.
- [ ] Historia kredytów: kupione/zużyte/zwrócone/wygasłe.
- [ ] Dodanie propozycji do sieci; status `Do moderacji`.
- [ ] Po wysyłce: „Zaplanowane do mailingu — DD.MM.RRRR"; po mailingu: odczyt/tracking.
- [ ] Wiadomości admin↔dostawca.
- [ ] PL/EN przełączenie; responsywność (mobile/laptop); poprawne komunikaty błędów.

### 2. Kupiec (sieć)
- [ ] Logowanie do panelu sieci.
- [ ] Lista propozycji dla sieci; oznaczenie odczytu/zainteresowania.
- [ ] Subskrypcja mailingu („Następny mailing: pierwszy wtorek").
- [ ] PL/EN; responsywność.

### 3. Admin
- [ ] Dashboard: KPI + moduły; alert „Wymaga akcji".
- [ ] Pipeline → 3 zakładki: Do moderacji (podgląd/AI/wiadomość/zatwierdź-odrzuć/„Krok 2 wyślij"),
      Sieci/mailing (koszyk/filtry/CSV/„Wyślij e-mail"), Dostawcy/tracking (rozwijane + podgląd).
- [ ] Firmy: aktywacja/zawieszenie/odrzucenie; profile; pakiety.
- [ ] Rozliczenia: przychód + rozliczenie kredytów; oznaczenie proformy opłaconej.
- [ ] Mailing do sieci (pierwszy wtorek); wiadomości.
- [ ] PL/EN; responsywność.

### 4. Super-admin
- [ ] Widzi dodatkowo: **Branding**, **Administratorzy** (badge SUPER), **Reset danych testowych**.
- [ ] Zwykły admin **nie widzi** Brandingu/Administratorów/resetu (UI-only; patrz I).
- [ ] Dodawanie/zarządzanie administratorami zespołu.

---

## F. Testy krytyczne PRZED produkcją (must-pass)
- [ ] Rejestracja dostawcy + **NIP required** (blokada bez NIP).
- [ ] Zakup kredytów **PayU** (karta) — pakiet aktywny po webhooku.
- [ ] **Przelew/proforma** — proforma generuje się, **mail dochodzi**, numer rośnie atomowo.
- [ ] **Dane sprzedawcy na proformie poprawne** (NIP/IBAN z env — patrz H, domyślnie placeholdery!).
- [ ] Admin **oznacza opłacone** → pakiet aktywny → **kredyty widoczne u dostawcy**.
- [ ] Propozycja przechodzi **moderację**; „Wyślij zatwierdzone do panelu kupca".
- [ ] **Mailing do sieci** (pierwszy wtorek) — mail dochodzi do kupca.
- [ ] **Panel kupca** widzi propozycje.
- [ ] **14 dni / zwrot kredytu** — RPC `expire_legacy_sends_14d` (po migracji 044) liczy od daty mailingu.
- [ ] **Przypomnienie o wygaśnięciu** kredytów (14 dni) — idempotentne.
- [ ] **`ACCOUNT_LIFECYCLE`**: `last_active_at` aktualizuje się przy logowaniu; **0 maili** (runway ~22 mc).
- [ ] **`ACCOUNT_HARD_DELETE` = false** (potwierdzić, że nic nie usuwa).

---

## G. Prawnik / RODO / legal

> ✅ Stan na main: **`TERMS_VERSION = "2.0"`, `PRIVACY_VERSION = "1.0"`** (`src/lib/legal-versions.js`).
> **Regulamin 2.0 jest opublikowany.**

- **Regulamin 2.0** — `public/regulamin.html` (PL, wersja **2.0**), źródło `docs/legal/REGULAMIN.md` (2.0).
  Checklista publikacji: `docs/legal/REGULAMIN_2_0_RELEASE_CHECKLIST.md`.
- **Daty:** **ogłoszony 9 czerwca 2026**, **wchodzi w życie 23 czerwca 2026** (14 dni wyprzedzenia).
- **§16 — Archiwizacja i usunięcie kont nieaktywnych — JEST już w regulaminie 2.0:** archiwizacja/
  anonimizacja/usunięcie po **24 miesiącach** nieaktywności, z ostrzeżeniami **30 i 7 dni** przed terminem.
  Czyli podstawa prawna dla `ACCOUNT_LIFECYCLE` jest opublikowana.
- **Mail powiadamiający (14 dni)** — wysyłany **9 czerwca 2026** (ogłoszenie 2.0 → wejście 23.06.2026);
  szablon w `REGULAMIN_2_0_RELEASE_CHECKLIST.md`.
- **Polityka prywatności** — `docs/legal/POLITYKA_PRYWATNOSCI.md` (wersja 1.0).
- **Twarde usuwanie nadal OFF** — `ACCOUNT_HARD_DELETE=false`; **publikacja regulaminu 2.0 NIE uruchamia
  usuwania kont**. `ACCOUNT_LIFECYCLE=true` daje tylko zegar + ostrzeżenia. Realne usuwanie wymaga
  osobnej decyzji + sandboxu + sign-offu (patrz C, I).
- **Retencja danych finansowych** — proformy (`proformas`) przy usuwaniu firmy zachowywane
  (`company_id → NULL`, nie kasowane) dla księgowości. Pakiety kaskadują.
- **Faktury/proformy** — numeracja `PF/RRRR/NNNNNN`, VAT 23%, dane sprzedawcy z env (H).
- **Maile transakcyjne** — Resend, from `newsletter@freshmarket.eu`; kontakt w treści: `hello@freshmarket.eu`.
- **Zgody / `accepted_terms_version`** — **nowe rejestracje zapisują `accepted_terms_version = "2.0"`** (profiles).
- 🔴 **RYZYKO (otwarte): brak wymuszonego flow re-akceptacji dla ISTNIEJĄCYCH użytkowników** — ekran
  „zaakceptuj nową wersję" przy zmianie major regulaminu jest **niezaimplementowany**. Wg checklisty 2.0
  (§15) **operator decyduje**, czy wystarcza powiadomienie e-mail, czy trzeba zbudować ekran re-akceptacji.
  **Decyzja prawna do podjęcia.**
- **EN `public/regulations.html`** — wersja 2.0 z §16, ale **nadal DRAFT do review prawnika** (nie final).

---

## H. Informatyk / DevOps — checklista wdrożeniowa

**Hosting:** Netlify (auto-deploy z `main`). Domena **b2b.freshmarket.eu**.
**Przekierowania:** `/regulamin` → `public/regulamin.html`, `/regulations` → `public/regulations.html` (sprawdzić w konfiguracji Netlify/redirects).

### Zmienne środowiskowe (Netlify → Site settings → Environment)
| Zmienna | Cel | Uwaga |
|---|---|---|
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | URL projektu | |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | klucz public (front) | |
| **`SUPABASE_SERVICE_ROLE_KEY`** | service role | **TYLKO w Functions, NIGDY we froncie** |
| `RESEND_API_KEY` | maile | domena `freshmarket.eu` zweryfikowana w Resend |
| `RESEND_WEBHOOK_SECRET` | webhook odczytów | |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI moderacja/opisy | model domyślny `gpt-4.1-mini` |
| `B2B_APP_URL` | linki w mailach | fallback `https://b2b.freshmarket.eu` (w kodzie) |
| `PAYU_ENV` | `sandbox`/`prod` | **na prod ustawić właściwie** |
| `PAYU_POS_ID`, `PAYU_SECOND_KEY`, `PAYU_OAUTH_CLIENT_ID`, `PAYU_OAUTH_CLIENT_SECRET` | PayU | |
| **`PROFORMA_SELLER_NIP`** | NIP sprzedawcy na proformie | **DOMYŚLNIE PLACEHOLDER — USTAWIĆ!** |
| **`PROFORMA_BANK_IBAN`** | IBAN do przelewu | **DOMYŚLNIE PLACEHOLDER — USTAWIĆ!** |
| `PROFORMA_SELLER_NAME`, `PROFORMA_SELLER_ADDRESS`, `PROFORMA_BANK_BENEFICIARY`, `PROFORMA_BANK_NAME` | dane na proformie | defaulty: KJOW Sp. z o.o. / PKO BP |

> ⚠️ **Proforma:** `PROFORMA_SELLER_NIP` i `PROFORMA_BANK_IBAN` mają domyślnie **placeholder
> tekstowy** (`[NIP — uzupełnij…]`). Bez ustawienia env proformy wyjdą z placeholderem — **ustawić
> przed poleganiem na przelewach**. Status env: funkcja `admin-env-status.js`.

### Storage
- Bucket **`brand-assets`** (logo brandu); publiczny URL zapisywany w `fm_settings.brand_logo_url`.

### Migracje Supabase (RĘCZNIE, NIE z gita)
- Pliki: `supabase/migrations/001…044.sql`. **Aplikować w kolejności w Supabase SQL Editor** po deployu.
- Najnowsze istotne: `039` wymagania sieci · `040` proformas · `041` przypomnienie wygaśnięcia ·
  `042` last_active_at + ostrzeżenia · `043` aktywacja pakietu po proformie · `044` zwrot kredytu
  od daty mailingu.
- **Kontrola, czy migracja zaaplikowana:** sprawdzić istnienie kolumny/funkcji przez SELECT
  (np. `select expiry_reminder_sent_at from packages limit 1;` → brak błędu = OK).

### Backup
- Supabase → **Database → Backups** (snapshot / PITR) **przed każdą operacją destrukcyjną**.
- Logiczny: eksport CSV z SQL Editora dla wrażliwych tabel.

### RLS — jak sprawdzić
- Polityki w `supabase/migrations/002_rls_policies.sql` + późniejsze. Helpery: `is_admin()`,
  `is_super_admin()`, `app_company_id()`. Test: zalogowany dostawca widzi tylko swoje dane.

### Logi
- **Netlify:** Site → Functions → logi per funkcja (PayU, proforma, maile).
- **Supabase:** Logs (Postgres / Auth / API).

---

## I. Ryzyka i rzeczy, których NIE robić
- 🛑 **NIE włączać `ACCOUNT_HARD_DELETE`** bez sandboxu + decyzji prawnej + sign-offu + backupu.
- 🛑 **NIE usuwać firm Unica Group / Pik Global / OKSALE** bez osobnej decyzji (mają historię finansową).
- 🛑 **NIE zmieniać regulaminu** (major) bez maila do userów + 14 dni wyprzedzenia (i ew. re-akceptacji).
- 🛑 **NIE flipować feature flag** bez smoke testów (wzorzec: branch `chore/flip-…`, build, push, merge po teście).
  Niektóre flagi **wysyłają realne maile** (`CREDIT_EXPIRY_REMINDER`, `ACCOUNT_LIFECYCLE`) — najpierw DRY-RUN.
- 🛑 **NIE odpalać destrukcyjnych SQL** (DELETE/UPDATE) bez backupu + dry-run (wzorzec: `docs/account-lifecycle/*`).
- 🛑 **NIE trzymać `SUPABASE_SERVICE_ROLE_KEY` we froncie** — tylko w Netlify Functions.
- 🛑 **NIE publikować EN legal jako final** bez review prawnika.

---

## J. Załączniki / lokalizacje w repo
| Plik / katalog | Co zawiera |
|---|---|
| `src/config/features.js` | feature flagi (jedno źródło) |
| `src/lib/legal-versions.js` | `TERMS_VERSION`, `PRIVACY_VERSION` |
| `public/regulamin.html` / `public/regulations.html` | regulamin **2.0** PL / EN (EN = draft) |
| `docs/legal/REGULAMIN.md` (2.0), `docs/legal/REGULAMIN_2_0_RELEASE_CHECKLIST.md`, `docs/legal/POLITYKA_PRYWATNOSCI.md` | źródła legal + checklista publikacji 2.0 |
| `docs/account-lifecycle/*` | audyt kont testowych, plan czyszczenia, DRY-RUN nieaktywności |
| `docs/billing/*` | plan Fazy 2 RPC mailingu + DRY-RUN |
| `supabase/migrations/*` | migracje DB (001–044) |
| `netlify/functions/*` | 19 funkcji backendowych |
| `src/legacy/PreconnectFM.jsx` | główny monolit UI |
| `src/lib/db.js` | warstwa danych (Supabase RPC/queries) |

---

## K. Streszczenie dla zarządu / właściciela (1 strona)

**Co jest GOTOWE (na produkcji):**
- Pełny przepływ PreConnect: rejestracja dostawcy (NIP wymagany) → zakup kredytów (PayU + przelew/proforma)
  → propozycje → moderacja → panel kupca → mailing do sieci (pierwszy wtorek) → tracking → zwrot kredytu.
- Kredyty: ważność 12 mc, przypomnienie 14 dni przed wygaśnięciem.
- Uporządkowany panel admina: Dashboard, Rozliczenia, role dostępu, Pipeline w 3 zakładkach.
- Zegar aktywności kont (`ACCOUNT_LIFECYCLE`) — ostrzeżenia, BEZ usuwania.
- Dane testowe wyczyszczone (17 kont testowych usuniętych, historia finansowa zachowana).

**Co wymaga TESTÓW (przed pełnym otwarciem):**
- Pełna ścieżka płatności PayU + przelew/proforma na realnych danych (sekcja F).
- Poprawność danych sprzedawcy na proformie (env `PROFORMA_SELLER_NIP`/`PROFORMA_BANK_IBAN` — **do ustawienia**).
- Mailing do sieci + odczyty + zwroty na realnym cyklu miesięcznym.

**Co wymaga DECYZJI PRAWNEJ:**
- **Regulamin 2.0 jest już opublikowany** (§16: retencja 24 mc + ostrzeżenia 30/7 dni; ogłoszony
  09.06.2026, wejście 23.06.2026, mail powiadamiający 09.06.2026). Do potwierdzenia przez prawnika,
  że treść §16 odpowiada realnemu działaniu `ACCOUNT_LIFECYCLE`.
- Czy potrzebny mechanizm **wymuszonej re-akceptacji** dla **istniejących** użytkowników, czy wystarcza
  powiadomienie e-mail (§15) — decyzja operatora/prawnika (ekran re-akceptacji niezaimplementowany).
- Zatwierdzenie **EN regulations 2.0** (wciąż draft).

**Co jest ZABLOKOWANE (świadomie):**
- **Twarde usuwanie kont (`ACCOUNT_HARD_DELETE`) — OFF.** Nie włączać bez sandboxu + prawnika + sign-offu.
- Usuwanie firm z historią finansową (Unica/Pik/OKSALE) — decyzja osobna.

**Wniosek:** aplikacja jest funkcjonalnie kompletna i wdrożona na prod za flagami. Do pełnego
„go-live" komercyjnego brakuje: (1) testów płatności end-to-end na realnych danych, (2) ustawienia
env proformy, (3) review prawnego regulaminu/RODO. Funkcje destrukcyjne pozostają wyłączone.
