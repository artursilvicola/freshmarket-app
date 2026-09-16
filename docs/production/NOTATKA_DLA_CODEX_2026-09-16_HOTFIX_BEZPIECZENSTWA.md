# Hotfix bezpieczeństwa B2B — propozycja do akceptacji (16.09.2026)

**Status: NIE ZASTOSOWANE.** Gałąź `fix/security-hotfix-2026-09-16` (z `origin/main` 467cbe4).
Migracja `supabase/migrations/054_security_hotfix.sql` czeka na zgodę Artura; frontend czeka na review.
Nic z tego nie wysyła maili, nie publikuje planu i nie zmienia wyborów uczestników.

Odpowiedź na audyt Codexa z 16.09 i jego 6 korekt do mojego pierwszego planu:
(1) nie tylko anon, także zalogowany dostawca; (2) kontakty kupców natychmiast;
(3) plan ukryty przed dostawcą/kupcem zanim ktokolwiek zapisze szkic, logo działa;
(4) ryzyko zapisu wyborów nie kończy się o 23:59 — blokada w bazie; (5) zbiorczy
resave kupca nadpisuje kolegę; (6) triggery nie mogą blokować zapisu profilu,
kontaktów, certyfikatów, `fm_selection_confirmed_at`.

---

## 1. Co jest dziś na produkcji (stan zweryfikowany 16.09, SQL Editor)

| Problem | Dowód |
|---|---|
| `consent_audit`, `company_capacity`, `v_admin_registrations`, `v_admin_stats`, `articles_with_facts` — widoki bez `security_invoker`, właściciel `postgres`, ACL `anon=arwdDxtm` | `pg_class.relacl`; anon `HEAD consent_audit` → 142 wierszy (24 kupców z e-mailem); prosty widok `consent_audit` jest **aktualizowalny** → anon ma prawo `DELETE` przez widok z pominięciem RLS profiles |
| `retailers.buyer_name/buyer_email/buyer_phone` czytelne dla każdego zalogowanego | polityka `retailers_select_all_authenticated using (auth.uid() is not null)` + `getRetailers()` robi `select *`; 44 sieci mają wpisany kontakt (41 z kontem kupca, 3 bez — m.in. FRAC) |
| `fm_settings.schedule` czytelne dla wszystkich (także anon) | `fm_settings_public_read using (true)`; dziś `{}`, ale pierwszy zapis szkicu 23.09 byłby publiczny |
| dostawca czyta wszystkie `fm_prefs` | stara polityka z 002 `fm_prefs_select_role_based (… or app_role() = 'supplier')`; duplikaty na `fm_resps`, `fm_settings` |
| właściciel firmy może zmienić **każdą** kolumnę `companies` (37 kolumn UPDATE dla authenticated, RLS `id = app_company_id()`), własny profil — `company_id`, `retailer_id`, `active`, `fm26_active`, `buyer_categories` | `information_schema.column_privileges`; trigger 033 chroni tylko `role`/`admin_level` |
| storage `company-logos` / `offer-photos`: każdy zalogowany może nadpisać/usunąć **dowolny** plik | polityki `*_authenticated` (dryf od migracji 003, która była per-folder) |
| brak blokady zapisów wyborów po zamknięciu fazy na poziomie bazy | tylko UI (`phase !== 2`); `setCompanyTargetRetailers` = DELETE + INSERT |
| zbiorczy „fallback save” `fmResps` u kupca | `PreconnectFM.jsx` ~3050: co zmianę stanu zapisywał wszystkie odpowiedzi sieci ze stanu jednego kupca |
| `send-retailer-batch` zapisuje adresy kupców w `legacy_sends.data.resendBuyerEmails` (wiersz czytelny dla dostawcy) | dziś 0 wierszy, ale każdy kolejny mailing by je dodał |

---

## 2. Dokładny SQL — `supabase/migrations/054_security_hotfix.sql`

Plik jest w repo (jedna transakcja, idempotentny). Streszczenie sekcji:

