# Admin Pipeline 2.0 — UX + implementation plan

**Branch:** `feat/admin-pipeline-ux-plan`
**Status:** Docs-only. Zero kodu, zero migracji, zero ruszania logiki wysyłek.
**Bazuje na:** `docs/admin/ADMIN_PIPELINE_2_0_AUDIT.md` (Commit 1 tego brancha).
**Powiązanie:** spójny z Admin Companies 2.0 (reuse patternów). Implementacja kodowa zaczyna się **dopiero po stabilizacji Companies 2.0 Branch 2** (osobna decyzja Artura).

---

## 0. Cel + założenia

### 0.1 Cel produktowy

Przebudować `Admin → Pipeline` z **kolorowych kart 2-zakładkowych** na **operacyjne narzędzie CRM-owe** (tabela + filtry + koszyk + tracking + rozliczenia jako osobne strumienie). Cel: admin obsługuje 500+ propozycji bez tonięcia w kolorach i bez ryzyka duplikatów wysyłki.

### 0.2 Twarde ustalenie z auditu

✅ **Panel kupca i email SĄ rozdzielone w bazie** (`status` enum vs `data.emailSentAt` vs `resend_message_id`). Pipeline 2.0 **da się zrobić tylko UX-em, bez migracji**.

To zmienia ryzyko z `wysokie` (migracja produkcyjna) na `średnie` (tylko refactor UI + nowe filtry). Zachowujemy guardrails.

### 0.3 Hard guardrails (z briefa Artura + audit)

Te ograniczenia obowiązują przez **wszystkie 4-5 branchy** Pipeline 2.0:

- ❌ **Żadnych migracji SQL** (panel/email już rozdzielone w DB)
- ❌ **Żadnych zmian w `legacy_sends` enum lub kolumnach**
- ❌ **Żadnych zmian w `netlify/functions/send-retailer-batch.js`** (logika wysyłki Resend)
- ❌ **Żadnych zmian w template'ach maili** (`_shared/render-retailer-email.js`)
- ❌ **Żadnych zmian w `markLegacySendRead` / `expire_legacy_sends_14d` / `refund_unread_expired_legacy_sends`** (RPC)
- ❌ **Żadnych zmian RLS policies** (legacy_sends 010, mig 028 billing guard)
- ❌ **Żadnych nowych Netlify functions** (Resend webhook = osobny ticket)
- ❌ **Nie startujemy Pipeline 2.0 kodowo równolegle z Companies 2.0** — patrz §8.1

### 0.4 Założenia techniczne

- React + Vite, istniejący `PageAdminPipeline` w `src/legacy/PreconnectFM.jsx` (7282-7568)
- i18n: namespace `legacy`, klucze pod `admin.pipeline.*` (już istnieją w `legacy.json` od P2-pipeline)
- Tabela / drawer / forms: bez nowych dependency (custom React, jak Companies 2.0)
- Reuse z Companies 2.0:
  - `AdminRightDrawer` (jeśli wydzielony jako reusable, patrz §8.3)
  - Feature flag pattern (`src/config/features.js`)
  - Tab UI pattern + counter badges
  - `useTranslation("legacy")` + key path pod sub-namespace
- Statusy: tylko **istniejące** wartości `send_status` enum — nie dodajemy nowych

### 0.5 Co NIE jest objęte tym planem

- Migracje SQL → nie potrzebne
- Hard-delete / archive sendów → poza scope
- Resend open webhook handler → osobny ticket `feat/resend-open-webhook`
- Pg_cron dla auto-expire 14d + auto-refund → osobny ticket `chore/pg-cron-send-lifecycle`
- Mobile responsiveness → faza 2 (po stabilizacji desktop)
- Bulk PayU operations → nie istnieją w tym kontekście
- Mass-mail do dostawców (nie kupców) → osobny projekt

---

## 1. Nowa struktura zakładek — **4 taby zamiast 6**

Decyzja: konsolidujemy "panel kupca" + "wybór do maila" + "wysłane" + "rozliczenia" do **4 operacyjnych zakładek** zamiast 6 technicznych z propozycji Codexa. Powód: admin myśli "co mam dziś zrobić", nie "w jakim stanie ma rekord".

### 1.1 Tabs spec

| Tab key | Label PL | Label EN | Co zawiera | Default sort |
|---|---|---|---|---|
| `moderation` | Do moderacji | Moderation | `status IN ('pending_moderation', 'approved', 'queued')` — propozycje przed wysłaniem (do decyzji + do mailingu) | FIFO (oldest first) |
| `mailing` | Mailing | Mailing | **Koszyk persistent** — propozycje wybrane do najbliższego mailingu. Plus sub-filtry: "W panelu bez maila" / "W koszyku" / "Wysłane dzisiaj" | Manual (admin sortuje) |
| `tracking` | Tracking | Tracking | `status IN ('sent', 'opened', 'read', 'read_manual')` — co się dzieje po wysłaniu, alarmy 14d, nieprzeczytane | `sentAt DESC` (newest first) |
| `settlements` | Rozliczenia | Settlements | `data.billingStatus` per send — co rozliczone, co czeka pakietu, co do refundu | `chargeAt DESC` |

### 1.2 Default tab

**`moderation`** — najczęstszy entry point dla admina obsługującego pipeline. Counter badge z liczbą pending podświetlony amber.

### 1.3 Counter badges

Każdy tab pokazuje liczbę rekordów + ewentualny alarm:

```
Do moderacji (18 ●)   Mailing (42)   Tracking (12 ⚠)   Rozliczenia (31)
```

