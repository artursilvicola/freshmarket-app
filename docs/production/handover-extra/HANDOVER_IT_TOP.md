# Fresh Market B2B — TOP do przekazania informatykowi

> **Domena:** https://b2b.freshmarket.eu · **Właściciel:** Fresh Market / KJOW Sp. z o.o.
> **Cel dokumentu:** jednostronicowe „wszystko, co najważniejsze" dla informatyka przejmującego projekt.
> **Pełny handover (architektura, flagi, procesy, testy, legal, DevOps, ryzyka):**
> [`docs/production/PRODUCTION_HANDOVER.md`](./PRODUCTION_HANDOVER.md) — ten plik jest jego skrótem + uzupełnieniem o moduł FM 2026 i znane problemy.

---

## 1. TL;DR — co i gdzie

- **Co to jest:** platforma B2B PreConnect — dostawcy (owoce/warzywa/kwiaty) wysyłają propozycje do kupców sieci handlowych w modelu kredytowym (1 kredyt = 1 wysyłka do 1 sieci). Plus osobny moduł **Fresh Market 2026** (umawianie spotkań na evencie 24.09.2026).
- **Stack:** React + Vite (front) · Netlify Functions (backend, ESM) · Supabase (Postgres + RLS + Auth) · Resend (maile) · PayU + proforma (płatności) · OpenAI (moderacja/opisy AI).
- **Repo:** GitHub `artursilvicola/freshmarket-app`. Push do `main` → **Netlify auto-deploy**.
- **Główny kod:** `src/legacy/PreconnectFM.jsx` (monolit ~14k linii) · `src/lib/db.js` (warstwa danych) · `src/auth/AuthProvider.jsx` (sesja/role) · `src/config/features.js` (feature flagi).

---

## 2. Złote zasady operacyjne (czytaj zanim cokolwiek zmienisz)

1. **Migracje Supabase NIE jadą z gita.** Pliki `supabase/migrations/001…044.sql` aplikuje się **RĘCZNIE** w Supabase SQL Editor po deployu, w kolejności. Weryfikacja: `SELECT` na nowej kolumnie/funkcji → brak błędu = zaaplikowane.
2. **`SUPABASE_SERVICE_ROLE_KEY` tylko w Netlify Functions** — nigdy we froncie.
3. **Feature flagi flipuje się za smoke testem** (wzorzec: branch `chore/flip-…` → build → push → merge po teście). Niektóre flagi **wysyłają realne maile** (`CREDIT_EXPIRY_REMINDER`, `ACCOUNT_LIFECYCLE`) — najpierw DRY-RUN.
4. **Backup przed każdą operacją destrukcyjną** (Supabase → Database → Backups / PITR).
5. **`ACCOUNT_HARD_DELETE` zostaje OFF** — nie włączać bez sandboxu + decyzji prawnej + sign-offu + backupu.

---

## 3. Krytyczne zmienne środowiskowe (Netlify → Environment)

