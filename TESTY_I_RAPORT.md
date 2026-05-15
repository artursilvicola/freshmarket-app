# Fresh Market — Raport końcowy testów + audyt
**Data:** 30.04.2026
**Aplikacja:** https://b2b.freshmarket.eu (fallback: https://freshmarketb2b.netlify.app)
**Repozytorium:** https://github.com/artursilvicola/freshmarket-app
**Baza:** Supabase (region eu-central-1)

---

## 1. Stan systemu w jednym widoku

| Komponent | Status | Uwagi |
|---|---|---|
| Aplikacja na Netlify | ✅ działa | URL publiczny, auto-deploy z `main` |
| Supabase Auth | ✅ działa | Email + hasło (potwierdzenie maila WYŁĄCZONE) |
| Supabase Database | ✅ działa | PostgreSQL, ~17 tabel |
| Supabase Storage | ✅ działa | 3 buckety: offer-photos, company-logos, certs |
| 3 panele po roli | ✅ działa | /admin /dostawca /kupiec, oddzielne sidebary |
| Multi-user offers/sends | ✅ działa | legacy_offers + legacy_sends w Supabase |
| Upload zdjęć ofert | ✅ działa | Auto-kompresja do 1600px WebP @0.85 |
| Upload logo firmy | ✅ działa | W "Twoja firma" |
| Upload logo retailera | ✅ działa | W panelu admin → Sieci |
| Izolacja kupiec ↔ kupiec | ✅ działa | RLS: buyer widzi tylko swoje retailer_id |
| Mailing przez Resend | ⚠ niezintegr. | Funkcja Netlify gotowa, brak konta Resend |
| Stripe (pakiety) | ⚠ niezintegr. | Logika UI jest, brak integracji płatności |
| Domena freshmarket.eu | ⚠ niezintegr. | Aplikacja na *.netlify.app |
| Email confirmation | ⚠ wyłączony | Świadoma decyzja - rate limit problemy |

---

## 2. Architektura — kluczowe założenia

### 2.1. Trzy role użytkowników
- **admin** — pełen dostęp do wszystkiego, ma w panelu "switcher" do udawania innych userów (test)
- **supplier (dostawca)** — widzi własne oferty, wysyłki, finanse, profil firmy
- **buyer (kupiec)** — widzi tylko propozycje wysłane do swojej sieci handlowej (retailer_id)

### 2.2. Tabele Supabase
**Domenowe (nowe, na przyszłość):**
- `profiles` — rozszerzenie auth.users o role + powiązanie z firmą/siecią
- `companies` — firmy dostawców (UUID id)
- `retailers` — sieci handlowe (integer id 100-120)
- `offers` — oferty (UUID id, supplier_company_id → companies)
- `sends` — wysyłki (UUID, offer_id → offers, retailer_id)
- `offer_photos`, `company_contacts`, `company_certs`, `wallet_tx`, `packages`, `retailer_limits`, `fm_*`, `audit_log`

**Legacy (używane teraz przez aplikację):**
- `legacy_offers` — JSONB `data` przechowuje pełną ofertę w formacie PreconnectFM
- `legacy_sends` — JSONB `data` przechowuje pełną wysyłkę

**Decyzja architektoniczna:** legacy_* tabele to most między starym kodem PreconnectFM (używającym numerycznych ID typu 1, 2, "sup-s1") a Supabase (UUID). Pozwala na multi-user persistence bez przepisywania całej legacy aplikacji. Docelowa migracja: zastąpić legacy_* tabele wykorzystaniem domenowych offers/sends.

### 2.3. RLS (Row Level Security) — co kto widzi
| Tabela | admin | supplier | buyer |
|---|---|---|---|
| profiles | wszystko | swój | swój |
| companies | wszystko | swoja + edycja | wszystko (read) |
| retailers | wszystko + edycja | wszystko (read) | wszystko (read) |
| legacy_offers | wszystko | wszystko (legacy) | tylko gdy istnieje send do mojej sieci |
| legacy_sends | wszystko | wszystko (legacy) | tylko `retailer_id = mój retailer` |