| Tab | Counter | Alarm dot |
|---|---|---|
| moderation | `pending_moderation + approved + queued` | amber `●` jeśli `pending_moderation > 0` |
| mailing | koszyk persistent count | brak |
| tracking | `sent + opened + read + read_manual` | red `⚠` jeśli `unread_expired > 0` LUB `sent > 14 dni` |
| settlements | `sentSends.length` | red `⚠` jeśli `billingStatus = 'no_package_available'` count > 0 |

### 1.4 URL state

```
?tab=moderation
?tab=mailing
?tab=tracking&retailer=auchan&status=sent
?tab=settlements&supplier=unica&billing=waiting
```

Share-able link, browser back works.

### 1.5 i18n keys (lokalizacja: `src/i18n/{pl,en}/legacy.json` pod `admin.pipeline.*`)

```jsonc
"admin": {
  "pipeline": {
    "tabs": {
      "moderation": "Do moderacji",
      "mailing": "Mailing",
      "tracking": "Tracking",
      "settlements": "Rozliczenia"
    },
    "tabs_count_aria": "{{count}} propozycji"
  }
}
```

EN: `Moderation / Mailing / Tracking / Settlements`.

---

## 2. Mailing jako osobny flow z 5 stanami

### 2.1 Pięć stanów propozycji w mailingu

Z auditu wiemy że wszystkie te stany są obliczalne z DB **bez migracji**:

| State | Compute z DB | Widoczność w UI |
|---|---|---|
| **W panelu kupca** | `status IN ('sent','opened','read','read_manual')` | Wszystkie taby (badge "Panel ✓") |
| **W koszyku mailingu** | `data.in_mailing_basket = true` (NOWE pole JSONB — bez migracji, JSONB jest schema-less) LUB osobny localStorage / Supabase row | Tab `mailing` → sub-filter "W koszyku" |
| **Email wysłany** | `data.emailSentAt IS NOT NULL` OR `resend_message_id IS NOT NULL` | Tab `tracking` (kolumna "Email") |
| **Email otwarty** | `status = 'opened'` OR `email_opened_at IS NOT NULL` | Tab `tracking` (kolumna "Open" — placeholder dopóki webhook nieaktywny) |
| **Admin potwierdził manualnie** | `status = 'read_manual'` + `data.confirmHistory[]` | Tab `tracking` (kolumna "Potwierdzenie") |

### 2.2 Koszyk mailingu — opcje implementacji

**⚠️ Wybór do podjęcia w planie Branch 3** (Mailing basket):

| Opcja | Plus | Minus |
|---|---|---|
| **A) `data.in_mailing_basket = true`** w JSONB | Bez migracji, używa istniejącego pola JSONB. Działa zaraz. | Mieszanie semantyki w `data`. Trzeba zaktualizować `bulkUpsertLegacySends` żeby nie wymazywało. |
| **B) Osobna tabela `mailing_basket_items(id, send_id, added_by, added_at)`** | Czysta semantyka, history kto co dodał, łatwy join. | Wymaga migracji SQL → naruszenie guardrail "bez migracji". |
| **C) `localStorage` po stronie admina** | Zero DB, zero migracji. | Admin może mieć inny koszyk na laptopie vs telefonie. Nie współdzielone między adminami. |

**Rekomendacja:** opcja A (JSONB pole) na MVP Branch 3. Jeśli okaże się problem → upgrade do B w osobnym branchu z migracją.

### 2.3 Mailing flow w UI

**Tab `mailing` ma 3 sub-zakładki (sub-filtry, nie osobne taby — żeby nie mnożyć poziomów):**

#### 2.3a "W panelu bez maila" (default sub-filter)

Wyświetla: `sentSends.filter(canEmailRetailerSend)` (jak dzisiaj sekcja "Propozycje w panelu bez e-maila"), ALE jako tabela zamiast kart.

Akcje per row:
- `[+ Dodaj do koszyka]` — patch `data.in_mailing_basket = true`
- `[Wyślij teraz solo]` — otwórz `EmailNewsletterModal` dla pojedynczej propozycji (legacy path)

Bulk:
- Zaznacz wiele → `[+ Dodaj N do koszyka]`

#### 2.3b "W koszyku" sub-filter

Wyświetla: `sends.filter(s => s.data?.in_mailing_basket === true)`.

Akcje per row:
- `[− Usuń z koszyka]` — patch `data.in_mailing_basket = false`

Bulk:
- Per sieć: `[Podgląd maila]` → modal z wyrenderowanym HTML
- Per sieć: `[Wyślij e-mail (N propozycji)]` → wywołanie `dbSendRetailerBatch` z koszykiem dla tej sieci

Counter per sieć w koszyku (np. "Auchan: 7, Biedronka: 12, Lidl: 4") + button "Wyślij wszystkim".

#### 2.3c "Wysłane dzisiaj" sub-filter

Wyświetla: `sends.filter(s => isToday(s.data?.emailSentAt))`.

Read-only — admin widzi co już dzisiaj poszło, żeby nie spamować kupców.

### 2.4 Idempotency

W Branch 3 dodajemy do `dbSendRetailerBatch` request:
```js
{ retailer_id, send_ids, idempotency_key: hash(retailer_id + sorted(send_ids) + admin_id + today) }
```

`send-retailer-batch.js` (Netlify function) sprawdza czy `idempotency_key` był już użyty (np. cache 24h w `legacy_sends.data.idempotency_keys[]`), jeśli tak — zwraca poprzedni response zamiast wysłać ponownie.

**⚠️ To wymaga zmiany w Netlify function** — naruszenie guardrail "bez zmian w wysyłce". 