1. **Widoki**: `alter view … set (security_invoker = true)` dla `consent_audit`, `company_capacity`, `v_admin_registrations`, `v_admin_stats`; `revoke insert, update, delete, truncate, references, trigger` na wszystkich pięciu widokach od `anon, authenticated`; `revoke select` od `anon` na `consent_audit`, `v_admin_*`. Po zmianie `v_admin_*` przechodzą przez RLS tabel `event_registrations` (admin_all + self_read) i `participant_profiles` → zalogowany nie-admin widzi tylko własne rejestracje. `company_capacity` dla anon = 0 wierszy, dla dostawcy = jak `companies` (katalog).
2. **Kontakty kupców**: nowa tabela `retailer_contacts(retailer_id pk → retailers, buyer_name, buyer_email, buyer_phone, updated_at)`, RLS `is_admin()`, `revoke all from anon`. Kopia 44 kontaktów, potem `retailers.buyer_* = null`. Dwa triggery (`before update` / `after insert`) przenoszą każdy przyszły zapis `buyer_*` (panel admina, druga aplikacja, stary bundle) do `retailer_contacts` i zerują kolumny.
3. **Plan**: nowa tabela `fm_plan_private(id=1, schedule jsonb, updated_at, updated_by)`, RLS `is_admin()`. Trigger `before insert or update` na `fm_settings` przenosi `schedule` do `fm_plan_private` i zostawia `null` (stary bundle dalej działa). RPC `fm_my_schedule()` (security definer): admin → całość; dostawca → `res`/`nums` tylko dla własnych kluczy (company_id, legacy_fm_id, legacy_supplier_id); kupiec → tylko firmy z jego chainem w `m`, `m = [własny chain]`, `nums` tylko własnego chainu, bez `r` (ocen); dostawca i kupiec dostają `null`, dopóki `algo_phase ∉ {published, final_published, event_day}`. `fm_current_phase()` (definer) — faza bez zależności od RLS. `getBrandSettings()` (`brand_logo_url` + `order by updated_at`) i `getFmSettings()` (`select *`) działają bez zmian — kolumna `schedule` istnieje, jest tylko pusta.
4. **Stare polityki 002**: drop `fm_prefs_select_role_based`, `fm_prefs_modify_buyer_or_admin`, `fm_resps_select_role_based`, `fm_resps_modify_admin`, `fm_settings_admin_write`, `fm_settings_modify_admin`, `fm_settings_select_authenticated`, `fms_read_all`. Zostają `fmp_*`, `fmr_*`, `fms_admin_write`, `fm_settings_public_read` (logo/partnerzy/faza dla ekranu logowania; anon widzi też `venue`, `event_date`, `message` — do decyzji, czy to problem).
5. **Triggery ochronne** (`fm_is_privileged_session()`: service_role / security definer / SQL Editor / admin = bez ograniczeń; funkcje są SECURITY INVOKER, więc `purchase_package`, `handle_new_user`, `touch_last_active` nie są blokowane):
   - `profiles`: INSERT z rolą admin/staff lub `admin_level` przez nie-admina → błąd 42501; UPDATE przez nie-admina **przywraca** `company_id`, `retailer_id`, `active`, `fm26_active`, `buyer_categories`, `archived_*` (nie rzuca błędu → „Mój profil”, locale, `last_active_at`, zgody zapisują się jak dotąd).
   - `companies`: INSERT przez nie-admina → kolumny administracyjne na wartości domyślne (`pending_review`, `fm_b2b_enabled=false`, `fm_b2b_packages=1`, `fm_b2b_tier='business'`, `pkg_plan=null`…); UPDATE przez właściciela **przywraca** `account_status`, `preconnect_enabled`, `fm_b2b_enabled`, `fm_b2b_packages`, `fm_b2b_tier`, `approved_at/by`, `pkg_plan`, `pkg_expiry`, `legacy_*`, `fm_plan_sent_at`, `status_note`, `created_at`. Wszystko inne (profil, `completeness`, `profile_data`, `ai_review_status`, `fm_selection_confirmed_at`, kontakty, certyfikaty) przechodzi. Dodatkowa korzyść: zapis profilu ze stanem sprzed zmiany pakietu przez admina nie cofnie już tej zmiany.