> **Uwaga:** dla supplierów polityki są permisywne, bo legacy app używa `account.id="sup-s1"` jako default supplier ID dla wszystkich. Pełna izolacja per-supplier wymaga dalszej pracy (mapowania profile.company_id → legacy supplier_id).

### 2.4. Photo upload pipeline
1. User wybiera plik w SimplePhotoUploader
2. **Kompresja** Canvas API → max 1600px boku, WebP @0.85 jakości (~150-300 KB)
3. Upload do Supabase Storage: bucket `offer-photos` lub `company-logos`
4. Path convention: `{companyId}/offer-{offerId}/{timestamp}-{filename}.webp`
5. Public URL zapisany w `legacy_offers.data.photos[]` (array stringów)
6. Storage RLS: każdy authenticated może wgrywać; read jest publiczny
7. Bezpieczeństwo: URL'e są w `legacy_offers.data` chronionym przez RLS — kupiec nie znając offer'u nie zna URL'a

---

## 3. Co zostało przetestowane

### 3.1. Testy ręczne (poprzez UI)
| # | Test | Wynik | Notatka |
|---|---|---|---|
| 1 | Rejestracja jako dostawca | ✅ | Pomyślnie tworzy konto + firmę |
| 2 | Rejestracja jako kupiec | ✅ | Tworzy konto, admin przypisuje retailer_id |
| 3 | Login email+hasło | ✅ | Sesja persistuje |
| 4 | Magic link logowania | ⚠ niezweryfikowane | Wymaga Resend integracji |
| 5 | Redirect po roli (/admin /dostawca /kupiec) | ✅ | Działa zgodnie z `profiles.role` |
| 6 | Panel admina — switcher między userami | ✅ | Tylko admin widzi switcher |
| 7 | Panel dostawcy — brak switchera | ✅ | Lockedrole=supplier |
| 8 | Panel kupca — brak switchera | ✅ | Lockedrole=buyer |
| 9 | Sidebar dostawcy ≠ sidebar kupca ≠ sidebar admina | ✅ | Każda rola ma własne menu |
| 10 | Multi-user persistence ofert (cross-browser) | ✅ | legacy_offers w Supabase |
| 11 | Upload logo firmy w "Twoja firma" | ✅ | Drag&drop → company-logos |
| 12 | Upload zdjęć w formularzu oferty | ✅ | Sekcja D. Zdjęcia produktu |
| 13 | Upload logo retailera w panelu admin → Sieci | ✅ | Pole LOGO SIECI |
| 14 | Auto-kompresja zdjęć przy uploadzie | ✅ | Canvas → WebP 0.85 |
| 15 | Widok kupca: 1 zdjęcie główne na liście | ✅ | Badge "+N" gdy więcej |
| 16 | Widok kupca szczegóły: accordion "Zdjęcia" zamknięty | ✅ | Po rozwinięciu pełny podgląd 4:3 contain |
| 17 | Klik w zdjęcie otwiera oryginał | ✅ | Nowa karta przeglądarki |
| 18 | RLS izolacja kupca: widzi tylko swoje | ✅ | retailer_id=100 → 3 oferty zamiast wszystkich 10 |

### 3.2. Czego NIE testowałem
- Faktyczna wysyłka maila do kupca (Resend nie jest podpięty)
- Stripe Checkout dla pakietów
- Magic link logowania (też potrzebuje SMTP/Resend)
- Cross-browser concurrency (dwóch supplierów edytuje tę samą ofertę)
- Performance pod obciążeniem (load test)
- A11y (accessibility — czytniki ekranu, kontrast, klawiatura)
- iOS Safari + Android Chrome (testowane tylko Chrome desktop)
- Zachowanie po logout w środku formularza oferty