**Decyzja:** idempotency jest **opcjonalna** w Branch 3 MVP. Jeśli admin nie zgadza się na zmianę Netlify function → robimy soft-guard po stronie UI (disable button na 60s po klik + confirm modal "Już wysłano dzisiaj N maili do tej sieci, kontynuować?"). Hard idempotency = osobny ticket `fix/send-retailer-batch-idempotency`.

### 2.5 i18n keys

```jsonc
"admin": {
  "pipeline": {
    "mailing": {
      "subtabs": {
        "in_panel_no_email": "W panelu bez maila",
        "in_basket": "W koszyku",
        "sent_today": "Wysłane dzisiaj"
      },
      "actions": {
        "add_to_basket": "+ Dodaj do koszyka",
        "remove_from_basket": "− Usuń z koszyka",
        "send_solo": "Wyślij teraz solo",
        "preview_email": "Podgląd maila",
        "send_email_n": "Wyślij e-mail ({{count}} propozycji)",
        "send_all_retailers": "Wyślij wszystkim sieciom"
      },
      "basket_counter_per_retailer": "{{retailer}}: {{count}}",
      "soft_guard_already_sent_today": "Dziś już wysłano {{count}} e-maili do {{retailer}}. Kontynuować?",
      "basket_empty": "Koszyk pusty. Dodaj propozycje z zakładki „W panelu bez maila”.",
      "sent_today_empty": "Nic dzisiaj nie wysłano."
    }
  }
}
```

---

## 3. Tabela zamiast kart

### 3.1 Wspólny komponent tabeli

Wprowadzamy `<AdminPipelineTable>` jako wspólny komponent dla wszystkich 4 tabów. Każdy tab konfiguruje:
- Kolumny (zestaw zależny od tabu)
- Default sort
- Available filters
- Bulk actions
- Row actions

### 3.2 Bazowy zestaw kolumn (wszystkie taby)

| Kolumna | Width | Sortable | Filter | Render |
|---|---|---|---|---|
| ☐ checkbox | 32px | nie | nie | bulk select |
| Status | 90px | tak | tak (multi-select) | colored pill (tylko alarm: amber/red, reszta neutralna) |
| Sieć | 140px | tak (A-Z) | tak (multi-select retailer) | logo + nazwa |
| Dostawca | 160px | tak (A-Z) | tak (multi-select supplier) | logo + nazwa |
| Produkt | flex | tak (A-Z) | search | title + kategoria emoji |
| Akcje | 120px | nie | nie | per-tab buttons |

### 3.3 Kolumny dodatkowe per tab

**Tab `moderation`:**
- Tier (Premium/Standard) — sortable, filterable
- Pozycja (input number) — editable inline
- Data wysłania (input date) — editable inline
- Status pill: pending_moderation / approved / queued

**Tab `mailing`:**
- W koszyku? (checkbox computed: `data.in_mailing_basket === true`) — sortable, filterable
- Panel od (data first sent → panel) — sortable
- Email wysłany (data emailSentAt) — sortable, sortable null-last

**Tab `tracking`:**
- Email wysłany (data emailSentAt) — sortable
- Email otwarty (data email_opened_at — placeholder dopóki webhook nieaktywny)
- Odczyt (data readAt OR confirmHistory) — sortable
- Dni do expiry (computed `14 - (now - sentAt)`) — sortable, kolor red jeśli `<3`

**Tab `settlements`:**
- Status billing — sortable, filterable (charged / waiting / no_package / refunded)
- Kwota (EUR) — sortable, sumowane w toolbarze
- Charged at — sortable
- Refunded at — sortable

### 3.4 Pagination LUB virtualization — decyzja oparta na wolumenie

**Q: Realny wolumen `legacy_sends` dziś i prognoza 12mc?**

Pytanie do Artura przed Branch 1 kodowym. Decyzja:

| Wolumen | Strategy |
|---|---|
| <200 | Render wszystkiego naraz (jak dzisiaj) — OK |
| 200-500 | **Pagination 100/page** + `[Załaduj kolejne]` |
| 500-2000 | **Wirtualizacja** (react-window) + opcjonalna pagination |
| 2000+ | **Server-side filter** (load po `WHERE status IN ... LIMIT 100`) — wymaga zmian w `loadLegacySends()` |

Default decyzja jeśli brak danych: **Pagination 100/page od Branch 1 + wirtualizacja od Branch 4 jeśli okaże się że potrzeba**.

### 3.5 Toolbar nad tabelą

```
[🔍 Search ...]   [Filtry ▾]   [☐ Wybrane: 0]    [📊 Export CSV]
                                   ↓ (gdy zaznaczone)
                                   [Bulk action ▾]
```

### 3.6 Bulk actions per tab

| Tab | Bulk actions |
|---|---|
| moderation | Approve N · Reject N · Set deadline N |
| mailing (w panelu bez maila) | Add N to basket · Send solo (per N) |
| mailing (w koszyku) | Remove N from basket · Send all per retailer |
| tracking | Mark N as read manually · Show history per N |
| settlements | Export N to CSV |

**Confirmation modal** dla destruktywnych (Reject N, Send N, Refund N).

### 3.7 Eksport CSV

Button `[📊 Export CSV]` w toolbarze → exportuje **current view** (po filtrach + sortowaniu).

Kolumny exportu = kolumny tabeli (z computed values). Bez technicznych pól (UUID-y, JSONB raw).

Filename: `pipeline_{tab}_{YYYY-MM-DD_HHMM}.csv`.

---

## 4. Drawer szczegółów propozycji — reuse z Companies 2.0

### 4.1 Wymaganie dla Companies 2.0 Branch 2

**Pipeline 2.0 Branch 2** zakłada że Companies Branch 2 **wydzieli drawer jako reusable component**:

```jsx
// src/components/admin/AdminRightDrawer.jsx (proponowane)
export function AdminRightDrawer({
  open,
  onClose,
  width = 480,
  header,
  footer,
  tabs,          // [{ key, label, badge?, disabled? }]
  activeTab,
  onTabChange,
  children,      // render zależny od activeTab
  onPrev,
  onNext,
  prevDisabled,
  nextDisabled,
})
```

Jeśli Companies Branch 2 zrobi drawer inline w `PageAdminFirmy` → Pipeline Branch 2 będzie musiał najpierw zrobić refactor wydzielający (+1 commit).

**Action item:** dopisać do Companies Branch 2 acceptance criteria: *"drawer wydzielony jako `src/components/admin/AdminRightDrawer.jsx`, exportable, używany przez `PageAdminFirmy` przez import (nie inline)"*.

### 4.2 Subtaby drawera Pipeline

| Subtab | Co pokazuje | Edytowalne? |
|---|---|---|
| **Propozycja** (default) | Tytuł, kategoria, opis, zdjęcia, cena, volume, sezon, certs. Status badge na górze. | Nie (read-only) |
| **Dostawca** | Logo, nazwa, kraj, NIP, website, kontakty (name/position/phone/email z `companies.contacts[]`), `mailto:` + `tel:` + copy buttons (jak w Companies 2.0) | Nie |
| **Kupiec / sieć** | Sieć (logo, nazwa), lista kupców z emailem (`profiles.email`), kategorie kupca | Nie |
| **Historia** | `confirmHistory[]` + log statusów (kiedy `pending → approved → sent → read`) + kto wysłał email | Nie |
| **Rozliczenie** | `billingStatus`, `chargeAmount`, `chargeAt`, `refundAt`, link do wallet_tx jeśli istnieje | Nie (Branch 4) |

### 4.3 Footer drawera — actions sticky

| Status propozycji | Footer actions |
|---|---|
| `pending_moderation` | `[Approve]` `[Reject z notką]` |
| `approved` | `[Wyślij teraz solo]` `[+ Dodaj do koszyka mailingu]` |
| `sent` | `[Potwierdź odczyt ręcznie ▾]` (typ: phone/email/meeting + notka) |
| `opened/read/read_manual` | `[Cofnij potwierdzenie]` (undo) |
| `unread_expired` | `[Wykonaj refund]` (jeśli był charge marker) |
| `refunded` | (brak — read-only) |

### 4.4 Nav

`[← Prev] [Next →]` w headerze — skacze po `visibleSendsByTab` (po aktualnych filtrach + sortowaniu). Pozycja przewijania tabeli follow'uje.

### 4.5 i18n keys

```jsonc
"admin": {
  "pipeline": {
    "drawer": {
      "subtabs": {
        "proposal": "Propozycja",
        "supplier": "Dostawca",
        "buyer": "Kupiec / sieć",
        "history": "Historia",
        "settlement": "Rozliczenie"
      },
      "close": "Zamknij",
      "prev_proposal": "Poprzednia propozycja",
      "next_proposal": "Następna propozycja",
      "footer": {
        "approve": "Zatwierdź",
        "reject": "Odrzuć",
        "reject_reason_required": "Podaj powód odrzucenia",
        "send_solo": "Wyślij teraz solo",
        "add_to_basket": "+ Dodaj do koszyka",
        "confirm_manual": "Potwierdź odczyt ręcznie",
        "undo_confirm": "Cofnij potwierdzenie",
        "refund": "Wykonaj refund"
      }
    }
  }
}
```

---

## 5. Liczniki robocze na górze

### 5.1 Sticky header z 4 licznikami

Powyżej tabów (full-width, sticky scroll):

```
┌──────────────────────────────────────────────────────────────────────┐
│ 🟡 Do moderacji: 18    📧 W panelu bez maila: 27    🔴 14d alert: 12 │
│ 💰 Do rozliczenia: 31                                                │
└──────────────────────────────────────────────────────────────────────┘
```

Klik w licznik = nawigacja do tabu z pre-filled filtrem. Np. klik "14d alert" → tab `tracking` + filter `daysLeft < 3`.

### 5.2 Compute

Liczniki refresh-owane po każdej zmianie statusu (jak teraz w `setSends`). Branch 1 wystarczy client-side compute. Branch 4 może dorzucić server-side endpoint `getPipelineStats()` jeśli >2000 sendów.

### 5.3 i18n keys

```jsonc
"admin": {
  "pipeline": {
    "stats": {
      "moderation_count": "Do moderacji: {{count}}",
      "in_panel_no_email_count": "W panelu bez maila: {{count}}",
      "alert_14d_count": "14d alert: {{count}}",
      "to_settle_count": "Do rozliczenia: {{count}}"
    }
  }
}
```

---

## 6. Ograniczenie kolorów

### 6.1 Stara paleta (do usunięcia z V2)

7 kolorów statusów: amber / green / red / orange / teal / purple / dark-green. Admin ma rozpoznać która oferta wymaga uwagi → bardzo trudne.

### 6.2 Nowa paleta (semantyczna)

| Color | Semantyka | Zastosowanie |
|---|---|---|
| 🔴 red | Problem / alarm | `unread_expired`, `no_package_available`, "wymaga refundu" |
| 🟡 amber | Czeka na akcję admina | `pending_moderation`, "14d za 3 dni", `waiting` (billing) |
| 🟢 green | Zrobione / OK | `read`, `read_manual`, `charged`, `refunded` |
| 🔵 blue | Informacja | `sent`, `opened`, `approved` |
| ⚪ neutral gray | Tło / nieaktywne | `queued`, `rejected`, podświetlenie wiersza |

### 6.3 Application rule