6. **Storage**: drop sześciu polityk `*_authenticated`; `company_logos_modify_owner_or_admin` / `offer_photos_modify_owner_or_admin` = `is_admin() or (storage.foldername(name))[1] = app_company_id()::text` (ścieżki w aplikacji to `${companyId}/…`; loga sieci wgrywa admin do `retailer-<id>/`). Publiczny odczyt bez zmian.
7. **Blokada wyborów**: trigger `fm_inputs_phase_lock` (before insert/update/delete) na `company_target_retailers` i `fm_resps` → dla nie-admina błąd `fm_inputs_locked` (P0001), gdy `algo_phase ≠ preferences_open`. Dziś faza = `preferences_open`, więc do 23.09 nic się nie zmienia; po przełączeniu na `matching` baza odrzuca zapisy niezależnie od wersji bundla. `fm_selection_confirmed_at` nadal zapisywalne. Tabela `fm_inputs_snapshots` + `select fm_backup_inputs('etykieta')` (admin) — kopia wyborów, odpowiedzi, prefs, wishlist, firm FM, sieci i fm_settings przed przeliczeniem.
8. **legacy_sends**: `data - 'resendBuyerEmails' || {resendBuyerCount: n}` (dziś 0 wierszy).
9. Wpis do `audit_log` (`security_hotfix` / `migration` / `054`).

**Rollback** (jeśli trzeba): `drop trigger` ×7 i funkcje (`fm_inputs_phase_lock`, `profiles_guard_protected`, `companies_guard_protected`, `fm_is_privileged_session`, `retailers_route_buyer_contacts`, `retailers_clear_buyer_contacts`, `fm_settings_route_schedule`, `fm_my_schedule`, `fm_current_phase`, `fm_backup_inputs`); przywrócenie polityk storage `*_authenticated` z produkcji; kontakty wracają przez `update retailers r set buyer_name = c.buyer_name, … from retailer_contacts c where c.retailer_id = r.id`; plan przez `update fm_settings set schedule = (select schedule from fm_plan_private)` po usunięciu triggera. Nie da się cofnąć: revoke na widokach (można nadać ponownie `grant`), drop polityk 002 (są w `002_rls_policies.sql`).

---

## 3. Zakres zmian w kodzie (gałąź `fix/security-hotfix-2026-09-16`)

| Plik | Zmiana |
|---|---|
| `src/lib/db.js` | `getRetailers()` osadza `contacts:retailer_contacts(...)` (u dostawcy/kupca null; fallback bez osadzenia, gdy front wejdzie przed migracją). `getFmSchedule()` → `rpc('fm_my_schedule')` (fallback do `fm_settings.schedule` przed migracją). `saveFmSchedule()` → upsert `fm_plan_private` (fallback jak dotąd). |
| `src/legacy/PreconnectFM.jsx` | kontakt awaryjny z `retailerContact(r)`; **usunięty** zbiorczy „fallback save” `fmResps` (zapisy tylko per klik w `setResp`); po błędzie `fm_inputs_locked` cofnięcie lokalnej zmiany + komunikat; `hasRetailerEmailMarker` rozumie `resendBuyerCount`. |
| `src/lib/retailer-contacts.js`, `src/lib/fm-input-lock.js` (+ testy) | helpery |
| `netlify/functions/send-retailer-batch.js` | zapisuje `resendBuyerCount` zamiast listy adresów |
| `netlify/functions/fm-plan-data.js` | `settings.schedule` czytane z `fm_plan_private` (service role) — eksport planu bez zmian dla odbiorcy |
| `src/i18n/{pl,en}/legacy.json` | `errors.db.fm_inputs_locked` |
| `scripts/fm-queue-sql-test.mjs` | `--test 053,054` |
| `supabase/tests/054_security_hotfix_test.sql` | T1–T8 (kontakty, anon, fm_prefs, triggery, plan per rola, blokada fazy + backup, storage, legacy_sends), całość w ROLLBACK |
| `scripts/fm-permission-probe.mjs` | sondy PRAWDZIWYCH kont przez PostgREST (anon / dostawca / kupiec / admin), `--writes` = bezpieczne próby zapisu |