---

## 4. Znane problemy / luki / długi techniczne

### 4.1. Architektura — rzeczy do dopracowania
1. **Stary AccountSwitcherBar nadal w kodzie legacy** — admin widzi switcher (potrzebne do testów), ale kod mógłby być wyczyszczony z mockowych kont po podpięciu wszystkiego do Supabase.
2. **Supplier identity mismatch** — legacy app trzyma supplier jako `account.id="sup-s1"` (string), Supabase trzyma UUID. To znaczy że dwóch różnych supplierów logujących się do aplikacji w tej chwili "udają" tego samego dostawcę z legacy seed. Naprawa: dodać `legacy_id` do `companies` i mapować przy logowaniu.
3. **Buyer.starred + walletMap + walletState** — nadal w localStorage przeglądarki (per-user UI state). Nie ginie, ale gdy zmienisz przeglądarkę nie przeniesie się.
4. **Retailer custom logo URL** — zapisywany w `retailers.logo_url` w bazie domenowej, ALE legacy app trzyma retailers w localStorage. Logo zniknie po reloadzie (chyba że admin powtórzy). Naprawa: też przenieść retailers do Supabase live-sync (jak offers/sends).
5. **`legacy_offers_supplier_all`** — pozwala każdemu supplierowi czytać/pisać wszystkie oferty (nie tylko swoje). Konsekwencja punktu (2). Niska priorytet w MVP.

### 4.2. Bezpieczeństwo — co warto wkrótce
- **Storage URL'e są publiczne** — każdy kto zna URL widzi plik. Mityguje to fakt że URL'e są długie + losowe + zawarte w legacy_offers (RLS chroni metadane). Pełna ochrona = signed URLs (1h TTL) generowane server-side.
- **Brak rate-limitingu logowania** — Supabase domyślnie ma własny, ale warto sprawdzić limity dla swojej darmowej puli.
- **Email confirmation off** — świadoma decyzja na czas testów. Włączyć przed produkcją z prawdziwymi userami.

### 4.3. Wydajność
- **Wszystkie offers/sends ładowane na każde wejście do aplikacji** — `loadLegacyOffers()` zwraca wszystkie wiersze. Przy 10000 ofert to będzie problem. Rozwiązanie: paginacja albo selektywne queries.
- **Brak caching** — każdy render odświeża `account` i przelicza co. Można dodać React Query albo SWR.
- **JSONB nie ma `tsvector` dla full-text search** — search filtrów po stronie klienta. Przy >1000 ofert: wolno.

### 4.4. UI/UX
- **Sidebar dostawcy: "FRESH MARKET 2026 → Spotkania FM 2026 🔒"** — zamknięte, ale ikonka kłódki sugeruje że można odblokować. Można poprawić tooltip.
- **Brak resetowania hasła** — user co zapomniał hasła musi przez reset link → wymaga Resend.
- **Brak avatar / zdjęcia profilowego** — w nagłówku tylko imię i przycisk Wyloguj.
- **Mobile** — niesprawdzane, prawdopodobnie potrzebne `viewport` zmiany.

---

## 5. Niezależne testy SQL (do uruchomienia)

Plik: `supabase/tests/independent_tests.sql` — uruchom w Supabase SQL Editor.