- Status pill: kolor z palety, tylko 1 słowo (e.g., "Pending", "Sent")
- Liczniki robocze: kolor tylko gdy alarm (czerwony >0 albo amber >0)
- Wiersze tabeli: białe tło, hover light-gray. **Bez** kolorowego border per status.
- Counter badge: kolor accentu tabu (Mailing=blue, Moderacja=amber, Tracking=red gdy alarm, Settlements=green)

---

## 7. Implementation split — 4 branche kodowe + opcjonalny 5

### Branch 1 — `feat/admin-pipeline-table-and-filters` (NAJWAŻNIEJSZE — first)

**Pain solved:** karty → tabela, brak filtrów → search + multi-filter, brak skali → paginacja.

**Scope:**
- Feature flag `ADMIN_PIPELINE_2_0_TABLE` w `src/config/features.js` (dokładamy do istniejącego pliku)
- 4 nowe taby (Moderacja / Mailing / Tracking / Rozliczenia) zamiast 2 (Moderacja / Wysłane & Tracking)
- `<AdminPipelineTable>` komponent (wspólny dla 4 tabów)
- Per-tab kolumny + sortowanie + filtry
- Search bar + filter panel
- Pagination 100/page + `[Załaduj kolejne]`
- Counter badges per tab + amber/red dots dla alarmów
- Liczniki robocze sticky header
- Eksport CSV (current view)
- URL state (`?tab=`, `?retailer=`, `?status=`)
- i18n keys: `admin.pipeline.tabs.*`, `admin.pipeline.stats.*`, `admin.pipeline.row.*`, `admin.pipeline.empty.*`
- Stary UI zostaje pod flagą `false` (jak Companies Branch 1)

**Out of scope:** drawer (zostaje stary expand inline / modal), koszyk mailingu, bulk send, idempotency.

**Risk:** **medium-high** — zmienia layout całego pipeline'u. Mitygacja: feature flag + smoke prod 1-2 dni.

**Acceptance:**
- [ ] 4 taby renderują się z poprawnymi liczbami
- [ ] Filtry + search działają client-side
- [ ] Pagination 100/page działa
- [ ] Sortowanie kolumn działa
- [ ] Bulk select checkbox działa (akcje będą w kolejnych branchach)
- [ ] CSV export pobiera plik z current view
- [ ] Stary UI dostępny gdy `ADMIN_PIPELINE_2_0_TABLE = false`
- [ ] EN locale switch — wszystkie nowe labelki przetłumaczone
- [ ] `npm run build` zielony

**Test plan:**
- Manual: każdy tab pokazuje poprawnie filtered sendy
- Manual: search "Auchan" → tabela zawęża do sendów z Auchan
- Manual: filter `status=sent` w tracking tab → tylko nieprzeczytane
- Manual: bulk select 3 → counter "Wybrane: 3"
- Manual: CSV export → otwiera w Excel poprawnie
- Manual: flag = false → stary UI

---

### Branch 2 — `feat/admin-pipeline-detail-drawer`

**Pain solved:** brak szybkiego dostępu do szczegółów propozycji + kontakt kupca i dostawcy w jednym miejscu.

**Pre-requisite:** **Companies Branch 2 merged** (wydzielony `AdminRightDrawer` jako reusable). Jeśli nie wydzielony — Pipeline Branch 2 robi refactor pierwszy (+1 commit).

**Scope:**
- Feature flag `ADMIN_PIPELINE_2_0_DRAWER`
- `[Szczegóły]` button w wierszu tabeli → otwiera `AdminRightDrawer`
- 5 subtabów (Propozycja / Dostawca / Kupiec / Historia / Rozliczenie)
- Footer sticky z status actions (per-status: approve/reject/send/refund)
- `[← Prev] [Next →]` nav po `visibleSendsByTab`
- i18n keys: `admin.pipeline.drawer.*`

**Out of scope:** koszyk mailingu, idempotency, bulk send.

**Risk:** low (sam drawer już bez ryzyka po Companies 2).

**Acceptance:**
- [ ] Klik `[Szczegóły]` otwiera drawer, lista widoczna
- [ ] Wszystkie 5 subtabów renderują się
- [ ] Status actions w footerze działają (reuse `moderate`, `confirmManual`)
- [ ] Prev/Next przeskakuje po visible sendsach z tabu
- [ ] Klik `[Reject]` wymaga notki (textarea required)
- [ ] EN locale

---

### Branch 3 — `feat/admin-pipeline-mailing-basket`

**Pain solved:** brak persistent koszyka mailingu — admin nie może zbierać propozycji przez dzień, musi wysyłać jednocześnie.

**Scope:**
- Feature flag `ADMIN_PIPELINE_2_0_BASKET`
- `data.in_mailing_basket = true` jako pole w JSONB (bez migracji)
- Tab `mailing` z 3 sub-zakładkami: "W panelu bez maila" / "W koszyku" / "Wysłane dzisiaj"
- Per row akcje: `[+ Dodaj do koszyka]` / `[− Usuń z koszyka]`
- Bulk: `[+ Dodaj N do koszyka]`
- Per sieć w koszyku: counter + `[Podgląd maila]` + `[Wyślij e-mail (N propozycji)]`
- Soft-guard: confirm modal "Już dzisiaj wysłano N maili do {{retailer}}"
- Counter "W koszyku" w sticky header
- i18n keys: `admin.pipeline.mailing.*`

**Out of scope:** hard idempotency (osobny ticket dla Netlify function), bulk send all retailers (UX może być w Branch 4).

**Risk:** **high** — bo wysyłanie maili. Mitygacja:
- Soft-guard confirm modal przed wysłaniem
- Max 30 sendów w jednym wysłaniu (hard limit w UI)
- Sequential send (rate limit Resend)
- Feature flag `ADMIN_PIPELINE_2_0_BASKET = false` cofa do starego modal

