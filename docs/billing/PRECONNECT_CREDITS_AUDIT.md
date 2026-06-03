# Audyt — migracja prezentacji „EUR / portfel" → „Kredyty PreConnect"

**Branch:** `docs/preconnect-credits-billing-plan`
**Status:** AUDIT ONLY. Zero zmian kodu/DB/danych. Numery linii względem `main` w momencie audytu.
**Metoda:** 3 równoległe deep-read audyty (frontend UI, backend functions, DB/migracje) przez Explore.

---

## 0. Najważniejszy wniosek (TL;DR)

**DB już jest „kredytowa". EUR żyje TYLKO w prezentacji UI i w zapisie zakupu/zwrotu.**

| Warstwa | Model | Gdzie |
|---|---|---|
| **DB — limit/wykorzystanie** | **Kredyty (liczba wysyłek)** | `packages.qty_total` / `qty_used`, view `company_capacity.qty_remaining` |
| **DB — płatność** | EUR | `payu_orders.price_eur`, `package_plans.price_eur`, `packages.price_paid` |
| **DB — saldo „portfela"** | wyliczane (NIE kolumna) | `SUM(wallet_tx.amount)` — brak kolumny `balance` |
| **UI** | EUR (do policzenia z kredytów) | `chargeAmount = price_paid / qty_total` |

→ **Etap 2 (UI copy/display-only) jest możliwy BEZ migracji DB.** Zmiana jest czysto prezentacyjna: pokazujemy `qty_remaining` (kredyty) zamiast `wallet.balance` (EUR).

---

## 1. Frontend — gdzie użytkownik widzi EUR/portfel (do zmiany w Etapie 2)

Plik: `src/legacy/PreconnectFM.jsx`. Kolumna „kto": D=dostawca, A=admin.

### Dostawca — Finanse (`PageFinance`, ~6165)
| Linia | Co widzi | i18n klucz | Kto |
|---|---|---|---|
| 6196–6197 | „Saldo portfela {balance} EUR" | `supplier.finance.wallet.balance_label` | D |
| 6198 | „Środki na X wysyłek" (`perSend` EUR) | `supplier.finance.wallet.funds_info_format` | D |
| 6218 | „Efektywny koszt" (totalEarned-refunds) | `supplier.finance.kpi.effective_cost_label/_value_format` | D |
| 6254–6273 | „Zwroty zrealizowane / w toku" (kwoty EUR) | `supplier.finance.refunds_done.*`, `supplier.finance.kpi.refunds_*` | D |
| 6275–6284 | Historia transakcji (kwoty EUR) | `supplier.finance.recent_tx.*` | D |
| 6288–6317 | Historia wysyłek — kolumna „Kwota" EUR | `supplier.finance.history.amount_eur_format` itd. | D |

### Dostawca — Wysyłki (`PageWysylki`, ~4395)
| Linia | Co widzi | i18n | Kto |
|---|---|---|---|
| 4467 | „Portfel: {balance} EUR" (pasek) | `supplier.wysylki.pkg_bar.wallet_balance_format` | D |
| 4577 | „Koszt: {cost} EUR · 1 wysyłka z pakietu" | `supplier.wysylki.new.cost_info_format` | D |
| 4676 | Modal: „1 wysyłka ({perSend} EUR)" | `supplier.wysylki.confirm_modal.cost_value_format` | D |
| 4635 | Badge wygasłej: „+{perSend}€" | (inline) | D |

### Dostawca — Dashboard (`PageDashboard`, ~3796)
| Linia | Co widzi | i18n | Kto |
|---|---|---|---|
| 4033–4061 | **JUŻ kredyty**: „{remaining}/{max} kredytów" (PkgCard) | `supplier.dashboard.pkg_card.credits_total_suffix` | D |
| 3970–3982 | „Zwroty" (kwota EUR) | `supplier.dashboard.refunds_strip.*` | D |
| 3484 | Top bar badge „{balance}€" | (inline, AccountSwitcherBar) | D |

> **Uwaga:** Dashboard PkgCard JUŻ używa słowa „kredyty" — czyli model jest częściowo wdrożony, tylko niespójnie z Finansami/Wysyłkami.

