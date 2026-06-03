# Plan wdrożenia — „Kredyty PreConnect" zamiast EUR w panelu dostawcy

**Branch:** `docs/preconnect-credits-billing-plan`
**Status:** PLAN ONLY. Bazuje na `PRECONNECT_CREDITS_AUDIT.md`.
**Zasada:** 1 Kredyt PreConnect = 1 wysyłka propozycji do 1 sieci handlowej. Pieniądze zostają tylko przy zakupie pakietu / fakturze / PayU.

---

## 0. Odpowiedzi na kluczowe pytania (najpierw — bo decydują o zakresie)

### Q1. Czy da się zrobić Etap 2 (UI) bez migracji DB?
**TAK.** DB już trzyma kredyty: `packages.qty_total` / `qty_used`, view `company_capacity.qty_remaining`. EUR jest tylko prezentacją (`chargeAmount = price_paid/qty_total`) i zapisem zakupu (`payu_orders.price_eur`). Etap 2 = zamiana copy + pokazanie `qty_remaining` zamiast `wallet.balance`. **Zero zmian struktury DB, zero PayU, zero RLS.**

### Q2. Gdzie są największe ryzyka?
1. **R1 (najważniejsze): „zwrot kredytu" vs realny model.** Kredyt (`qty_used`) konsumuje się **dopiero przy odczycie przez kupca** (`chargeFirstSeen`). Jeśli kupiec nie odczyta w 14 dni → kredyt **nigdy nie został zużyty** → nie ma „zwrotu", bo nic nie pobrano. Obecny refund RPC (+EUR w `wallet_tx`) dotyczy edge-case'u „charged ale potem expired". **Wymaga decyzji produktowej (patrz Q5).**
2. **R2: niespójność copy** — Dashboard mówi „kredyty", Finanse/Wysyłki „EUR".
3. **R3: „saldo portfela EUR"** traci sens dla dostawcy po przejściu na kredyty (zostaje tylko historia faktur).

### Q3. Co dokładnie zobaczy DOSTAWCA po zmianie?
- **Zamiast** „Saldo portfela: 240 EUR" → **„Kredyty PreConnect: 12 dostępnych"** (`qty_remaining`).
- **Zamiast** „Środki na X wysyłek — 50 EUR/szt." → **„1 kredyt = 1 wysyłka do jednej sieci"**.
- **Zamiast** „Koszt: 40 EUR · 1 wysyłka z pakietu" → **„Zużywa 1 kredyt"**.
- **Zamiast** „Zwrot +40 EUR" → **„Zwrot: +1 kredyt"** (po decyzji Q5).
- **Zamiast** „Zwrot w toku" → **„Kredyt wraca do konta"**.
- **„Efektywny koszt"** → **usunięte z panelu dostawcy** (przeniesione do admin/księgowość).
- Status pakietu: **„12 / 20 kredytów"** (`qty_remaining / qty_total`) — spójnie wszędzie (Dashboard już tak robi).
- **Cena pakietu w EUR** → **zostaje TYLKO** w zakładce „Pakiety" → modal zakupu / PayU / faktura.

### Q4. Co dokładnie zobaczy ADMIN po zmianie?
Admin ma **dwa rozdzielone widoki** (Etap 3):
- **Kredyty operacyjne** — ile dostawca ma/zużył (`qty_total`/`qty_used`/`qty_remaining`) w Firmach i Pipeline. To jest „operacja".
- **Pieniądze / faktury / PayU** — kwoty zakupu pakietu (`payu_orders.price_eur`), rozliczenia EUR w Pipeline settlement. To jest „księgowość".
- Jasne nazewnictwo: sekcja „Kredyty" vs sekcja „Rozliczenia / przychód (EUR)". Admin NIE traci widoku kwot — tylko są wyraźnie oddzielone od kredytów.

### Q5. Jak liczyć zwrot: +1 kredyt czy częściowy zwrot?
**Rekomendacja: +1 kredyt (pełny), model „kredyt wraca".**

Uzasadnienie i mapowanie na realny model (R1):
- Kredyt zużywa się **przy odczycie** kupca (`qty_used += 1` w `chargeFirstSeen`).
- **Wariant A (rekomendowany) — „kredyt rezerwowany przy wysyłce, zwalniany przy braku odczytu":**
  prezentacyjnie: po wysyłce kredyt jest „w użyciu / czeka na odczyt"; jeśli odczyt → „wykorzystany"; jeśli 14 dni bez odczytu → „wraca do dostępnych" (+1).
  Realnie dziś: `qty_used` rośnie dopiero przy odczycie, więc „brak odczytu" = kredyt **nigdy nie pobrany** = de facto już dostępny. Czyli **prezentacja „+1 kredyt wraca" jest spójna z danymi** bez zmiany backendu — bo niezużyty kredyt po prostu pozostaje w `qty_remaining`.
  → **Etap 2 może pokazać to bez migracji**: „rezerwacja" jest wizualna (sent = w użyciu), a `qty_remaining` i tak nie spadło.
