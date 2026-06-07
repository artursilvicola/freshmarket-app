# Lany fixes — checklista wdrożeniowa + ryzyka prawne

> **Status: dokument. Zero merge, zero migracji Supabase, zero flipów flag, zero
> anonimizacji/hard-delete.** Ten plik to warunki publikacji i bezpieczna kolejność wdrożenia.

> ✅ **WARIANT C zastosowany na branchu `feat/lany-fixes-release-no-legal-publish`.**
> Regulamin ODŁĄCZONY od merge'a kodu: `TERMS_VERSION = "1.0"`, `public/regulamin.html`
> i `regulations.html` cofnięte do **1.0** (bez §16, bez nagłówka 1.2). Merge tego brancha
> **NIE publikuje** regulaminu 1.2/§16 ani nie zmienia akceptowanej wersji. Pełna wersja
> 1.2 (z §16) żyje w `feat/lany-fixes-followups` — do osobnej publikacji po wdrożeniu
> flow re-akceptacji (`feat/terms-reacceptance`). Sekcje §1–§2 poniżej dotyczą tej
> PRZYSZŁEJ, osobnej publikacji — NIE tego release'u.

Branch `feat/lany-fixes-release-no-legal-publish` **zawiera całość techniczną** (integracja
6 branchy + follow-upy, bez publikacji regulaminu): jeden merge do main wnosi zmiany techniczne.

---

## 1. Publikacja regulaminu 1.2 — warunki (DECYZJA OPERATORA)

Regulamin podbity do **1.2** (HTML PL/EN + `REGULAMIN.md` + `TERMS_VERSION`).
Nowa **§16** (usuwanie nieaktywnych kont po 24 mc) to **zmiana materialna obowiązków**.

Do ustalenia przez Operatora **przed publikacją**:

- [ ] **Data wejścia w życie** §16 (obecnie w nagłówkach: „do ustalenia").
- [ ] **14-dniowe powiadomienie** istniejących Użytkowników (§15) — mailem, przed datą wejścia.
- [ ] **Numer wersji: 1.2 czy 2.0?** Wg konwencji w `src/lib/legal-versions.js` zmiana
      *obowiązków* = „major" (→ 2.0 + ponowna akceptacja). Ustawiono 1.2 wg wcześniejszej
      decyzji — Operator potwierdza lub zmienia na 2.0.
- [ ] **Przegląd prawny** §16 (anonimizacja vs retencja finansowa — ustawa o rachunkowości).

---

## 2. ⚠️ RYZYKO: TERMS_VERSION=1.2 bez flow re-akceptacji

**Stan faktyczny (zweryfikowany w kodzie):**

- `accepted_terms_version: TERMS_VERSION` zapisywane **tylko przy rejestracji**
  (`RegisterSupplierPage.jsx`, `db.js`). 
- **Brak** porównania `accepted_terms_version` istniejących userów z aktualnym
  `TERMS_VERSION`, **brak** bannera „zaakceptuj nowy regulamin", **brak** flow re-akceptacji.
  Komentarz w `legal-versions.js`: *„TODO: do zaimplementowania gdy będzie potrzebne"*.

**Konsekwencja po merge + deploy:**

- **Nowe rejestracje** → zapiszą `accepted_terms_version = "1.2"` (OK — widzą i akceptują 1.2).
- **Istniejący użytkownicy** → zostają ze starą zaakceptowaną wersją; **nie dostaną
  automatycznie** prośby o ponowną akceptację. Obowiązek §15 (powiadomienie/akceptacja
  zmiany) **nie jest realizowany przez aplikację** — musi być spełniony procesowo (mail).
- Publiczny `/regulamin` pokaże 1.2 z §16 **od razu po deployu** (nagłówek mówi „obowiązuje
  od: do ustalenia", co łagodzi, ale dokument jest publicznie widoczny jako bieżący).

**Opcje (DECYZJA OPERATORA):**

- **A — Publikuj 1.2 teraz, powiadom procesowo.** Merge + deploy; Operator ręcznie wysyła
  14-dniowe powiadomienie do istniejących userów; in-app re-akceptacja jako przyszłe usprawnienie.
- **B — Najpierw flow re-akceptacji (rekomendowane gdy §16 ma formalnie wiązać istniejących).**
  Osobny branch: banner porównujący `accepted_terms_version` < `TERMS_VERSION` → wymuszenie
  ponownej akceptacji przy logowaniu + zapis nowej wersji. Publikacja §16 po jego wdrożeniu.
- **C — Odłącz regulamin od merge'a kodu.** Zmerguj kod (flagi OFF), ale **wycofaj bump
  regulaminu/TERMS_VERSION z produkcyjnego merge'a** do czasu gotowości procesu prawnego.

> **Propozycja osobnego przyszłego brancha** `feat/terms-reacceptance`: porównanie wersji
> przy logowaniu + banner + zapis akceptacji. Wymagany, jeśli Operator chce formalnie
> publikować §16 z wiązaniem istniejących Użytkowników.

---

## 3. Finalna checklista merge / release

> Każdy krok ręczny, w tej kolejności. Flagi flipować DOPIERO po migracji + env.

### 3.1 Merge
- [ ] Review `feat/lany-fixes-followups` (zawiera całość).
- [ ] Decyzja z §1/§2 powyżej (regulamin 1.2 — publikować teraz czy odłączyć).
- [ ] Merge `feat/lany-fixes-followups` → main (`--no-ff`).

### 3.2 Migracje Supabase (ręcznie, w kolejności)
- [ ] `040_proformas.sql` — proformy + numeracja (dla `BANK_TRANSFER_PROFORMA`).
- [ ] `041_packages_expiry_reminder.sql` — przypomnienia (dla `CREDIT_EXPIRY_REMINDER`).
- [ ] `042_account_inactivity.sql` — śledzenie + ostrzeżenia (dla `ACCOUNT_LIFECYCLE`).
- [ ] `043_proforma_payment_activation.sql` — admin oznacza opłaconą (dla `BANK_TRANSFER_PROFORMA`).
- [ ] Weryfikacja: kolumny/tabele/RPC istnieją (REST/SQL: fake kolumna → 42703, realna → OK).

### 3.3 Env Netlify
- [ ] `ACCOUNT_EMAIL_CONTACT_FIX=true` — kontakt w mailach → hello@ (item #3; bez tego newsletter@).
- [ ] `NIP_REQUIRED=true` — backend defense-in-depth (opcjonalne; frontend i tak blokuje).
- [ ] `PROFORMA_SELLER_NIP=1181976336` (NIP KJOW z regulaminu).
- [ ] `PROFORMA_BANK_IBAN=<realny IBAN>` (obecnie placeholder).
- [ ] (opcjonalnie) `PROFORMA_BANK_BENEFICIARY`, `PROFORMA_BANK_NAME`, `PROFORMA_SELLER_NAME`, `PROFORMA_SELLER_ADDRESS`.

### 3.4 Kolejność flipowania flag (po migracji + env + smoke każdej)
| Flaga | Wymaga | Zakres |
|---|---|---|
| `NIP_REQUIRED` | — (env opcjonalny) | NIP obowiązkowy: rejestracja/profil/zakup |
| `CREDITS_VALIDITY_UI` | — | ważność 12 mc + realna historia + status „wygasłe" |
| `BANK_TRANSFER_PROFORMA` | migr. 040+043, env proforma | proforma przelew + admin oznacza opłaconą |
| `CREDIT_EXPIRY_REMINDER` | migr. 041 | mail 14 dni przed wygaśnięciem |
| `ACCOUNT_LIFECYCLE` | migr. 042 | śledzenie + ostrzeżenia 30/7 dni (BEZ usuwania) |
| `ACCOUNT_HARD_DELETE` | **NIE flipować** | placeholder destrukcyjny — zostaje `false` |

### 3.5 Smoke testy (po flipie odpowiedniej flagi)
- [ ] **NIP** — rejestracja/zapis profilu/zakup bez NIP zablokowane z komunikatem; z NIP przechodzą.
- [ ] **Ważność kredytów** — „ważne 12 mc" przed zakupem; „ważne do: DD.MM.RRRR" po zakupie + na karcie pakietu.
- [ ] **Historia wygasłych** — karta „Historia pakietów kredytów" pokazuje status Aktywny/Wygasłe; wygasłe nie liczone jako dostępne.
- [ ] **Proforma (dostawca)** — wybór „przelew" → „Generuj proformę" → pobranie + mail + wpis w historii.
- [ ] **Proforma (admin)** — „Oznacz opłaconą → aktywuj pakiet"; pakiet aktywny; **drugie kliknięcie NIE dubluje** pakietu.
- [ ] **Mail kontakt** — mail o zmianie konta pokazuje hello@ (po env).
- [ ] **Przypomnienie 14 dni** — (sandbox/seed) pakiet 14 dni przed wygaśnięciem → 1 mail, drugi sweep → 0.
- [ ] **Inactivity warning** — (sandbox/seed) konto ~23/24 mc → mail 30/7 dni; aktywne konto nietknięte.

### 3.6 Rollback
- Każda funkcja za flagą → flip na `false` cofa natychmiast, bez utraty danych (zmiany addytywne).
- `ACCOUNT_EMAIL_CONTACT_FIX` → usuń env (wraca newsletter@).

---

## 4. Nie w tym wdrożeniu (osobne decyzje)
- **Destrukcyjna część #8** (archiwizacja-wykonanie, anonimizacja, hard-delete) — wg
  `docs/account-lifecycle/P3_DESTRUCTIVE_SANDBOX_PLAN.md`, dopiero po sign-offie sandbox.
  `ACCOUNT_HARD_DELETE` zostaje `false`.
- **Flow re-akceptacji regulaminu** — osobny branch (§2 opcja B), jeśli Operator chce
  formalnie wiązać istniejących Użytkowników §16.
- **Formalna publikacja regulaminu 1.2/2.0** — data + 14-dniowe powiadomienie (§1).
