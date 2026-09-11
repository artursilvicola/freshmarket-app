# Konsultacja architektury — własne konta firm i koordynator obsługujący wiele firm

Data: 11.09.2026. Autor: Claude (na zlecenie Artura, pytania sformułowane z Codexem). Charakter: analiza i rekomendacja — **żadnych zmian w kodzie, bazie ani kontach nie wykonano.** Podstawa: kod na `main` 14b8959 (migracje 001–053, `src/`, `netlify/functions/`) i odczyty z produkcyjnej bazy z 11.09 (tylko SELECT, liczby zbiorcze).

Kontekst: Anna Wiernicka przygotowuje profile i preferencje spotkań dla 16 zagranicznych firm (Excel), ma ok. 13 adresów e-mail, wcześniej używała własnych adresów dla kilku podmiotów, pyta o przekazywanie preferencji telefonicznie.

---

## 0. Odpowiedzi w skrócie (12 pytań)

1. **Własne konto i oficjalny e-mail każdej firmy — tak.** Ściślej: każda firma to osobny rekord `companies` z **oficjalnym adresem zapisanym przy firmie** i co najmniej jednym użytkownikiem-właścicielem (`owner`) na tym adresie. Firma może przez pewien czas istnieć bez konta logowania (szkic), ale nie bez oficjalnego adresu przed publikacją planu.
2. **Jedno konto koordynatora z delegacjami — tak.** To jedyne rozwiązanie, które daje Annie pracę w wielu firmach bez mieszania tożsamości. Dziś jest to niemożliwe technicznie: jeden adres e-mail = jedno konto auth = jedna firma (`profiles.company_id`).
3. **Potrzebna jest tabela relacyjna `company_memberships`.** `profiles.company_id` zostaje jako „firma domowa" (kompatybilność z 69 odwołaniami w politykach RLS), a członkostwa stają się źródłem prawdy.
4. **Delegat = rodzaj członkostwa**, nie osobna tabela. Jedna tabela z kolumnami `role` (`owner|member|delegate|viewer`), `scope`, `status`, `expires_at`, `granted_by`. Osobna tabela dublowałaby RLS i UI.
5. **RLS dla użytkownika wielu firm — przez „aktywną firmę"**, nie przez „wszystkie moje firmy". Nowa wersja `app_company_id()` zwraca aktywny kontekst (ustawiony RPC, zweryfikowany członkostwem) albo `profiles.company_id`. Dzięki temu **istniejące 69 odwołań w politykach nie wymaga przepisania**, a delegat nigdy nie zapisze do firmy B, gdy UI pokazuje A.
6. **Storage — automatycznie.** Wszystkie cztery buckety już używają ścieżki `<company_id>/…` i `app_company_id()`; po zmianie funkcji delegat widzi materiały tylko aktywnej firmy. Trzeba dodać zakres `materials` dla `certs` i `company-materials`.
7. **Komunikacja do oficjalnych kontaktów** — adresaci powiadomień liczeni z członkostw `owner`/`member` (dziś: „pierwszy profil wg `created_at`"), delegat tylko z jawną flagą `notify`. Chat: wątek już jest per firma (`user:<company_id>`), ale RLS jest per użytkownik — do zmiany na „ma dostęp do firmy wątku" + etykieta „w imieniu firmy".
8. **Firmy bez e-maila** — rekord `companies` w stanie `draft_no_owner`, bez konta auth, edytowany przez delegata/admina; publikacja i wysyłka planu zablokowane (dziś `fm-plan-send` i tak odmawia: `no_canonical_recipients`). Adres kontaktowy koordynatora tylko jako jawny stan tymczasowy z datą ważności i ostrzeżeniem — **nie przed 16.09**.
9. **Wybory przez telefon** — kolumny pochodzenia w `company_target_retailers` (`source`, `entered_by`, `entered_at`, `note`, `company_confirmed_at`) + mail z zestawieniem do właściciela. Do 16.09 wariant ręczny (pkt 8 niżej).
10. **Migracja bez ryzyka** — krok 1 to tylko dodanie tabeli, backfill z `profiles.company_id` (89 firm = 89 wpisów `owner`) i nowa `app_company_id()` z identycznym wynikiem dla wszystkich obecnych kont. Rollback = przywrócenie starej funkcji.
11. **Przed 16.09 — wariant bez migracji**: firmy i oficjalne adresy zakłada admin, preferencje z Excela Anny wprowadza admin (mała, tylko-adminowa funkcja „wybory w imieniu firmy" albo skrypt SQL z dziennikiem), każda firma dostaje magic link i mail z zestawieniem do potwierdzenia. Zero kont na adresach Anny, Anna nie loguje się na konta firm.
12. **Na po wydarzeniu (25.09+)**: członkostwa, rola koordynatora, przełącznik firm, delegacje w UI admina, RLS chatu, adresaci z członkostw, pochodzenie wyborów, dziennik audytu.

---

## 1. Audyt obecnego modelu (fakty)

### 1.1 Tożsamość i przypisanie do firmy
- `auth.users` ↔ `profiles` 1:1 (trigger `handle_new_user`, migracja 034). Role: `user_role` = `admin | supplier | buyer | staff` (`staff` dodany w 052 przez `ALTER TYPE … ADD VALUE` — gotowy precedens dla `coordinator`).
- `profiles.company_id uuid` — **jedna firma na konto**; `profiles.retailer_id` dla kupców. Brak tabeli relacyjnej.
- Funkcje bezpieczeństwa (`security definer`, 001): `app_role()`, `app_company_id()` = `select company_id from profiles where id = auth.uid()`, `app_retailer_id()`, `is_admin()` (031: + `is_super_admin()` / `admin_level`), `app_supplier_legacy_id()` (026) = `coalesce(companies.legacy_supplier_id, companies.id::text)` przez `profiles.company_id`.
- Jeden e-mail = jedno konto auth (unikalność w `auth.users`; `profiles.email` bez ograniczenia). **To jest strukturalna przyczyna, dla której Anna potrzebowała wielu adresów.**
- Front: `AuthProvider` pobiera profil z JOIN do `companies`; `ProtectedRoute` wymaga `profile.company_id` dla roli `supplier`; w panelu `account.id = company_id`, klucz preferencji `sid = company_id`; `db.js` ma 11 zapytań `.eq("company_id", …)`. Nie istnieje pojęcie „przełącz firmę".

### 1.2 Firma
- `companies` **nie ma kolumny z oficjalnym e-mailem**. „Adres firmy" to w praktyce login jej jedynego konta.
- `company_contacts` (`role` sales/quality, `name`, `position`, `phone`, `email`) — dane pokazywane sieciom; **nieużywane do żadnych powiadomień**. 16 firm ma kontakt z e-mailem innym niż login (Bayer 5, Nature's Produce 3, Ovation, AGRO PAPRIX, Titbit, Nowalijka po 2…).
- Stany: `account_status` (`pending_review|active|rejected|suspended`, 022), `preconnect_enabled`, `fm_b2b_enabled`, `approved_at/by`, `fm_selection_confirmed_at` (015, zapis zwykłym `update` z frontu), `fm_plan_sent_at` (051), `fm_b2b_packages`, `fm_b2b_tier`, `fm_payment_date`.

### 1.3 RLS i Storage
- **69 odwołań** do `app_company_id()` / `app_supplier_legacy_id()` w 15 plikach migracji. Tabele zależne od firmy: `companies` (update: `id = app_company_id()`), `company_contacts`, `company_certs`, `company_target_retailers` (`ctr_supplier_own`: `app_role()='supplier' and company_id = app_company_id()`), `company_hidden_retailers`, `offers`/`offer_photos`, `legacy_offers`/`legacy_sends` (`supplier_legacy_id = app_supplier_legacy_id()`), `packages`, `payu_orders`, `proformas` (select own), `fm_resps` (supplier o sobie), `fm_queue_*` (053).
- Storage: `offer-photos`, `company-logos`, `certs`, `company-materials` — polityki po pierwszym segmencie ścieżki `= app_company_id()::text` (003, 021). Odczyt `certs` tylko właściciel/admin; reszta publiczna do odczytu.
- Wszystkie polityki są **per konto → jedna firma**. Nie ma polityki opartej na relacji wielu firm.

### 1.4 Funkcje Netlify (service role)
- Firmę wywołującego wyprowadzają z jego profilu (`profile.company_id`): `ai-company-description`, `create-payu-order`, `generate-proforma`, `upsert-legacy-offer`.
- Konta: `admin-create-user` (rola + `company_id`/`retailer_id`, tworzy usera, **magic link zwraca adminowi w odpowiedzi** — wysyłka ręczna), `admin-update-user` (może zmienić e-mail, rolę, **przepiąć `company_id`**), `admin-reset-password` (link), `register-supplier-self` (publiczna rejestracja: firma `pending_review` + profil + mail do dostawcy i admina), `admin-staff` (konta obsługi z syntetycznym e-mailem `staffEmailFor(code)` i `app_metadata.role` — precedens „kontrolowanego adresu technicznego").
- Logowanie (`LoginPage`): hasło, magic link, „Przypomnij hasło" — istnieją.

### 1.5 Powiadomienia e-mail (Resend)
| Funkcja | Adresat dziś |
|---|---|
| `send-supplier-notification` (statusy, akceptacja itd.) | **pierwszy** profil `supplier` firmy wg `created_at` |
| `send-retailer-batch` (powiadomienie o wysyłce do sieci) | **pierwszy aktywny** profil firmy — kolejność zapytania niezdefiniowana |
| `fm-plan-send` (karty planu spotkań) | **wszystkie aktywne** profile `supplier` firmy; przy braku adresata odmawia (`no_canonical_recipients`) |
| `generate-proforma`, `create-payu-order` | e-mail **wywołującego** użytkownika |
| `send-expiry-reminders`, `send-inactivity-warnings` | e-mail profilu |

Wniosek: przy więcej niż jednym koncie w firmie adresat jest przypadkowy; przy koncie koordynatora w firmie — koordynator dostałby wszystko.

### 1.6 Chat i komunikacja kupiec ↔ dostawca
- `fm_messages`: `thread_key`, `from_role`, `from_user_id`, `to_role`, `to_user_id`, `body`, `data`. Dla dostawcy `thread_key = 'user:<company_id>'` (bo `account.id = company_id`) — **wątek jest już per firma**. Ale RLS (`fmm_self`, 019) jest **per użytkownik**: `from_user_id = auth.uid() or to_user_id = auth.uid()`; admin odpowiada do konkretnego `to_user_id`. Drugi użytkownik tej samej firmy nie zobaczyłby odpowiedzi admina do pierwszego.
- Kupiec **nie pisze do dostawcy bezpośrednio** (zasada prywatności: dostawca nie widzi danych kupca). Kontakt kupiec→dostawca idzie przez admina albo przez PreConnect (`legacy_sends`, klucz firmy) — więc „wiadomości kupców" w tym modelu = wątek admina z firmą + powiadomienia o odczycie/odpowiedzi.
- 45 wiadomości od dostawców w chacie (stan 11.09).

### 1.7 Ślad działań
- `audit_log` (001) istnieje, `logAction()` w `db.js` istnieje — **0 wierszy w bazie**. Nie ma dziś odpowiedzi na pytanie „kto wykonał operację" poza `from_user_id` w chacie, `approved_by`, `archived_by`.

### 1.8 Stan danych (11.09, odczyt zbiorczy)
- 91 firm (80 z FM B2B), 93 profile `supplier`. **89 firm ma dokładnie jedno aktywne konto, żadna nie ma dwóch.** 2 firmy bez konta (m.in. ALJANSAS AIBĖ — odrzucona).
- 4 profile `supplier` **bez firmy** (Maciej Nawrot z 24.06, dwa konta gmail bez nazwy z 20.08 i 1.09, jedno z domeny `polska.leclerc` z 1.09 — najpewniej kupiec zarejestrowany formularzem dostawcy). Te osoby po zalogowaniu widzą ekran „brak firmy".
- Wspólne domeny logowania między firmami: gmail (6 firm), wp.pl (4), `grupoyes.org` (2 rekordy: „Grupo YES" i „GRUPO YES P&M, S.L." — prawdopodobny duplikat), `krzysmar.eu` (2 — potwierdzony duplikat).
- Anna Wiernicka: **jedno** konto `supplier` (gmail) przy firmie „wierniccy.co" (aktywna, FM włączone, 0 wyborów). Innych kont na jej nazwisko w bazie nie ma — „wcześniejsze adresy dla kilku podmiotów" nie są dziś widoczne jako osobne konta, więc nie ma czego rozplątywać.

---

## 2. Ryzyka obecnego rozwiązania

Odniesienie do siedmiu punktów z pytania + to, co wynika z audytu:

| # | Ryzyko | Skąd się bierze w kodzie | Skutek |
|---|---|---|---|
| 1 | Wiadomości do Anny zamiast do firmy | adresat = pierwszy profil / wywołujący (1.5); chat per użytkownik (1.6) | przy koncie Anny w firmie ona dostaje statusy, proformy, odpowiedzi |
| 2 | Plan spotkań na zły adres | `fm-plan-send` → wszystkie profile firmy; przy braku adresu — brak wysyłki | konto na aliasie Anny = plan idzie do Anny; firma bez konta = plan nie idzie wcale |
| 3 | Pomieszanie ofert/preferencji/dokumentów | wszystko kluczowane `company_id` — **to akurat trzyma**; miesza się dopiero przy jednym koncie na kilka firm (niemożliwe technicznie) albo przy przepięciu `company_id` (`admin-update-user`) | przepięcie konta między firmami zostawia historię (chat, zgody) przy osobie |
| 4 | Brak informacji, kto wykonał operację | `audit_log` pusty; zapisy wyborów bez autora | spór „kto wybrał sieci" nie do rozstrzygnięcia |
| 5 | Wyciek danych między firmami | RLS per konto — dziś **nie ma** wycieku; ryzyko powstaje, gdyby politykę zmienić na „wszystkie firmy użytkownika" | dlatego rekomendacja: kontekst aktywnej firmy, nie suma firm |
| 6 | Przekazanie konta właściwej osobie | zmiana e-maila profilu (`admin-update-user`) przenosi zgody i historię na nową osobę | należy tworzyć **nowe** konto właściciela, nie podmieniać e-mail |
| 7 | Historia komunikacji i zgód | zgody per profil (`accepted_*`, 032/034) | zgody Anny ≠ zgody firmy |
| 8 | Aliasy e-mail | unikalność w `auth.users` | Anna musiałaby mieć 16 skrzynek — to właśnie „prowizorka", której chcemy uniknąć |
| 9 | Duplikaty firm | brak kontroli unikalności nazwy/NIP; import z Excela dołoży kolejne | Grupo YES ×2, KRZYŚ-MAR ×2 już teraz |
| 10 | Konta bez firmy | rejestracja publiczna bez dopasowania | 4 osoby „w próżni", w tym prawdopodobny kupiec |

---

## 3. Rekomendowany model danych

```
companies                         -- bez zmian struktury + 3 kolumny
  official_email        text      -- oficjalny adres firmy (nie login osoby)
  official_contact_name text
  onboarding_state      text      -- 'draft_no_owner' | 'invited' | 'owned'

company_memberships               -- NOWA, źródło prawdy o dostępie
  id            uuid pk
  user_id       uuid → auth.users
  company_id    uuid → companies
  role          text  check in ('owner','member','delegate','viewer')
  scope         jsonb -- dla delegate: {"profile":true,"materials":true,"selection":true,"confirm":false,"plan_view":true}
  status        text  check in ('active','disabled')  default 'active'
  notify        boolean default false   -- czy dostaje kopie powiadomień firmy
  expires_at    timestamptz
  granted_by    uuid → profiles
  granted_at    timestamptz default now()
  note          text
  unique (user_id, company_id)

profiles
  role                 += 'coordinator'  (ALTER TYPE ADD VALUE, jak 052)
  company_id           -- zostaje: „firma domowa" właściciela; dla coordinator = null
  active_company_id    uuid  -- kontekst pracy, ustawiany wyłącznie RPC set_active_company()

company_target_retailers          -- pochodzenie wyborów (pyt. 9)
  source          text check in ('supplier_panel','coordinator','admin_phone','admin_email','import')
  entered_by      uuid → profiles
  entered_at      timestamptz
  note            text
  company_confirmed_at timestamptz   -- właściciel potwierdził zestawienie

companies.fm_selection_confirmed_by uuid, fm_selection_confirmed_source text

fm_messages.on_behalf_of_company_id uuid   -- „Anna odpowiedziała w imieniu firmy X"
audit_log.on_behalf_of_company_id  uuid   -- + realne używanie logAction()
```

Dlaczego tak:
- **`profiles.company_id` zostaje.** 69 odwołań w RLS, 4 funkcje Netlify, 11 zapytań w `db.js` i cały panel opierają się na nim. Backfill: każdy obecny profil `supplier` z `company_id` → wiersz `owner` w `company_memberships` (89 wierszy). Rekordy się nie rozjeżdżają, bo trigger pilnuje, że `owner` ma `profiles.company_id = company_id`.
- **Delegat jako rodzaj członkostwa** (pyt. 4): jedna ścieżka w RLS (`has_company_access`), jedna lista w UI admina, jeden mechanizm wygaszania. Osobna tabela `company_delegates` dałaby dwie ścieżki do utrzymania.
- **Kontekst aktywnej firmy w `profiles.active_company_id`** zamiast w JWT: przełączenie działa natychmiast, bez odświeżania tokenu; wada — kontekst jest per użytkownik, nie per karta przeglądarki. Dla jednej koordynatorki to akceptowalne, UI musi pokazywać aktywną firmę w nagłówku i wywoływać `set_active_company` przed każdą sesją edycji. Wersja 2 (opcjonalnie): claim w JWT przez Supabase Auth Hook.

---

## 4. Projekt RLS

### 4.1 Funkcje
```sql
-- kontekst: aktywna firma, jeśli użytkownik ma do niej aktywne członkostwo; inaczej firma domowa
create or replace function public.app_company_id() returns uuid
language sql security definer stable as $$
  select coalesce(
    (select p.active_company_id from profiles p
      where p.id = auth.uid() and p.active_company_id is not null
        and exists (select 1 from company_memberships m
                    where m.user_id = p.id and m.company_id = p.active_company_id
                      and m.status = 'active' and (m.expires_at is null or m.expires_at > now()))),
    (select company_id from profiles where id = auth.uid())
  );
$$;

create or replace function public.membership_role(p_company uuid) returns text …  -- 'owner'|'member'|'delegate'|'viewer'|null; admin → 'owner'
create or replace function public.has_company_access(p_company uuid, p_scope text default null) returns boolean …
  -- true gdy is_admin() lub aktywne członkostwo; dla 'delegate' dodatkowo scope->>p_scope = true
create or replace function public.set_active_company(p_company uuid) returns companies
language plpgsql security definer as $$ … sprawdza has_company_access, ustawia profiles.active_company_id, wpis do audit_log … $$;
```
`app_supplier_legacy_id()` — bez zmian w treści (liczy z `app_company_id()` po przepisaniu na nową funkcję), więc `legacy_offers`/`legacy_sends` działają automatycznie.

### 4.2 Polityki
- **Krok 1 (bez przepisywania):** wszystkie obecne polityki z `company_id = app_company_id()` działają dla właściciela jak dziś i dla delegata w kontekście aktywnej firmy. Zero zmian w 69 odwołaniach.
- **Krok 2 (zawężenia dla delegata):**
  - `packages`, `payu_orders`, `proformas` — select: `and membership_role(company_id) in ('owner','member')` (delegat bez portfela).
  - `companies` update — RLS nie rozróżnia kolumn; trigger `enforce_company_update_scope`: dla `membership_role = 'delegate'` odrzuca zmianę `official_email`, `official_contact_name`, `account_status`, `fm_b2b_*`, `pkg_*`.
  - `company_target_retailers` — `ctr_supplier_own` rozszerzyć o `app_role() in ('supplier','coordinator')` i `has_company_access(company_id, 'selection')`.
  - `company_memberships` — select: własne wiersze lub `is_admin()` lub `membership_role(company_id) = 'owner'`; insert/update/delete: `is_admin()`; właściciel może dodawać `member`/`viewer` (wersja późniejsza).
  - `profiles` — delegat **nie** widzi profili użytkowników firmy (dziś `profiles_select_own_or_admin` — zostaje).
  - `fm_messages` — patrz §7.
- **Storage:** dziedziczy z `app_company_id()`. Dodatkowo `certs`/`company-materials` write: `has_company_access(company, 'materials')`.
- **Netlify:** helper `_shared/company-access.js` (`resolveCompanyForCaller(supabaseSvc, userId, body.company_id)` → sprawdza członkostwo; brak `company_id` w body = `profile.company_id`). Podpiąć w 4 funkcjach z §1.4 oraz w nowych (delegacje, wybory w imieniu).
- **Test:** hostowany skrypt jak `scripts/fm-staff-list-hosted-test.mjs` — trzy sesje (owner A, delegat A+B, owner C): delegat w kontekście A nie czyta B ani C, bez kontekstu nie czyta nic, po `expires_at` traci dostęp, storage list/upload tylko w `<A>/`.

---

## 5. Zapraszanie i przejmowanie konta

**A. Firma z oficjalnym adresem (13 z 16):**
1. Admin tworzy rekord firmy (lub odnajduje istniejący — sprawdzić duplikaty po nazwie/NIP/domenie).
2. Admin wpisuje `official_email` + `official_contact_name`.
3. `admin-create-user` z rolą `supplier`, `company_id`, e-mailem oficjalnym → `company_memberships(owner)`; **funkcja wysyła zaproszenie sama** (Resend, szablon `invite_owner`, PL/EN) zamiast zwracać link adminowi. `onboarding_state = 'invited'`.
4. Przedstawiciel otwiera link (magic link) albo używa „Przypomnij hasło" na stronie logowania, ustawia hasło, akceptuje regulamin (zgody zapisują się na jego profilu). `onboarding_state = 'owned'`.
5. Od tego momentu powiadomienia, plan i chat idą na jego adres.

**B. Firma bez adresu (3 z 16):** rekord `companies` z `onboarding_state = 'draft_no_owner'`, `account_status = 'pending_review'`, bez użytkownika. Delegat/admin uzupełnia profil i wybory. Blokady: publikacja planu i `fm-plan-send` (już odmawia bez adresata), pokazanie w katalogu kupcom (do decyzji). Admin widzi ostrzeżenie na liście. Po podaniu adresu → ścieżka A. Przed 22.09 brak adresu = firma poza wysyłką planu.

**C. Przejęcie konta założonego „na kogoś innego":** nie zmieniać e-maila istniejącego profilu. Utworzyć nowe konto `owner` na adres firmy, stare przełączyć na `delegate` (lub `member`) albo dezaktywować. Historia chatu i zgód zostaje przy właściwych osobach.

**D. Konta bez firmy (4 dziś):** admin dopasowuje do firmy (`admin-update-user`) albo archiwizuje; konto z domeny `polska.leclerc` sprawdzić jako kupca.

---

## 6. Delegowany dostęp koordynatora

- Anna: **jedno** konto, `role = 'coordinator'`, `company_id = null` (jej własna firma „wierniccy.co" zostaje osobnym członkostwem `owner`, jeśli ma brać udział).
- Admin → Firmy → „Dostępy": dodaj delegację (użytkownik, firma, zakres, ważna do, notatka). Domyślny zakres: profil, materiały, wybór sieci, podgląd planu; **bez**: portfel/proformy/PayU, zmiana oficjalnego adresu, zarządzanie użytkownikami. „Potwierdzanie preferencji" — osobny przełącznik (domyślnie wyłączony; patrz §7).
- Panel koordynatora: przełącznik „Obsługiwana firma" (lista z członkostw), nagłówek zawsze pokazuje aktywną firmę, przełączenie = `set_active_company`. Reszta panelu dostawcy bez zmian (`account.id = aktywna firma`).
- Każdy zapis delegata: `audit_log(user_id = Anna, on_behalf_of_company_id, action, entity, meta)` — `logAction()` już istnieje, trzeba go wywoływać (wybory, profil, materiały, potwierdzenie).
- Wygaśnięcie: `expires_at` (np. 30.09.2026) + `status = 'disabled'` przez admina; po wygaśnięciu `has_company_access` zwraca false, kontekst spada do `company_id` (= null → ekran „brak aktywnej firmy").

---

## 7. Komunikacja i wysyłka planów

- **Adresaci powiadomień firmy** = e-maile członkostw `owner` i `member` z aktywnym profilem; delegat tylko gdy `membership.notify = true`. Wspólny helper `_shared/company-recipients.js` zastępuje trzy różne dzisiejsze sposoby (§1.5). `fm-plan-send`: to samo źródło.
- **Chat:** wątek per firma (już jest). RLS `fmm_self` → `is_admin() or from_user_id = auth.uid() or to_user_id = auth.uid() or (thread_key = 'user:' || app_company_id()::text)`, a dla delegata dodatkowo zakres `chat`. Wiadomość od delegata: `from_user_id = Anna`, `on_behalf_of_company_id = X`; UI admina: „Anna Wiernicka · w imieniu PRZEDSIĘBIORSTWO …". Kupiec widzi wyłącznie firmę (bez zmian — kupiec nie ma dostępu do chatu dostawcy).
- **Plan i karty spotkań:** do właścicieli; PDF/mail bez danych koordynatora.
- **Potwierdzenie wyboru:** rekomendacja — potwierdzenie przez delegata jest **wstępne** (`fm_selection_confirmed_source = 'coordinator'`); system wysyła właścicielowi zestawienie z linkiem „Potwierdzam / Chcę zmienić"; finalne = `company_confirmed_at`. Jeśli firma nie ma jeszcze konta, potwierdzenie delegata jest jedynym i admin to widzi (żółty znacznik).
- **Dane kontaktowe dla sieci** (kupiec widzi osobę + telefon dostawcy) — nadal z `company_contacts`/profilu właściciela, nigdy z profilu delegata.

---

## 8. Bezpieczny wariant tymczasowy przed 16.09 (bez migracji)

Wybory trwają do 16.09 23:59, import planu 23.09, wydarzenie 24.09. Zostało 5 dni — **nie zmieniamy schematu ani RLS**. Zasady:

1. **Żadnych kont na adresach Anny** dla obcych firm. Anna nie loguje się na konta firm. Jej konto „wierniccy.co" zostaje tylko dla jej podmiotu.
2. **Firmy z Excela** — najpierw dopasowanie do istniejących 91 rekordów (nazwa, NIP, domena); dopiero brakujące zakłada admin (`bulkUpsertCompanies` istnieje; import z Excela robi admin lub ja skryptem read-only → lista do zatwierdzenia).
3. **Firmy z adresem (13):** admin zakłada konto `supplier` na **oficjalny adres firmy** (`admin-create-user`), magic link przekazuje firmie (dziś ręcznie — to istniejący, sprawdzony tryb). Firma może od razu sama wejść i wybierać.
4. **Preferencje z Excela Anny:** wprowadza **admin, nie Anna**. Dwie opcje:
   - (a) mała funkcja tylko-adminowa „Wybory w imieniu firmy" w `FMAdminPreferencesView`: klik ⭐/👍 przy sieciach dla wybranej firmy, pole „źródło" (koordynator / telefon / e-mail) i notatka, zapis przez istniejące `setCompanyTargetRetailers` + wpis `logAction('fm_prefs_on_behalf', 'company', id, {source, note, by})` — dziś admin **nie ma** takiego ekranu; szacunek: 1 dzień + review Codexa; bez migracji (`audit_log` już istnieje);
   - (b) bez kodu: skrypt SQL wykonywany przez admina z Excela → `company_target_retailers` (priorytet 1000 = ⭐, 100 = 👍) + wiersze w `audit_log` z `meta` (źródło, kto, kiedy). Mniej wygodne, zero ryzyka regresji.
5. **Potwierdzenie przez firmę:** po wprowadzeniu wyborów firma dostaje mail (istniejący `send-supplier-notification` z nowym, prostym szablonem albo ręczny mail admina) z zestawieniem i prośbą o zalogowanie i kliknięcie „Potwierdź wybór". Bez potwierdzenia firma pozostaje na liście „niepotwierdzone" w panelu admina (już istnieje).
6. **Firmy bez adresu (3):** rekord firmy `pending_review`, wybory wprowadzone przez admina (jak w pkt 4), **bez konta**; ostrzeżenie w admin (notatka w `status_note`). Jeśli do 22.09 nie podadzą adresu — nie dostaną planu i kart (funkcja i tak odmówi) → decyzja Artura, czy zostają w algorytmie.
7. **Telefon:** admin przyjmuje, wpisuje jak w pkt 4 ze źródłem „telefon" i wysyła firmie zestawienie e-mailem tego samego dnia.
8. **Porządki przy okazji:** duplikat Grupo YES (sprawdzić), 4 konta bez firmy (dopasować/archiwizować), `polska.leclerc` jako kupiec.

Co wariant tymczasowy **nie** rozwiązuje: Anna nie ma podglądu „swoich" firm w aplikacji — pracuje na Excelu i przez admina. To świadoma cena za brak zmian w bazie na 5 dni przed zamknięciem wyborów.

---

## 9. Docelowy plan wdrożenia (po wydarzeniu)

| Etap | Termin | Zakres | Ryzyko |
|---|---|---|---|
| E1 fundament | 25–30.09 | migracje 054–055: `company_memberships` + backfill `owner`, `official_email`, `onboarding_state`, nowa `app_company_id()`, `membership_role`, `has_company_access`, `set_active_company`; brak zmian UI | znikome — identyczny wynik dla obecnych kont; rollback = stara funkcja |
| E2 koordynator | 1–10.10 | 056 rola `coordinator` (osobny plik, jak 052); front: członkostwa w `AuthProvider`, przełącznik firmy, `account` z aktywnej firmy; admin: Firmy → Dostępy; helper `company-access` w 4 funkcjach Netlify; test hostowany RLS | średnie — dotyka panelu dostawcy, po sezonie |
| E3 komunikacja | 10–20.10 | 057 RLS chatu per firma + `on_behalf_of_company_id`; `company-recipients` w send-*; szablon zaproszenia wysyłany przez `admin-create-user`; etykiety „w imieniu" | średnie |
| E4 pochodzenie i audyt | 20–31.10 | 058 kolumny pochodzenia w `company_target_retailers`, `fm_selection_confirmed_by/source`, zestawienie do potwierdzenia, `logAction` w kluczowych operacjach, widok audytu w admin | niskie |
| E5 porządki | równolegle | unikalność firm (NIP/domena), dopasowanie kont bez firmy, zawężenia delegata (portfel, kolumny) | niskie |

Każdy etap: osobna gałąź, review Codexa, migracja ręcznie po deployu frontu (jak dotąd), tag rollbacku.

---

## 10. Migracje i zmiany w kodzie

**Migracje (kolejność po 053):**
- `054_company_memberships.sql` — tabela, indeksy, RLS tabeli, backfill z `profiles.company_id` (role `owner`), trigger spójności `owner ↔ profiles.company_id`, `companies.official_email/official_contact_name/onboarding_state` (+ backfill `official_email` z e-maila właściciela, `onboarding_state='owned'`).
- `055_company_context_functions.sql` — `profiles.active_company_id`, `app_company_id()` v2, `membership_role()`, `has_company_access()`, `set_active_company()`; komentarze; **rollback w tym samym pliku jako sekcja**.
- `056_coordinator_role.sql` — `ALTER TYPE user_role ADD VALUE 'coordinator'` (bez transakcji, jak 052).
- `057_fm_messages_company_scope.sql` — `on_behalf_of_company_id`, nowe `fmm_self`/`fmm_insert_self`.
- `058_selection_provenance.sql` — kolumny w `company_target_retailers`, `companies.fm_selection_confirmed_by/source`, `audit_log.on_behalf_of_company_id`.
- `059_delegate_restrictions.sql` — zawężenia `packages/payu_orders/proformas`, trigger kolumn `companies`, zakres `materials` w Storage.

**Kod:**
- `src/auth/AuthProvider.jsx` — pobranie członkostw, `activeCompany`, `switchCompany()`; `ProtectedRoute` — rola `coordinator` bez `company_id` dopuszczona, wymaga aktywnej firmy.
- `src/legacy/PreconnectFM.jsx` — `buildAccountFromCurrentUser`: `id = activeCompany.id`; nagłówek z aktywną firmą i przełącznikiem; chat: etykieta „w imieniu"; admin: Firmy → Dostępy, „Wybory w imieniu firmy", oznaczenia pochodzenia i potwierdzenia.
- `src/lib/db.js` — `listMyMemberships`, `setActiveCompany`, `setCompanyMembership` (admin), `logAction` wywoływane w: wybory, potwierdzenie, profil, materiały.
- `netlify/functions/_shared/company-access.js`, `_shared/company-recipients.js`; zmiany w `ai-company-description`, `create-payu-order`, `generate-proforma`, `upsert-legacy-offer`, `send-supplier-notification`, `send-retailer-batch`, `fm-plan-send`, `admin-create-user` (wysyłka zaproszenia), nowa `admin-membership.js`.
- i18n PL/EN: koordynator, dostępy, „w imieniu", stany onboardingu, zestawienie do potwierdzenia.
- Testy: `fm-access.test.js` (funkcje czyste), test hostowany RLS trzech sesji, testy komponentów przełącznika i widoku admina.

---

## Załącznik — decyzje do podjęcia przez Artura

1. Wariant 4(a) (mały ekran admina) czy 4(b) (skrypt SQL) na najbliższe 5 dni.
2. Czy potwierdzenie wyboru przez koordynatora ma być finalne, czy wymaga potwierdzenia właściciela (rekomendacja: wymaga).
3. Czy firmy bez oficjalnego adresu do 22.09 zostają w algorytmie (bez planu i kart) czy wypadają.
4. Czy dopuszczamy „kontrolowany adres koordynatora" jako stan tymczasowy po 16.09 (rekomendacja: tylko z datą ważności i ostrzeżeniem, nigdy jako domyślny adresat).
5. Termin E1 (25–30.09) — czy po wydarzeniu jest okno na migracje.