**Acceptance:**
- [ ] Klik `[+ Dodaj do koszyka]` → `data.in_mailing_basket = true` zapisane w DB (via `bulkUpsertLegacySends`)
- [ ] Tab `mailing → W koszyku` pokazuje N propozycji per sieć
- [ ] Klik `[Wyślij e-mail (N)]` → confirm modal → `dbSendRetailerBatch` (jak dzisiaj)
- [ ] Po wysłaniu: `data.in_mailing_basket = false` (clear bucket) + `data.emailSentAt = now()`
- [ ] Soft-guard: 2x wysłanie do tej samej sieci w 1 dzień → confirm modal
- [ ] Edge case: 2 administratorów otwiera koszyk równolegle → ostatni save wins (na MVP)

**Test plan:**
- Staging: dodaj 5 propozycji do koszyka, wyślij, sprawdź `data.emailSentAt` w DB
- Staging: zaznacz "Wyślij" 2x szybko → soft-guard pokazuje confirm
- Staging: usuń z koszyka → propozycja wraca do "W panelu bez maila"

---

### Branch 4 — `feat/admin-pipeline-tracking-settlements`

**Pain solved:** brak osobnego widoku trackingowego (kto odczytał, kto nie) + brak osobnego widoku rozliczeniowego (charge/refund).

**Scope:**
- Feature flag `ADMIN_PIPELINE_2_0_TRACKING_SETTLEMENTS`
- Tab `tracking` z kolumnami: Email wysłany / Email otwarty / Odczyt / Dni do expiry / Potwierdzenie ręczne
- Tab `settlements` z kolumnami: Billing status / Kwota EUR / Charged at / Refunded at / Action `[Refund]`
- Filter "Status: opened/read/sent" + "Dni do expiry: <3 / <7 / wszystkie"
- Alert w sticky: "X kupców systematycznie nie odpowiada (top 10)" — agregat po retailer_id
- Manual button `[Wykonaj refund nieodczytanych]` → wywołanie `refundUnreadExpiredLegacySends()` (już istnieje w db.js)
- Per supplier: rozbudowa current "Rozliczenia" — pokazuje WSZYSTKIE rozliczone (nie tylko top 4), eksport CSV per supplier
- i18n keys: `admin.pipeline.tracking.*`, `admin.pipeline.settlements.*`

**Out of scope:** auto-cron dla refund/expire (osobny ticket).

**Risk:** medium — używa istniejących RPC, ale dodaje guzik "Wykonaj refund" który tworzy `wallet_tx`. Mitygacja:
- Confirm modal przed refund: "Zwrócić X EUR dla Y dostawców?"
- Audit log: zapisać kto kliknął (w `data.refund_triggered_by_admin`)

**Acceptance:**
- [ ] Tab `tracking` pokazuje sendy w post-wysyłce z poprawnymi filtrami
- [ ] Tab `settlements` pokazuje per supplier + per send szczegóły rozliczeń
- [ ] Klik `[Refund]` → confirm modal → wywołanie RPC → toast "Zrefundowano X sendów"
- [ ] Eksport CSV per supplier działa

---

### Branch 5 (opcjonalny) — `feat/admin-pipeline-status-migration`

**Tylko jeśli** audit pokazał że panel/email są pomieszane w bazie. **Audit pokazał że są ROZDZIELONE** → ten branch **NIEPOTRZEBNY**.

Pozostaje w planie jako placeholder dla przyszłej migracji jeśli zdecydujemy się na strukturalne rozdzielenie (np. dodanie kolumny `email_status text` jako convenience).

**Status: NIE PLANUJEMY w tym cyklu.**

### 7.6 Branch ordering rationale

1. **Branch 1 first** — tabela + filtry. Największy pain (skala) + zero ryzyka logiki wysyłki. Foundation dla reszty.
2. **Branch 2 second** — drawer szczegółów. Wymaga Companies Branch 2 merged. Niski risk.
3. **Branch 3 third** — koszyk mailingu. **Najwyższy risk** (wysyłka maili). Robimy po stabilizacji 1+2.
4. **Branch 4 last** — tracking + rozliczenia. Może być przed Branch 3 jeśli Branch 3 jest blokowany przez Codex review. Zawiera button "Refund" który tworzy `wallet_tx`.

### 7.7 Feature flags spec

Plik `src/config/features.js` (już istnieje z Companies Branch 1) **dokładamy** flagi Pipeline:

```js
// src/config/features.js (po dodaniu Pipeline)
export const ADMIN_COMPANIES_2_0_LIST = true;
export const ADMIN_COMPANIES_2_0_DRAWER = false;        // Companies B2
export const ADMIN_COMPANIES_2_0_FILTERS = false;       // Companies B3
export const ADMIN_COMPANIES_2_0_CHAT = false;          // Companies B4
export const ADMIN_COMPANIES_2_0_BULK = false;          // Companies B5
export const ADMIN_PIPELINE_2_0_TABLE = false;          // Pipeline B1
export const ADMIN_PIPELINE_2_0_DRAWER = false;         // Pipeline B2
export const ADMIN_PIPELINE_2_0_BASKET = false;         // Pipeline B3
export const ADMIN_PIPELINE_2_0_TRACKING_SETTLEMENTS = false;  // Pipeline B4
```

Wszystkie default `false`. Flip na `true` po smoke test i pierwszej dobie obserwacji w prod.

---

## 8. Hard guardrails

### 8.1 ⚠️ NIE startujemy Pipeline 2.0 kodowo równolegle z Companies 2.0