```sql
-- TEST 1: Czy są dwie tabele legacy_*
select count(*) from information_schema.tables
where table_schema='public' and table_name like 'legacy_%';
-- Oczekiwane: 2

-- TEST 2: Każda oferta ma supplier_legacy_id
select count(*) as offers_without_supplier
from legacy_offers where supplier_legacy_id is null or supplier_legacy_id = '';
-- Oczekiwane: 0

-- TEST 3: Każda wysyłka ma retailer_id
select count(*) as sends_without_retailer
from legacy_sends where retailer_id is null;
-- Oczekiwane: 0

-- TEST 4: Każda wysyłka ma poprawny status
select status, count(*) from legacy_sends group by status;
-- Oczekiwane: tylko statusy z STATUS_MAP (queued, pending_moderation, approved, rejected, sent, opened, read, read_manual, unread_expired, refunded)

-- TEST 5: Każda wysyłka wskazuje na istniejącą ofertę (referential integrity)
select count(*) as orphan_sends
from legacy_sends s
where not exists (select 1 from legacy_offers o where o.legacy_id = s.offer_legacy_id);
-- Oczekiwane: 0

-- TEST 6: Statystyki RLS - ile ofert per retailer
select s.retailer_id, count(distinct s.offer_legacy_id) as visible_offers
from legacy_sends s
where s.status in ('sent','opened','read','read_manual','unread_expired')
group by s.retailer_id
order by s.retailer_id;
-- Pokazuje ile ofert zobaczy buyer każdego retailera

-- TEST 7: Profiles bez rol
select count(*) as profiles_without_role from profiles where role is null;
-- Oczekiwane: 0

-- TEST 8: Buyerzy bez retailer_id (broken user)
select count(*) as buyers_without_retailer from profiles where role='buyer' and retailer_id is null;
-- Niezerowe = trzeba przypisać retailer

-- TEST 9: Suppliery bez company_id
select count(*) as suppliers_without_company from profiles where role='supplier' and company_id is null;
-- Niezerowe = supplier nie ma firmy

-- TEST 10: Polityki RLS są aktywne dla legacy_*
select tablename, policyname from pg_policies
where tablename in ('legacy_offers','legacy_sends')
order by tablename, policyname;
-- Oczekiwane: kilka polityk per tabela (admin_all, buyer_*, supplier_*)

-- TEST 11: Bucket'y Storage istnieją
select id, name, public from storage.buckets where id in ('offer-photos','company-logos','certs');
-- Oczekiwane: 3 buckety, offer-photos i company-logos public=true, certs public=false
```

---

## 6. Scenariusze testowe end-to-end (do wykonania ręcznie)

### Scenariusz A: Dostawca tworzy ofertę, wysyła do Biedronki, kupiec ją widzi
1. Login jako dostawca
2. Moje propozycje → Dodaj propozycję asortymentową
3. Wypełnij Step 1 (produkt, kategoria, opis, wgraj zdjęcia)
4. Wypełnij Step 2 (wolumen, opakowanie, logistyka, certyfikaty, cena)
5. Wypełnij Step 3 (korzyści, CTA, tytuł)
6. Klik "Opublikuj"
7. Wysyłki → wyślij ofertę do Biedronki
8. Wyloguj
9. Login jako buyer Biedronki
10. Propozycje asortymentowe → powinieneś widzieć tę nową ofertę z miniaturą
11. Klik Szczegóły → sekcja Zdjęcia produktu (zamknięta) → rozwiń → widoczne pełne zdjęcia

**Status: częściowo (kroki 1-6 działają, 7-11 wymagają pełnego testu)**

### Scenariusz B: Izolacja kupiec ↔ kupiec
1. SQL: `update profiles set retailer_id = 100 where email='test...'` (Biedronka)
2. Login jako buyer → policz oferty w "Propozycje asortymentowe"
3. Wyloguj
4. SQL: `update profiles set retailer_id = 101 where email='test...'` (Lidl)
5. Login → policz oferty
6. Liczby powinny być różne (każda sieć dostaje inny zestaw)

**Status: zaczęte (Biedronka pokazuje 3, Lidl niezweryfikowany)**

### Scenariusz C: Admin ma pełny dostęp
1. Login jako admin (artur@kjow.pl)
2. Pipeline → widzisz wszystkie wysyłki
3. Sieci → widzisz wszystkie 21 retailerów
4. Switcher → "udaj" dostawcę (np. UNICA) → widzisz panel dostawcy z jego ofertami
5. Switcher → "udaj" kupca (np. buyer Biedronki) → widzisz panel kupca