- **Częściowy zwrot — ODRZUCony.** Kredyt jest jednostką niepodzielną (1 wysyłka). Częściowy zwrot wprowadza ułamki kredytów = komplikacja bez wartości.
- **Decyzja do potwierdzenia przez Artura:** czy edge-case „charged potem expired" (gdzie refund RPC daje +EUR) ma też zwracać +1 kredyt (`qty_used -= 1`)? Jeśli tak → **Etap 5 (mała zmiana RPC, backend, nie struktura)**. Jeśli nie → zostaje jak jest (refund EUR tylko w historii admina).

---

## 1. Etapowanie

### Etap 1 — Audit + plan (TEN BRANCH, docs-only) ✅
- `docs/billing/PRECONNECT_CREDITS_AUDIT.md` + `PRECONNECT_CREDITS_PLAN.md`.
- Mapa miejsc EUR/wallet, ryzyka, rekomendacja bez/z migracją.
- **Deliverable gotowy.**

### Etap 2 — UI copy / display-only (osobny branch kodowy)
- Branch: `feat/credits-ui-supplier` (flaga `CREDITS_UI_SUPPLIER` default false — bezpieczny rollback).
- Zakres:
  - Dostawca Finanse/Wysyłki/Dashboard: pokazać `qty_remaining` / `qty_total` zamiast `wallet.balance`.
  - Copy EUR → kredyty (nowe klucze i18n PL+EN, symetryczne).
  - Ukryć „efektywny koszt" + „perSend EUR" z panelu dostawcy.
  - „Zwrot +X EUR" → „Zwrot: +1 kredyt"; „Zwrot w toku" → „Kredyt wraca do konta".
  - Cena pakietu EUR zostaje TYLKO w zakładce Pakiety / modal zakupu / PayU.
- **Bez:** PayU, DB, RLS, statusów, algorytmów, struktur. Tylko prezentacja.
- Weryfikacja: build + PL/EN symetria + smoke (dostawca widzi kredyty, zakup nadal pokazuje EUR).

### Etap 3 — Admin clarity (osobny branch)
- Admin widzi **kredyty operacyjne** (qty) oddzielnie od **pieniędzy** (PayU/faktury/settlement EUR).
- Pipeline settlement i Firmy: jasne sekcje „Kredyty" vs „Rozliczenia (EUR)".
- Bez zmian danych — tylko grupowanie/copy.

### Etap 4 — Regulamin
- Definicja „Kredytu PreConnect": jednostka usługi, **nie pieniądz**, nie podlega wypłacie.
- Zasady zwrotu: brak odczytu w 14 dni → kredyt wraca do dostępnych (zgodnie z Q5).
- Dokument prawny (poza kodem) — do akceptacji przez Artura.

### Etap 5 — Opcjonalna migracja DB
- **Tylko jeśli** decyzja Q5 wymaga realnego `qty_used -= 1` przy refundzie edge-case'u.
- Osobny branch SQL, sandbox dry-run, zero zmian produkcyjnych bez review.
- Albo kosmetyka `wallet_tx` (usunięcie send_charge amount=0) — niekonieczne.

---

## 2. Mapa zmian copy (Etap 2) — referencja

| Obecnie (EUR) | Po zmianie (Kredyty) | Gdzie (linia) |
|---|---|---|
| „Saldo portfela: {X} EUR" | „Kredyty PreConnect: {qty_remaining} dostępnych" | Finanse 6196, Wysyłki 4467, topbar 3484 |
| „Środki na X wysyłek — 50 EUR/szt." | „1 kredyt = 1 wysyłka do jednej sieci" | Finanse 6198 |
| „Koszt: 40 EUR · 1 wysyłka z pakietu" | „Zużywa 1 kredyt" | Wysyłki 4577, 4676 |
| „Zwrot +40 EUR" | „Zwrot: +1 kredyt" | Wysyłki 4635, Finanse refunds |
| „Zwrot w toku" | „Kredyt wraca do konta" | Finanse 6254–6273, Dashboard 3970 |
| „Efektywny koszt {X} EUR" | (usunąć z panelu dostawcy) | Finanse 6218 |
| „Cena pakietu / per send EUR" | (zostaje przy zakupie/PayU) | Pakiety 6324, modal 6407–6416 |
| „{remaining}/{max} kredytów" | (już OK — wzorzec do reszty) | Dashboard 4033 |

---

## 3. Guardraile (dla branchy kodowych Etap 2+)

Bez: zmian PayU, faktur, RLS, algorytmów wysyłki, statusów `legacy_sends`, automatycznego przeliczania danych historycznych bez osobnej decyzji. Etap 2 = wyłącznie warstwa prezentacji (UI + i18n), za flagą, z rollbackiem.

---

## 4. Rekomendacja końcowa

1. **Zatwierdzić Q5** (zwrot = +1 kredyt, pełny; częściowy odrzucony) — to odblokowuje copy w Etapie 2.
2. **Etap 2 bez migracji** — najszybsza wartość, najmniejsze ryzyko. Dostawca dostaje prosty model „mam 12 kredytów, 1 wysyłka = 1 kredyt".
3. **Migrację (Etap 5) odłożyć** — uruchomić tylko jeśli edge-case refund-as-credit okaże się potrzebny biznesowo.
4. Każdy etap kodowy = osobny branch, flaga, review, smoke. Bez wielkiego refactoru naraz.