**Powody:**
- Companies 2.0 ma jeszcze 4 branche kodowe przed sobą (Drawer, Filters, Chat, Bulk)
- Każdy wymaga Codex review + smoke prod
- Pipeline 2.0 = kolejne 4 branche
- Admin (Artur) musi weryfikować każdy na prod
- Dwa równoczesne CRM-refactory = ryzyko że drawer Companies się rozjedzie z drawer Pipeline (jeśli nie wydzielony jako shared)

**Decyzja:** **kod Pipeline 2.0 dopiero po Companies 2.0 Branch 2** (drawer wydzielony jako reusable) **lub po osobnej decyzji Artura**.

Wyjątek: jeśli rozdzielenie panel/email okaże się palącym bugiem produkcyjnym (admin myli się, wysyła 2× maile, dostawcy się skarżą) → hotfix path, nie Pipeline 2.0.

### 8.2 Zero migracji bez osobnego review

Plan Pipeline 2.0 zakłada **zero migracji SQL** (panel/email rozdzielone w DB). Jeśli któryś branch będzie wymagał migracji (np. opcja B w §2.2 dla koszyka mailingu) — wymagana **osobna decyzja Artura + Codex review**.

### 8.3 Zero zmian w wysyłce maili w tym scope

Pipeline 2.0 (wszystkie 4 branche) **NIE rusza**:
- `netlify/functions/send-retailer-batch.js`
- `netlify/functions/notify-supplier-read.js`
- `netlify/functions/_shared/render-retailer-email.js`
- `markLegacySendRead` RPC
- `expire_legacy_sends_14d` RPC
- `refund_unread_expired_legacy_sends` RPC
- RLS policies na `legacy_sends`

Jeśli któryś branch potrzebuje zmiany (np. hard idempotency w Branch 3) → **osobny ticket**, nie część Pipeline 2.0.

### 8.4 Zero embedded chatu w Pipeline

Companies 2.0 Branch 4 ma embedded chat. Pipeline 2.0 **nie ma**. Jeśli admin chce napisać do dostawcy/kupca → klik w drawer → klik na email → `mailto:` (Branch 2).

### 8.5 Zero archive/delete sendów

Wszystkie sendy zostają w DB. `unread_expired`, `refunded`, `rejected` są filtrowalne ale **nie usuwalne**. Hard-delete sendów = osobny projekt jeśli kiedyś (GDPR-like).

### 8.6 Reuse `AdminRightDrawer` z Companies 2.0

Patrz §4.1 — wymaganie dla Companies Branch 2. Pipeline Branch 2 reuse'uje, nie tworzy własnego.

---

## 9. Otwarte pytania (do decyzji przed Branch 1 kodowym)

### Q1 — Wolumen sendów (decyduje o pagination vs virtualization)

Pytanie: ile `legacy_sends` jest w prod dziś + prognoza na 12mc?
- <500 → pagination 100/page wystarczy
- 500-2000 → wirtualizacja od Branch 1
- 2000+ → server-side filtering w `loadLegacySends()`

**Wymagam wartości** przed napisaniem kodu Branch 1.

### Q2 — Koszyk mailingu: JSONB pole vs osobna tabela vs localStorage?

Patrz §2.2.

- Rekomendacja: **A** (`data.in_mailing_basket = true` w JSONB)
- Akceptowalne: **C** (localStorage, jeśli wystarczy że jeden admin korzysta z koszyka)
- Wymaga migracji: **B** (osobna tabela `mailing_basket_items`)

**Wymagam decyzji** przed Branch 3.

### Q3 — Idempotency hard vs soft

Patrz §2.4. Soft = UI guard (confirm modal). Hard = Netlify function update.

- Rekomendacja: **soft w Branch 3 MVP, hard w osobnym ticket'cie**.

### Q4 — Czy admin chce dashboard "Top 10 kupców z najgorszym open rate"?

Patrz §I.12 w audicie. Branch 4 może to dodać, ale wymaga agregacji per retailer + window function.

- Rekomendacja: **odłożyć do Branch 4** (osobna decyzja).

### Q5 — Domyślny tab na load

- **A) `moderation`** (najczęstszy entry point — rekomendacja)
- **B) `mailing`** (jeśli "co dzisiaj wysyłamy" jest częstsze)
- **C) ostatnio używany** (localStorage)

- Rekomendacja: **A**.

### Q6 — Lokalizacja CSV export — czy w toolbarze tabeli czy per tab w menu?

- Rekomendacja: **per tab w toolbarze** (kontekst current view).

### Q7 — Resend open webhook — czy to jest blokowy czy nieblokujący Pipeline 2.0?

- Audit pokazał że pole `email_opened_at` jest gotowe ale nieużywane. Status `'opened'` nigdy się nie pojawi w UI dopóki webhook nieaktywny.
- Pipeline 2.0 może renderować kolumnę "Email otwarty" jako placeholder (— dla wszystkich) i włączyć ją gdy webhook dojdzie.

- Rekomendacja: **placeholder w Pipeline 2.0, osobny ticket dla webhook**.

### Q8 — Czy auto-cron dla expire 14d + refund jest blokujący Pipeline 2.0?

- Audit pokazał że RPC są, ale auto-trigger brakuje. Refundy nie idą automatycznie.
- Pipeline Branch 4 dodaje manual button `[Wykonaj refund]` — admin może uruchomić.
- Auto-cron = osobny ticket.

- Rekomendacja: **manual button w Branch 4, auto-cron osobny**.

---

## 10. Risks + mitygacje