### Admin — Firmy (`PageAdminFirmy`, ~9415)
| Linia | Co widzi | Kto |
|---|---|---|
| 9481–9511 | Edytor pakietu: `pkg` + `max` (qty) | A |
| 9680–9689 | Lista: `pkg`, `max`, `used`, `pkgExpiry` z `dbCapacity` | A |

### Admin — Pipeline / rozliczenia (`PageAdminPipeline`, ~8467)
| Linia | Co widzi | i18n | Kto |
|---|---|---|---|
| 8790–8831 | „Rozliczone X / Czeka X" + sumy EUR | `admin.pipeline.settle_*` | A |
| 8814 | „{amount} EUR" per dostawca | (getChargeAmount) | A |
| 8856 | Tracking inline: kwota rozliczenia EUR | `admin.pipeline.track_settlement_inline_format` | A |

### Cennik / pakiety (`PRICING_PLANS`, ~590)
- Plany: `std_5/10/20/50`, `prem_1/5/10/20` — pola `{ id, tier, qty, price (EUR), perSend (EUR), discount }`.
- Cena zakupu pokazywana w `PageFinansePakiety` (~6324) + modal płatności (6407–6416) → **zostaje** (to PayU/faktura).

### Helpery EUR (logika, nie UI)
| Linia | Helper | Co |
|---|---|---|
| 898 | `getRefundAmount(send)` | `refundAmount ?? price ?? 0` |
| 928 | `getChargeAmount(send, fb)` | `chargeAmount ?? price ?? fb` |
| 896 | `hasRefundMarker` | refundAt/refundTxId/refundAmount |
| 904 | `hasChargeMarker` | chargeAt/chargeTxId/billingStatus==="charged" |
| 503 | `WALLET_INIT` | `{ balance: 0, transactions: [] }` |
| 2162 | `wallet` useMemo | `baseWallet + refundTotal` |

**Kupiec:** brak danych finansowych (zero EUR w panelu kupca). ✅

---

## 2. Backend — functions + db.js

### PayU (`create-payu-order.js`, `payu-notify.js`)
- Cena z `package_plans.price_eur` (migracja 023). Currency EUR (hardcoded).
- Po opłaceniu → RPC `purchase_package()`: **INSERT `packages`** z `qty_total = plan.qty` (liczba wysyłek!), `qty_used = 0`, `price_paid` (EUR), `payment_ref` (idempotency) + INSERT `wallet_tx` type `package_purchase` `amount = -price_eur` + UPDATE `companies.pkg_plan`.
- **PayU tworzy pakiet kredytów (qty), nie „topup EUR".**

### Charge — `_shared/legacy-send-seen.js` (`chargeFirstSeen`, ~43–119)
- Wołane z `mark-buyer-preconnect-seen.js` gdy **kupiec zobaczy** ofertę.
- Znajduje pierwszy pakiet z `qty_used < qty_total`, **`qty_used += 1`** (optimistic lock).
- INSERT `wallet_tx` type `send_charge` z **`amount = 0`** (!), `meta.amount_eur` = cena (do UI), `meta.billing_model = "package_credit"`.
- **Kredyt zużywa się dopiero przy odczycie przez kupca.** To jest istota modelu.

### Refund — RPC `refund_unread_expired_legacy_sends` (migracja 028, ~10–102)
- Dla sendów `unread_expired` z markerem charge i bez `refundAt`.
- Wylicza kwotę (fallback 40 EUR), INSERT `wallet_tx` type `refund` `amount = +kwota`, UPDATE `legacy_sends.data` (`refundAt`/`refundAmount`/`refundTxId`).
- **NIE zmniejsza `qty_used`** — patrz Ryzyko R1.

### Expire — RPC `expire_legacy_sends_14d` (migracja 013/014)
- `sent → unread_expired` po 14 dniach. Tylko status, bez refundu (refund to osobny RPC).

### Saldo „portfela"
- `db.js getWallet()` (~641): `balance = SUM(wallet_tx.amount)`. **Brak kolumny `balance`** — saldo to suma transakcji.