| Zmienna | Uwaga |
|---|---|
| `SUPABASE_URL` / `VITE_SUPABASE_URL`, `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | front + functions |
| **`SUPABASE_SERVICE_ROLE_KEY`** | **tylko functions** |
| `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET` | maile + webhook odczytów |
| `PAYU_ENV` (`sandbox`/`production`; `prod` też zadziała), `PAYU_POS_ID`, `PAYU_SECOND_KEY`, `PAYU_OAUTH_CLIENT_ID`, `PAYU_OAUTH_CLIENT_SECRET`, `PAYU_CURRENCY_CODE`, opcj. `PAYU_VAT_RATE`, opcj. `PAYU_EUR_TO_PAYU_RATE` | **na prod najlepiej `production` + POS w EUR (`PAYU_CURRENCY_CODE=EUR`)** |
| **`PROFORMA_SELLER_NIP`**, **`PROFORMA_BANK_IBAN`** | **DOMYŚLNIE PLACEHOLDERY — USTAWIĆ przed poleganiem na przelewach** |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI (domyślnie `gpt-4.1-mini`) |

Status env sprawdzisz funkcją `netlify/functions/admin-env-status.js`.

---

## 4. Stan prawny (na dziś)

- `src/lib/legal-versions.js`: **`TERMS_VERSION = "2.0"`**, `PRIVACY_VERSION = "1.0"`.
- `public/regulamin.html` (PL) i `public/regulations.html` (EN) = **Wersja 2.0** (ogłoszona **9.06.2026**, obowiązuje od **23.06.2026**). EN nadal oznaczony jako **draft do review prawnika**.
- Regulamin 2.0 dodaje **§16** (archiwizacja/anonimizacja/usuwanie kont po 24 mc nieaktywności + ostrzeżenia 30/7 dni) — to podstawa prawna dla flagi `ACCOUNT_LIFECYCLE`.
- 🔴 **Otwarte:** brak ekranu **wymuszonej re-akceptacji** dla istniejących userów przy zmianie major — decyzja operatora/prawnika.

---

## 5. MODUŁ FRESH MARKET 2026 — pełna logika umawiania spotkań

> Tego nie ma w pełnym handoverze. Cały moduł żyje w `src/legacy/PreconnectFM.jsx` + funkcje FM w `src/lib/db.js`.
> **Moduł nie ma feature flagi** — steruje nim faza zapisana w tabeli `fm_settings` (pole `algo_phase`), ustawiana **ręcznie przez admina**.

### 5.1. Fazy i daty
Stała `FM_PHASES` (`PreconnectFM.jsx:1130`) + `fm_settings` (`db.js:984-1056`):

| Faza | Etykieta | Daty (etykiety UI) | Co się dzieje | `algo_phase` |
|---|---|---|---|---|
| 1 | Rejestracja | wrzesień 2026 | Sieci potwierdzają udział | `closed` |
| 2 | Preferencje | **1–16 września** | Dostawcy wybierają sieci (⭐/👍), kupcy odpowiadają (want/chance/remove) | `preferences_open` |
| 3 | Algorytm + Korekty | **17–21 września** | Admin uruchamia algorytm + ręczne korekty | `matching` |
| 4 | Publikacja i event | **finalna lista 22 wrz · event 24 wrz** | Publikacja planu z numerami; dzień spotkań | `published` / `event_day` |

- Stałe: `event_date = 2026-09-24`, lokalizacja `MCC Mazurkas, Ożarów Mazowiecki`, `open_date = 2026-09-01` (przed tą datą dostawca widzi ekran blokady).
- ⚠️ **Daty to tylko etykiety.** System **nie przełącza faz automatycznie po dacie** — robi to admin polem `algo_phase`.

### 5.2. Wybór sieci przez DOSTAWCĘ (faza 2)
`PageSupplierFM`, funkcja `toggle` (`PreconnectFM.jsx:13275`). Edytowalne tylko w fazie 2.
- ⭐ „star" = sieć główna, **limit 5 (miękki)** — po 5 gwiazdkach kolejna automatycznie staje się rezerwową.
- 👍 „thumb" = rezerwowa, **bez limitu**.
- „Gotowy" = ≥ 5 gwiazdek → przycisk **Potwierdź wybór** (`fm_selection_confirmed_at`).
- Zapis: `fm_prefs` (priorytet 1000 = star, 100 = thumb) + `company_target_retailers`.

### 5.3. Odpowiedź SIECI/KUPCA (faza 2)
`PageBuyerFM`, `setResp` (`PreconnectFM.jsx:13568`) → zapis `fm_resps` (kolumna `zone` trzyma wartość wprost):
`want` (chcę), `chance` (daję szansę), `remove` (nie chcę). Brak odpowiedzi = brak spotkania.

### 5.4. Algorytm dopasowania — `buildFMData` (`PreconnectFM.jsx:14003`)
Liczy się **na żywo** (useMemo) z `fm_prefs` × `fm_resps`. 6 faz:

1. **Zasada 0 — twarde wykluczenia (przed scoringiem):**
   - per dostawca (`isSupplierEligible`): pakiet **Standard** lub `fmB2bEnabled === false` → out;
   - per para (`isPairExcluded`): sieć dała `remove`/`rejected` albo dostawca wykluczył sieć.
2. **Scoring kategorii A–F (`scoreMatch`, `FM_SCORE`):**

   | Kat. | Dostawca | Sieć | Pkt |
   |---|---|---|---|
   | A | ⭐ | want | 6000 |
   | B | 👍 | want | 5000 |
   | D | ⭐ | chance | 4000 |
   | E | 👍 | chance | 3000 |
   | C | (nie wybrał) | want | 2000 |
   | F | (nie wybrał) | chance | 1000 |

   → mutual zawsze bije jednostronne; ⭐ bije 👍.
3. **Sortowanie globalne:** score ↓ → **`paymentDate` ↑ (kto wcześniej zapłacił)** → pakiet (Premium < Business) → indeks → id.
4. **Przydział spotkań:** multi-pass round-robin do **`FM_MAX_M = 5`** spotkań/dostawca; max **`FM_MAX_S = 60`** slotów/sieć.
5. **Numerowanie:** najniższy wolny numer w sieci z odstępem **`FM_MIN_GAP = 2`** między spotkaniami tej samej firmy. Wyższy score → niższy numer.
6. **Ostrzeżenia dla admina:** `no_meetings` (opłacona firma bez spotkań), `swap_star_thumb` (sieć główna w czerwonej strefie, rezerwowa w zielonej).

**Strefy numerów (orientacyjna kolejność):** 🟢 ≤ 25 · 🟠 ≤ 35 · 🔴 > 35 (`FM_ZONE_GREEN_MAX` / `FM_ZONE_ORANGE_MAX`).

### 5.5. Uruchomienie / publikacja (admin)
- Bramka uruchomienia: faza 2 **i ≥ 50% dostawców** ma komplet 5 gwiazdek.
- `runAlgorithm` (`PreconnectFM.jsx:14554`) **sam nie liczy** — tylko przełącza fazę na 3 (plan i tak liczy się na żywo).
- Plan zapisuje się dopiero przy **`approveAndPublish`** → `fm_settings.schedule` (`db.js:1474`). Zapisany plan wygrywa nad świeżym wyliczeniem (`pickFMPlan`).

### 5.6. Dzień eventu
Numery = pozycja w kolejce danej sieci, **nie godzina** (tryb kolejkowy, brak gwarancji godziny i minimalnej liczby spotkań). Strefa kolorów = orientacyjna szansa realizacji.

### 5.7. Dodatkowo
- **Spóźnione odpowiedzi:** `fm_late_resps` + flaga per sieć `lateSelectionEnabled` (admin wpuszcza sieć po terminie). Lista życzeń kupca: `fm_wishlists`.
- **Gating sieci:** `fm26Active = true` + `fm26ChainId` (np. „ch20") + ≥1 kupiec z `fm26Active`.

### 5.8. Stałe FM (zebrane, `PreconnectFM.jsx:1136-1174`)
`FM_MAX_M=5` · `FM_MAX_S=60` · `FM_MIN_GAP=2` · `FM_ZONE_GREEN_MAX=25` · `FM_ZONE_ORANGE_MAX=35` · `FM_EXCLUDED_PACKAGES={Standard}` · próg uruchomienia = 50% dostawców.

---

## 6. Znane problemy / do naprawy

### 6.1. 🐞 „Nieprawidłowy token" przy zapisie kupca/sieci w panelu admina
- **Objaw:** edycja kupca (np. zmiana e-maila) → „Zapisz zmiany" → czerwony komunikat **„Nieprawidłowy token"**.
- **Przyczyna:** to NIE problem pola e-mail. Backend odrzuca **wygasły/nieważny token JWT** admina na bramce autoryzacji: `netlify/functions/admin-update-user.js:58` (`supaUser.auth.getUser(token)`). Front wysyła token z `getSession()` (`src/lib/db.js:516`); gdy karta wisi długo w tle, auto-refresh tokena nie zadziała i `getSession()` oddaje stary token.
- **Obejście dla usera:** odśwież stronę (Ctrl+R) lub wyloguj/zaloguj i ponów zapis.
- **Rekomendowana naprawa (kod):** w warstwie admina zamiast samego `getSession()` zrobić proaktywny `supabase.auth.refreshSession()` + **auto-retry raz** po 401 `invalid_token` + czytelniejszy komunikat („Sesja wygasła — zaloguj się ponownie"). Dotyczy też `admin-create-user`, `admin-reset-password`, mailingów (ten sam wzorzec).

### 6.2. Rozbieżności w module FM (do decyzji produktowej)
- **Pakiet uprawniający:** regulamin **§7.1 mówi „tylko Premium"**, a kod wyklucza z matchmakingu **tylko Standard** (`FM_EXCLUDED_PACKAGES`) → realnie wpuszcza **Business + Premium**. Niespójność regulamin vs kod — ustalić, która wersja obowiązuje.
- **Daty faz:** regulamin §7.2 = korekty „17–22 wrz", kod `FM_PHASES` = „17–21 wrz". Drobny rozjazd.
- **Daty nieegzekwowane:** przełączanie faz jest ręczne — jeśli admin nie kliknie, faza nie zmieni się sama (patrz 5.1).
- **Dwa pojęcia „pakietu":** dane FM (`Premium/Business/Standard`) vs pakiety kredytów PreConnect (`prem_10/std_10`). Algorytm czyta `supplier.pkg` — pilnować, by do matchmakingu trafiało właściwe pole.

---

## 7. Czego NIE robić (skrót z pełnego handoveru, sekcja I)
- 🛑 Nie włączać `ACCOUNT_HARD_DELETE`.
- 🛑 Nie usuwać firm z historią finansową (Unica/Pik/OKSALE) bez osobnej decyzji.
- 🛑 Nie flipować flag bez smoke testu; flagi mailowe — najpierw DRY-RUN.
- 🛑 Nie odpalać destrukcyjnych SQL bez backupu + dry-run.
- 🛑 Nie trzymać service role key we froncie.
- 🛑 Nie publikować EN legal jako final bez review prawnika.

---

## 8. Gdzie szukać dalej
| Temat | Lokalizacja |
|---|---|
| Pełny handover (architektura/flagi/procesy/testy/legal/DevOps/ryzyka) | [`docs/production/PRODUCTION_HANDOVER.md`](./PRODUCTION_HANDOVER.md) |
| Checklista dostępów IT | [`docs/production/IT_HANDOVER_ACCESS_CHECKLIST.md`](./IT_HANDOVER_ACCESS_CHECKLIST.md) |
| Feature flagi | `src/config/features.js` |
| Moduł FM 2026 | `src/legacy/PreconnectFM.jsx` (szukaj `FM_PHASES`, `buildFMData`, `FM_SCORE`) + FM-funkcje w `src/lib/db.js` |
| Migracje DB | `supabase/migrations/001…044.sql` (ręcznie) |
| Funkcje backendowe | `netlify/functions/*.js` |
| Legal | `src/lib/legal-versions.js`, `public/regulamin.html`, `docs/legal/` |