| Risk | Impact | Mitygacja |
|---|---|---|
| Refactor PageAdminPipeline regression | High | Feature flag per branch + smoke prod 24h |
| Wydajność tabeli >500 sendów bez wirtualizacji | High | Pagination 100/page od Branch 1; wirtualizacja Branch 4 |
| Bulk send 2× tego samego batchu (Netlify crash) | High | Soft-guard confirm modal w Branch 3 + max 30 sendów per batch + sequential rate-limit |
| Koszyk persistent koliduje z legacy `bulkUpsertLegacySends` | Medium | Test: po dodaniu do koszyka, refresh strony, sprawdź czy `data.in_mailing_basket` przetrwało |
| Drawer Pipeline rozjeżdża się z drawer Companies | Medium | Wymaganie reusable `AdminRightDrawer` w Companies Branch 2 acceptance |
| 2 administratorów modyfikuje koszyk równolegle | Low (MVP) | Last save wins — udokumentowane jako limitation |
| CSV export ujawnia PII | Medium | Kolumny exportu kontrolowane — bez ID UUID, email kupca tylko jeśli admin role |
| Resend open webhook brak → kolumna `email_opened_at` zawsze pusta | Low | Placeholder "—" w UI, dokumentowane |
| Manual `[Wykonaj refund]` button → admin zrobił 2× refund | Medium | Confirm modal + RPC `refund_unread_expired_legacy_sends` ma guard `WHERE data.refundAt IS NULL` (idempotent on DB level) |

---

## 11. Out of scope — przyszłe iteracje

- **Resend open webhook handler** (`feat/resend-open-webhook`) — populuje `email_opened_at`
- **Auto-cron dla expire 14d + refund** (`chore/pg-cron-send-lifecycle`)
- **Hard idempotency w `send-retailer-batch.js`** (`fix/send-retailer-batch-idempotency`)
- **Mobile responsive Pipeline** (`feat/admin-pipeline-mobile`)
- **Dashboard agregowany** "Top kupcy z najgorszym open rate" (Branch 5+)
- **Scheduled mailing** (`feat/admin-pipeline-scheduled-send`) — wysyłka o określonej godzinie
- **Templates maila edytowane przez admina** (`feat/admin-email-templates-editor`)
- **Per-admin koszyk persistent w DB** (jeśli §2.2 opcja A okaże się problem)
- **Hard-delete sendów (GDPR)** — osobny projekt P3+

---

## 12. Powiązania z Companies 2.0 — checklist dla Companies Branch 2

Dopisać do `ADMIN_COMPANIES_2_0_PLAN.md` Branch 2 acceptance criteria:

- [ ] Drawer wydzielony jako `src/components/admin/AdminRightDrawer.jsx`
- [ ] Exportable: `export function AdminRightDrawer({...})`
- [ ] Props: `open`, `onClose`, `width`, `header`, `footer`, `tabs[]`, `activeTab`, `onTabChange`, `children`, `onPrev`, `onNext`, `prevDisabled`, `nextDisabled`
- [ ] `PageAdminFirmy` importuje drawer zamiast renderować inline
- [ ] Storybook / demo render dostępny (opcjonalnie)

Pipeline 2.0 Branch 2 reuse'uje. Bez tego — Pipeline Branch 2 robi refactor first (+1 commit).

---

## 13. Sign-off

Plan gotowy do review przez Codex + Artura. Czeka na decyzje Q1-Q8 (rekomendacje są w treści).

Po akceptacji:
1. Merge `feat/admin-pipeline-ux-plan` → main (docs-only)
2. **Wstrzymanie kodowania Pipeline 2.0** do momentu:
   - Companies 2.0 Branch 2 merged (drawer wydzielony)
   - Otrzymania wolumenów sendów (Q1)
   - Decyzji Q2-Q7
3. Pierwszy branch kodowy Pipeline: **`feat/admin-pipeline-table-and-filters`** z `ADMIN_PIPELINE_2_0_TABLE` default `false`

---

## 14. Quick reference — co zmienia w istniejących plikach

| Plik | Zmiana | Branch |
|---|---|---|
| `src/legacy/PreconnectFM.jsx` linie 7282-7568 | Refactor `PageAdminPipeline` na 4 taby + tabela + filtry. Stary kod jako fallback przy flag=false. | Pipeline B1 |
| `src/legacy/PreconnectFM.jsx` linie 8791-9000+ | `EmailNewsletterModal` zostaje (używana przez "Wyślij solo" w Branch 1 fallback path). Branch 3 dodaje obok koszyk persistent. | Pipeline B3 |
| `src/lib/db.js` | Brak nowych funkcji w Branch 1-2. Branch 3 może dodać helper `addToMailingBasket(sendId)`. Branch 4 reuse'uje istniejące `refundUnreadExpiredLegacySends`. | Pipeline B3, B4 |
| `src/i18n/pl/legacy.json` | Nowe klucze pod `admin.pipeline.{tabs,stats,row,filters,mailing,drawer,tracking,settlements,empty}.*` (rozszerzenie istniejących z P2-pipeline) | Wszystkie branche |
| `src/i18n/en/legacy.json` | Counterparts EN | Wszystkie branche |
| `src/config/features.js` | Dokładamy 4 flagi: `ADMIN_PIPELINE_2_0_{TABLE,DRAWER,BASKET,TRACKING_SETTLEMENTS}` | Wszystkie branche |
| `src/components/admin/AdminRightDrawer.jsx` | Reuse z Companies B2 — Pipeline tylko importuje | Pipeline B2 |

**Bez zmian:** `supabase/migrations/*`, `netlify/functions/*` (email + webhooks), RLS policies, RPC z 013/018/028.

**Bez nowego namespace i18n:** wszystko pod istniejącym `legacy` namespace, klucze pod `admin.pipeline.*` (już zarejestrowane w P2-pipeline).