---

## 3. DB / migracje — struktura

| Element | Plik migracji | Co |
|---|---|---|
| `packages` (qty_total, qty_used, price_paid, currency, expires_at, payment_ref) | 001, 023 | **limit = qty_total (kredyty)**, cena = price_paid (EUR) |
| `company_capacity` (VIEW: qty_total, qty_used, qty_remaining, pkg_plan, pkg_expiry) | 023 (~178) | agregat — **czyste liczby wysyłek** |
| `package_plans` (price_eur, qty) | 023 | cennik |
| `payu_orders` (price_eur, currency, status, plan_id, package_id) | 024 | historia płatności EUR |
| `wallet_tx` (type, amount, currency, meta) | 001 | transakcje: package_purchase/send_charge(amount=0)/refund |
| refund/charge markery | 028 (data JSONB) | `refundAt`, `chargeAt`, `billingStatus` w `legacy_sends.data` |
| RPC `purchase_package` / `refund_unread_expired` / `expire_legacy_sends_14d` | 023 / 028 / 013-014 | operują na qty + wallet_tx |

**Potwierdzenie:** limit/wykorzystanie = `qty` (kredyty), EUR tylko przy zakupie (`payu_orders.price_eur`) i w `wallet_tx`. **Migracja prezentacji nie wymaga zmian struktury DB.**

---

## 4. Ryzyka

| ID | Ryzyko | Opis | Waga |
|---|---|---|---|
| **R1** | **Refund nie zwraca kredytu (`qty_used`)** | Produkt mówi „brak odczytu w 14 dni → kredyt wraca". Ale: kredyt (`qty_used`) konsumuje się TYLKO przy odczycie (`chargeFirstSeen`). Jeśli kupiec NIE odczyta → `qty_used` nigdy nie wzrósł → nie ma czego zwracać (kredyt nie był zużyty). Refund RPC dotyczy edge-case'u (charged ale potem expired) i daje +EUR w `wallet_tx`, nie +1 qty. **Trzeba zmapować intencję produktu na realny model.** | WYSOKA — wpływa na obietnicę „+1 kredyt" |
| **R2** | **Niespójność copy** | Dashboard PkgCard mówi „kredyty", a Finanse/Wysyłki mówią „EUR/portfel". Użytkownik widzi dwa różne języki. | ŚREDNIA |
| **R3** | **„Saldo portfela EUR" to artefakt** | `wallet.balance` (suma wallet_tx) miesza zakup (−EUR) z refundami (+EUR). Po przejściu na kredyty saldo EUR przestaje mieć sens dla dostawcy — zostaje tylko historia faktur/PayU. | ŚREDNIA |
| **R4** | **Efektywny koszt / perSend** | Liczby pochodne (price/qty) — po ukryciu EUR trzeba zdecydować czy znikają u dostawcy (rekomendacja: tak), czy zostają u admina. | NISKA |
| **R5** | **Regulamin** | „Kredyt" musi być zdefiniowany prawnie: nie pieniądz, nie podlega wypłacie, zasady zwrotu. Bez tego zmiana copy może wprowadzać w błąd. | ŚREDNIA (prawne) |

---

## 5. Rekomendacja: bez migracji czy z migracją?

**Etap 2 (UI copy/display-only) — BEZ migracji DB.** Dane już są kredytowe (`qty_remaining`). Wystarczy:
- pokazać `qty_remaining`/`qty_total` zamiast `wallet.balance`,
- zamienić copy EUR → kredyty (i18n),
- ukryć/przenieść „efektywny koszt" i „perSend EUR" z panelu dostawcy.

**Migracja DB (Etap 5) — OPCJONALNA, tylko jeśli:**
- decyzja R1 wymaga realnego „zwrotu kredytu" (`qty_used -= 1`) — wtedy zmiana RPC refund (backend, nie struktura),
- albo chcemy uprościć `wallet_tx` (usunąć EUR send_charge amount=0) — kosmetyka, nie konieczność.

Struktura tabel (`packages`/`company_capacity`) **nie wymaga zmian** dla prezentacji kredytowej.