Testy jednostkowe: **167/167**; `vite build` OK. Poza zakresem (bez zmian): wybory, odpowiedzi, plan, maile, Fozzy, daty wpłat.

Kolejność wdrożenia jest **dowolna** — kod ma fallbacki na brak tabel/RPC, a migracja ma trigger na stary bundle. Rekomendacja: najpierw SQL (zamyka wycieki od razu), potem deploy frontu.

---

## 4. Plan testów rzeczywistych uprawnień (po zastosowaniu SQL)

1. **Baza testowa** (nie produkcja): `DATABASE_URL=… node scripts/fm-queue-sql-test.mjs --only-test --test 053,054` — 053 musi nadal przechodzić (kolejki), 054 = T1–T8.
2. **Sondy PostgREST na produkcji, prawdziwe konta**: potrzebne konto testowe dostawcy (z firmą, hasło) i konto testowe kupca (przypisane do sieci testowej lub istniejącej, hasło) — Artur zakłada je w panelu admina (`/register`) i podaje mi tylko e-maile; hasła ustawia w zmiennych środowiskowych:
   ```
   FM_PROBE_URL, FM_PROBE_ANON_KEY, FM_PROBE_SUPPLIER_EMAIL/PASSWORD, FM_PROBE_BUYER_EMAIL/PASSWORD, (FM_PROBE_ADMIN_EMAIL/PASSWORD)
   node scripts/fm-permission-probe.mjs            # odczyty
   node scripts/fm-permission-probe.mjs --writes   # + próby zapisu, które mają zostać odrzucone
   ```
   Odczyty: anon nie czyta `consent_audit`/`v_admin_*`/`retailer_contacts`/`fm_plan_private`, `company_capacity` = 0, `fm_settings.schedule` = null; dostawca widzi sieci bez kontaktów, 0 `retailer_contacts`, 0 profili kupców, 0 `fm_prefs`, `fm_my_schedule` = null, `fm_resps`/wybory tylko własne, `legacy_sends` bez adresów; kupiec analogicznie + `profiles` tylko własny.
   Próby zapisu (`--writes`): dostawca próbuje podnieść sobie `fm_b2b_tier`/`fm_b2b_packages` (trigger przywraca), odpiąć `company_id` (przywraca), wgrać plik do cudzego folderu (RLS odrzuca), wgrać i usunąć 1-bajtowy plik we własnym folderze (działa); kupiec próbuje zmienić `retailer_id` (przywraca). **Żadna sonda nie dotyka wyborów sieci, odpowiedzi ani planu.**
3. **Ręcznie w aplikacji** (konta testowe): dostawca — zapis „Mój profil”, zapis profilu firmy z logo, wybór sieci ⭐/👍 w fazie 2 (działa), potwierdzenie wyboru; kupiec — odpowiedź na dostawcę (działa); admin — panel sieci pokazuje kontakt awaryjny (np. FRAC), „Dane wejściowe”, zapis szkicu planu trafia do `fm_plan_private`, `fm_my_schedule` zwraca całość.
4. **Symulacja zamknięcia fazy** (tylko na koncie testowym, w uzgodnionej minucie): admin przełącza `algo_phase` na `matching`, dostawca testowy klika ⭐ → komunikat „Etap zbierania wyborów jest już zamknięty”, wybór cofnięty; admin wraca na `preferences_open`.

---

## 5. Otwarte decyzje dla Artura

- **Zgoda na `054_security_hotfix.sql`** (SQL Editor, jedna transakcja; ~1 s). Mogę najpierw zrobić próbę na sucho (`begin … rollback`) — też wymaga zgody, bo dotyka produkcji.
- `fm_settings` dla anon: zostawić `venue`/`event_date`/`message`/`ui_content` publiczne (ekran logowania) czy ograniczyć do `brand_logo_url` + `ui_content` (wymaga przepisania `getFmSettings` na jawną listę kolumn)?
- `participant_profiles_authenticated_read using (true)` (druga aplikacja rejestracyjna) — każdy zalogowany widzi wszystkie profile uczestników; to nie jest w tym hotfixie (cudza tabela) — do przekazania właścicielowi drugiej aplikacji.
- Konta testowe dostawcy i kupca do sond (pkt 4.2).