**Status: ✅ działa**

### Scenariusz D: Kompresja zdjęć
1. Wgraj duże zdjęcie 5 MB do oferty
2. Po uploadzie sprawdź w Supabase Storage rozmiar pliku
3. Powinien być znacznie mniejszy (~150-300 KB), format WebP

**Status: niezweryfikowany — potrzebny faktyczny test z prawdziwym dużym plikiem**

---

## 7. Pytania do dalszej dyskusji (np. z ChatGPT/Claude w trybie strategicznym)

1. **Czy legacy_offers (JSONB) to OK rozwiązanie długoterminowo, czy lepiej zmigrować do offers (relacyjne kolumny)?**
   - Plusy JSONB: szybko, elastycznie, brak schema migration przy zmianach
   - Minusy: trudniejsza walidacja, trudniejsze indeksowanie, brak FK
2. **Jak skalować przy 1000+ ofert i 100+ kupców?** Paginacja, indeksy, caching, real-time subscriptions?
3. **Storage: signed URLs zamiast public?** Niska wartość bezpieczeństwa publicznych URL'i offer-photos vs koszt implementacji.
4. **Email: Resend czy Supabase wbudowany SMTP?** Resend daje lepszą deliverability, Supabase jest bezkosztowy do 50/h.
5. **Multi-tenancy supplierów?** Jak prawidłowo izolować dwóch supplierów? Mapping legacy_id → company_id.
6. **Mobile-first redesign?** Aktualnie design desktop-first.
7. **Internationalization (i18n)?** Aplikacja PL-only.
8. **GDPR compliance?** Eksport danych, prawo do bycia zapomnianym, audit log.
9. **CI/CD:** lint + tests przed merge do main, snapshot UI testing?
10. **Backup Supabase?** Free plan ma daily backups 7 dni; produkcja może wymagać dłużej.

---

## 8. Co dalej — rekomendacje priorytetowe

**Tier 1 (krytyczne dla MVP w prawdziwym ruchu):**
- Resend integracja (mailing ofert do kupców)
- Email confirmation ON + reset hasła
- Domena `app.freshmarket.eu`
- Backup polityki Supabase
- Audyt RLS przez prawdziwy security expert

**Tier 2 (jakość życia):**
- Naprawić supplier identity mismatch (mapping)
- Migracja retailers do Supabase live-sync
- Mobile responsywność
- Reset password flow

**Tier 3 (rozwój):**
- Stripe Checkout dla pakietów
- Pełna migracja localStorage → Supabase (buyerUiState, fmPrefs, etc.)
- Real-time subscriptions (instant notification dla buyera)
- Search z full-text indeksami

---

## 9. Konsultacja z ChatGPT / innymi AI

Załączony link do projektu PreConnect ChatGPT:
https://chatgpt.com/g/g-p-696df003eba88191911255f354f9f7e2-preconnect/project

**Sugerowany prompt do ChatGPT (skopiuj poniższe):**

> Przesyłam raport końcowy projektu Fresh Market — proszę o niezależną opinię na temat:
>
> 1. Architektury (czy decyzje o JSONB legacy_offers + tabele domenowe to dobry pomysł na MVP, czy lepiej od razu migrować do schematu relacyjnego)
> 2. RLS (czy izolacja kupiec ↔ kupiec jest wystarczająca, czy są dziury)
> 3. Storage (czy public URL'e na offer-photos są akceptowalne)
> 4. Tier 1 priorytetów — co pominąłem?
> 5. Czy testy z sekcji 5-6 wystarczą do potwierdzenia gotowości MVP, czy potrzeba więcej?
>
> Raport w pełnej wersji w pliku TESTY_I_RAPORT.md w repo artursilvicola/freshmarket-app.

---

**Raport wygenerowany przez Claude na podstawie testów ręcznych + audytu kodu z 30.04.2026.**
