# Admin Pipeline 2.0 — Audit obecnego panelu Admin → Pipeline

**Branch:** `feat/admin-pipeline-ux-plan`
**Status:** Audit only. Bez zmian kodu, bez migracji, bez ruszania logiki wysyłek.
**Cel:** zmapować obecny `PageAdminPipeline` + przepływ mailingu + statusy w `legacy_sends`, żeby zaprojektować przebudowę panelu z kart na operacyjne narzędzie CRM-owe odporne na 500+ propozycji.

Bazuje na deep-audit przez Explore subagent + verify grepy: `src/legacy/PreconnectFM.jsx` (linie 7282–7570 = `PageAdminPipeline`, linie 8791–9000+ = `EmailNewsletterModal`), `src/lib/db.js`, `supabase/migrations/{001,004,013,027,028}*.sql`, `netlify/functions/send-retailer-batch.js`, `notify-supplier-read.js`.

---

## A. Lokalizacja komponentów

### A.1 `PageAdminPipeline` (PreconnectFM.jsx:7282)

```js
PageAdminPipeline({
  sends, setSends,         // wszystkie legacy_sends + lokalny setter
  offers,                  // wszystkie oferty (do resolve product info)
  moderate,                // (sendId, "approve"|"reject") — wrapper na DB
  sendApproved,            // batch send (nie używane bezpośrednio w UI)
  updateSendDate,          // (sendId, dateString) — patch data.sendDate
  updateSendPos,           // (sendId, number) — patch data.pos
  confirmManual,           // (sendId, {type, note}) — ręczne potwierdzenie odczytu
  undoConfirm,             // (sendId) — cofnięcie potwierdzenia
  fl,                      // toast callback
  retailers, companies,    // do resolve nazw + logo
})
```

**Wywołanie:** linia 3296, `if (pg === "a-pipeline") return <PageAdminPipeline .../>;`

**Zakres:** linie 7282–7568 (~287 linii)

### A.2 State główne (7287–7308)

| State | Typ | Cel |
|---|---|---|
| `tab` | `"mod" \| "track"` | Aktywna zakładka (default `"mod"`) |
| `autoOpenedTracking` | `boolean` | Heurystyka: jeśli moderacja pusta → auto-skok do tracking |
| `expandedRetailers` | `Set<retailerId>` | Które karty sieci rozwinięte w Moderacja |
| `previewOffer` | `offer \| null` | Trigger dla `<OfferPreviewModal>` |
| `historyId` | `sendId \| null` | Trigger dla modala historii potwierdzeń |
| `emailPreview` | `{retailer, sends} \| null` | Trigger dla `<EmailNewsletterModal>` |

### A.3 `EmailNewsletterModal` (PreconnectFM.jsx:8791)

```js
EmailNewsletterModal({
  retailer,    // pojedyncza sieć (zawsze jedna na raz)
  sends,       // candidate sends do wysłania (filtrowane już przez canEmailRetailerSend)
  offers, companies,
  fl, onClose, onSent,
})
```

**Per-modal scope:** **jedna sieć** w jednym callzie. Admin musi otwierać modal osobno per sieć (klikając "E-mail" w sekcji "Propozycje w panelu bez e-maila").

**Zakres:** ~linie 8791–9000 (~210 linii)

### A.4 Sekcje renderu w `PageAdminPipeline`

1. **Tab bar** (linia 7401, dwa taby: Moderacja / Wysłane & Tracking)
2. **Tab "Moderacja"** (7411–7465) — sortowane karty per sieć
3. **Tab "Wysłane & Tracking"** (7468–7565):
   - 3a. Sekcja **"Propozycje w panelu bez e-maila"** (7474–7493) — karty per sieć z buttonem `E-mail`
   - 3b. Sekcja **"Rozliczenia dostawców"** (7494–7535) — widgety `Rozliczone X` / `Czeka X` + lista per dostawca
   - 3c. **Per-send tracking cards** (7536–7564) — kolorowe karty z kolorem zależnym od statusu
4. **Modale** (`OfferPreviewModal`, `EmailNewsletterModal`, history Modal) — wszystkie wywoływane warunkowo

---

## B. Tabela `legacy_sends` — pełna anatomia

### B.1 Migracja podstawowa (004_legacy_sync.sql:22-41)

```sql
create table if not exists legacy_sends (
  id uuid primary key default uuid_generate_v4(),
  legacy_id bigint unique not null,           -- send.id z PreConnect
  supplier_legacy_id text not null,           -- send.supplierId (legacy format)
  offer_legacy_id bigint,                     -- send.offerId
  retailer_id integer,                        -- FK retailers
  status text,                                -- enum send_status (cast text)
  data jsonb not null,                        -- pełen send (legacy structure)
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```

### B.2 `send_status` enum (001_schema.sql:14-17)

**10 wartości**, w kolejności życiowego cyklu:

```sql
create type send_status as enum (
  'queued',             -- propozycja w kolejce dostawcy, jeszcze nie wysłana do admina
  'pending_moderation', -- czeka na decyzję admina (approve/reject)
  'approved',           -- admin zaakceptował, czeka na włączenie do panelu/maila
  'rejected',           -- admin odrzucił
  'sent',               -- WIDOCZNA w panelu kupca + MAIL WYSŁANY (zlepione)
  'opened',             -- kupiec OTWORZYŁ mail (via Resend webhook, gdy zaimplementowany)
  'read',               -- kupiec KLIKNĄŁ w aplikacji (markLegacySendRead)
  'read_manual',        -- admin ręcznie odnotował kontakt (phone/email/meeting)
  'unread_expired',     -- minęło 14 dni od `sent` bez odczytu → automatyczna expiracja
  'refunded'            -- nieodczytany, opłata zwrócona do walleta dostawcy
);
```

### B.3 Migracje rozszerzające `legacy_sends`

| Migracja | Zmiana |
|---|---|
| `004_legacy_sync.sql` | Tworzy tabelę + indeksy (`legacy_id` unique, `supplier_legacy_id`, `retailer_id`, `status`) |
| `010_legacy_rls_strict.sql` | RLS policies — kupiec widzi sendy gdzie `status IN ('sent','opened','read','read_manual')` AND retailer_id w jego sieci |
| `013_send_lifecycle_rpcs.sql` | RPC: `mark_legacy_send_read()`, `expire_legacy_sends_14d()` |
| `018_refund_unread_expired_legacy_sends.sql` | RPC + helper functions dla refundu (ale **bez auto-cron**) |
| `027_resend_email_tracking.sql` | **Dodaje 2 kolumny:** `resend_message_id text` + `email_opened_at timestamptz`. Plus indeksy partial WHERE NOT NULL |
| `028_seen_billing_refund_guard.sql` | `refund_unread_expired_legacy_sends()` RPC — tworzy `wallet_tx` typu `refund` jeśli był charge marker |

### B.4 JSONB `data` — co tam siedzi

Pełna struktura z `data.*`:

| Pole w JSONB | Typ | Skąd | Cel |
|---|---|---|---|
| `data.status` | string | duplicate `status` enum (mirror) | Backward compat z localStorage; aktualizowany razem ze `status` |
| `data.pos` | number | admin via `updateSendPos` | Pozycja w panelu kupca (1 = top) |
| `data.sendDate` | string ISO | admin via `updateSendDate` | Planowana data wysłania (deadline) |
| `data.sentAt` | string ISO | `send-retailer-batch.js:359` | Kiedy mail faktycznie poszedł |
| `data.emailSentAt` | string ISO | `send-retailer-batch.js:359` | **Duplikat `sentAt`** dla świeżego nazewnictwa |
| `data.resendMessageIds` | string[] | `send-retailer-batch.js:361` | Array Resend message IDs (jeden mail = wiele odbiorców) |
| `data.resendBuyerEmails` | string[] | `send-retailer-batch.js:362` | Array adresów kupców do których faktycznie poszło |
| `data.daysLeft` | number | UI countdown | 14 dni od `sentAt` (real-time computed) |
| `data.readAt` | string ISO | `mark_legacy_send_read` RPC (013) | Kupiec kliknął w aplikacji |
| `data.expiredAt` | string ISO | `expire_legacy_sends_14d` RPC (013) | Kiedy auto-expirowany |
| `data.refundAt` | string ISO | `refund_unread_expired_legacy_sends` RPC (028) | Kiedy refund poszedł do walleta |
| `data.refundAmount` | number | RPC (028) | Kwota refundu |
| `data.refundTxId` | uuid | RPC (028) | FK do `wallet_tx` |
| `data.chargeAt` | string ISO | wallet logic | Kiedy opłata pobrana |
| `data.chargedAt` | string ISO | wallet logic | Alias `chargeAt` |
| `data.chargeAmount` | number | wallet logic | Kwota opłaty |
| `data.chargeTxId` | uuid | wallet logic | FK do `wallet_tx` typu `send_charge` |
| `data.billingStatus` | string | wallet logic | `"charged" \| "no_package_available" \| "waiting"` |
| `data.confirmHistory[]` | array | `confirmManual` / `undoConfirm` | Historia ręcznych potwierdzeń (typ, note, at) |

### B.5 Kolumny strukturalne dodane przez 027

```sql
alter table legacy_sends add column if not exists resend_message_id text;
alter table legacy_sends add column if not exists email_opened_at timestamptz;
```

Indeksy partial (tylko dla `NOT NULL`):
- `idx_legacy_sends_resend_message_id` — do JOIN z webhook payload
- `idx_legacy_sends_email_opened` — do dashboardów statystyk admina

---

## C. **KLUCZOWE PYTANIE** — czy panel kupca i email są rozdzielone w DB?

### C.1 Odpowiedź: ✅ **TAK, ROZDZIELONE**

Trzy niezależne stany w bazie:

| Pytanie | Źródło w DB | Wartość gdy YES |
|---|---|---|
| 1. Czy propozycja widoczna w **panelu kupca**? | `legacy_sends.status` (enum) | `status IN ('sent', 'opened', 'read', 'read_manual')` — sprawdzane przez RLS w 010 |
| 2. Czy kupiec **dostał maila**? | `data.emailSentAt` (JSONB) OR `resend_message_id` (kolumna) | `IS NOT NULL` (set przez `send-retailer-batch.js:359-361`) |
| 3. Kiedy email **faktycznie poszedł**? | `data.emailSentAt` (timestamp ISO w JSONB) | timestamp z momentu sukcesu Resend |
| 4. Czy kupiec **otworzył maila**? | `email_opened_at` (kolumna, mig 027) | Kolumna gotowa, ale **handler webhooka Resend NIE jest jeszcze zaimplementowany** (patrz §H) |

### C.2 Co znaczy `status = 'sent'`?

To znaczy **dwie rzeczy naraz** (UI tego nie rozdziela, ale DB tak):

1. **Panel kupca**: propozycja jest widoczna w PageBuyerDetail (przez RLS check)
2. **Email**: prawdopodobnie poszedł (sprawdzić przez `data.emailSentAt`)

⚠️ **Edge case**: status może być `'sent'` **bez** `data.emailSentAt`, jeśli kiedyś admin "wysłał do panelu" przed integracją Resend (legacy data). W obecnym kodzie taki edge case nie powinien występować po migracji 027, ale historyczne rekordy mogą tu być.

### C.3 Implikacja dla Pipeline 2.0

**Można zrobić tylko UX-em, bez migracji.** Plan może wprowadzić nowe nazewnictwo i osobne kolumny w UI ("Panel" / "Email") czytając z istniejących pól:

| UX state proponowany | Compute z DB |
|---|---|
| "W panelu kupca" | `status IN ('sent','opened','read','read_manual')` |
| "Email wysłany" | `data.emailSentAt != null` OR `resend_message_id != null` |
| "Email otwarty" | `status === 'opened'` OR `email_opened_at != null` |
| "Kliknął w aplikacji" | `status === 'read'` |
| "Admin potwierdził manualnie" | `status === 'read_manual'` |
| "Wygasł 14 dni" | `status === 'unread_expired'` |
| "Zrefundowany" | `status === 'refunded'` |

Optional w przyszłości: dodać kolumnę computed `email_status text` jako convenience, ale **nie wymagane** w Pipeline 2.0.

---

## D. Pipeline UI — szczegóły per zakładka

### D.1 Tab "Moderacja" (7411–7465)

**Filtr (7288):**
```js
const modSends = sends.filter(s =>
  ["pending_moderation", "approved", "queued"].includes(s.status)
);
```

⚠️ **Mieszane semantyki**: `approved` to "admin zatwierdził, czeka na wysłanie" — ale renderuje się tu razem z `pending_moderation`. Admin musi mentalnie rozróżnić "co czeka na decyzję" vs "co czeka na wysłanie".

**Grouping (7317):** po `retailerId` → każda sieć dostaje własną kartę. Karta składa się z:
- Header: logo sieci, nazwa, count sendów, count pending
- Lista sendów (collapsible, expand by default jeśli są pending)
- Per send: input `pos`, status badge, tier badge, tytuł oferty, input `sendDate`, przyciski `Preview` `Approve` `Reject`

**Akcje per send:**
- `updateSendPos(s.id, value)` — patch `data.pos` lokalnie (i DB via bulk upsert)
- `updateSendDate(s.id, value)` — patch `data.sendDate`
- `moderate(s.id, "approve")` → status → `approved`
- `moderate(s.id, "reject")` → status → `rejected`

**Brak bulk akcji.**

### D.2 Tab "Wysłane & Tracking" (7468–7565)

**Filtr (7289):**
```js
const sentSends = sends.filter(s =>
  ["sent", "opened", "read", "read_manual"].includes(s.status)
);
```

⚠️ **Brak filtru po retailer, brak filtru po status w obrębie tabu.** Admin widzi miks wszystkich sieci + wszystkich post-wysyłkowych statusów w jednym strumieniu.

**Trzy podsekcje:**

#### D.2a "Propozycje w panelu bez e-maila" (7474–7493)

Sub-filter: `emailablePanelSends = sentSends.filter(canEmailRetailerSend)` (7313)

`canEmailRetailerSend()` (PreconnectFM.jsx:899-900):
```js
function canEmailRetailerSend(s) {
  return ["approved", "sent"].includes(s.status) && !hasRetailerEmailMarker(s);
}
```

`hasRetailerEmailMarker()` (PreconnectFM.jsx:883-898):
```js
function hasRetailerEmailMarker(s) {
  return !!(s.emailSentAt ||
            s.data?.emailSentAt ||
            s.email_sent_at ||
            (s.resendMessageIds||[]).length > 0 ||
            (s.data?.resendMessageIds||[]).length > 0 ||
            (s.resendBuyerEmails||[]).length > 0);
}
```

⚠️ **Bug logiczny w nazewnictwie**: sekcja nazywa się "Propozycje w panelu bez e-maila", ale faktyczny filtr łapie też `status='approved'` (które jeszcze NIE są w panelu kupca). Czyli sekcja miesza "approved czekające na wysłanie" + "sent w panelu ale bez maila".

**Akcje:** klik `[E-mail]` per sieć → `setEmailPreview({retailer, sends})` (7486) → otwarcie `EmailNewsletterModal`.

#### D.2b "Rozliczenia dostawców" (7494–7535)

`settlementRows` (7324) — mapuje `sentSends`:

| Pole row | Compute |
|---|---|
| `charged` | `hasChargeMarker(s)` — sprawdza `chargeAt / chargeTxId / billingStatus='charged'` |
| `seen` | `isSeenOrCharged(s)` — `status IN ('opened','read','read_manual')` OR `charged` |
| `amount` | `getChargeAmount(s, fallback)` — z `data.chargeAmount` / `s.price` / pakiet planu |
| `billingStatus` | `data.billingStatus` lub computed |

Per supplier grouping (7340) → karta z:
- Counter "Rozliczone X" (charged=true)
- Counter "Czeka X" (charged=false)
- Top 4 sendy z tego suppliera (reszta schowana)
- Badge per send: `"Rozliczona 40 EUR"` (green) / `"Brak pakietu"` (red) / `"Czeka"` (orange)

#### D.2c Per-send tracking cards (7536–7564)

Po sekcjach 3a + 3b idą **wszystkie** `sentSends` jako kolorowe karty:
- Kolor border: `sent`→orange, `opened`→purple, `read`→green, `read_manual`→dark green
- Per karta: retailer logo, offer title, retailer name, sentAt timestamp
- Progress bar: jeśli `status === 'sent'` → `daysLeft` z 14
- Badge statusu
- Forma `ConfirmForm` jeśli `status === 'sent' && !isSeenOrCharged` — admin może ręcznie potwierdzić kontakt (phone / email / meeting)
- History button (Clock icon) → modal `confirmHistory`
- Undo button jeśli już potwierdzone

### D.3 Brakuje (w obu tabach)

- ❌ Bulk select / bulk action
- ❌ Filter per retailer
- ❌ Filter per status w obrębie tabu
- ❌ Sortowanie kolumn (po dacie, sieci, dostawcy, kwocie)
- ❌ Search po tytule oferty / dostawcy / sieci
- ❌ Pagination / virtualization
- ❌ Export CSV
- ❌ Last-email-to-this-buyer indicator (admin nie wie ile maili dziś poszło do tego kupca)

---

## E. Skala — performance

### E.1 `loadLegacySends()` — ładuje WSZYSTKO (db.js:976-985)

```js
export async function loadLegacySends() {
  const { data, error } = await supabase
    .from("legacy_sends")
    .select("data")
    .order("legacy_id", { ascending: true });
  if (error) {
    console.warn("[loadLegacySends]", error.message);
    return null;
  }
  return (data || []).map((r) => r.data);
}
```

⚠️ **Brak paginacji, brak limit, brak server-side filter.** Wszystko ląduje w App-level state i jest filtrowane client-side.

### E.2 Renderowanie

Per render PageAdminPipeline:
1. `sends.filter(...)` × 2 — całość przelatuje przez filter
2. `sends.map(...)` w `settlementRows` — całość przelatuje przez map
3. JSX render per sentSends → **N kart** (gdzie N = wszystkie sendy z post-wysyłki)

**Szacowanie:**
| Liczba sendów | Czas filter+map | Czas DOM render | UX status |
|---|---|---|---|
| ~10 (dzisiaj demo) | <1 ms | <50 ms | OK |
| 100 | ~5 ms | ~300 ms | Akceptowalny |
| 500 | ~25 ms | ~2 s | **Wolny** — admin czeka 2s na każdy refresh |
| 1000 | ~50 ms | ~5 s | **Nieużywalny** — przeglądarka się dławi |
| 5000 (3-letnia historia) | ~250 ms | crash | Nie działa |

### E.3 Verdict dla Pipeline 2.0

**Wirtualizacja LUB server-side pagination MUSI być w architekturze od pierwszego brancha kodowego.** Tabela jest tania do wirtualizacji (single row height), karty są drogie. To dodatkowy argument za **tabela > karty** od początku.

Opcja minimalna: paginacja "Załaduj kolejne 50" + ograniczenie initial query (server-side filter po status / retailer_id przy load).

---

## F. Tracking 14 dni

### F.1 Alert UI

W zakładce Moderacja (7421) + Wysłane (7469) widoczny alert i18n: `admin.pipeline.alert_pending_html_{one|few|many|other}` — "X propozycje czekają na potwierdzenie odczytu (14 dni)".

### F.2 RPC `expire_legacy_sends_14d` (013, linie 75-123)

```sql
-- Pseudo:
-- WHERE status = 'sent' AND now() > sent_at + interval '14 days'
-- UPDATE status = 'unread_expired', data.status = 'unread_expired', data.expiredAt = now()
```

### F.3 Refund RPC `refund_unread_expired_legacy_sends` (028, linie 10-102)

```sql
-- Pseudo:
-- WHERE status = 'unread_expired' AND data.refundAt IS NULL AND hasChargeMarker(data)
-- INSERT wallet_tx (type='refund', amount=data.chargeAmount, supplier_id, ref_send_id)
-- UPDATE data.refundAt = now(), data.refundAmount, data.refundTxId
```

### F.4 ⚠️ BRAK auto-trigger

- ❌ **Brak pg_cron** dla `expire_legacy_sends_14d()`
- ❌ **Brak pg_cron** dla `refund_unread_expired_legacy_sends()`
- ✅ Funkcje dostępne w db.js: `expireLegacySends14d()`, `refundUnreadExpiredLegacySends()`
- ❓ Kto i kiedy je wywołuje? — sprawdzenie poza zakresem auditu (prawdopodobnie admin button albo Netlify scheduled function — patrz follow-up)

**Implikacja dla Pipeline 2.0:** jeśli te RPC są niedostępne dla admina przez wyraźny button (np. "Wykonaj refund nieodczytanych"), warto dodać. Inaczej dostawcy nie dostają refundów automatycznie.

---

## G. Mailing flow — KOMPLETNY przepływ end-to-end

### G.1 Krok 1: UI trigger w `EmailNewsletterModal`

`doSend()` (PreconnectFM.jsx:8882):
- Zbiera `selectedIds` (user-selected send IDs)
- Wywołuje `dbSendRetailerBatch({ retailer_id, send_ids })`

### G.2 Krok 2: db.js wrapper (db.js:1513-1525)

```js
export async function sendRetailerBatch({ retailer_id, send_ids, dry_run = false }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  const res = await fetch("/.netlify/functions/send-retailer-batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ retailer_id, send_ids, dry_run }),
  });
  return await res.json();
}
```

### G.3 Krok 3: Netlify function `send-retailer-batch.js`

**Auth (112-133):** sprawdza JWT + role=`admin`.

**Filter eligible sends (174-190):**
```sql
SELECT * FROM legacy_sends
WHERE legacy_id IN (send_ids)
  AND retailer_id = $1
  AND status IN ('approved', 'sent')
  AND NOT (hasRetailerEmailMarker compute)
```

**Load context (192-233):**
- `legacy_offers` JOIN po `offer_legacy_id`
- `companies` JOIN po `legacy_supplier_id` (fallback po `id` UUID)

**Load buyers (156-166):**
```sql
SELECT p.* FROM profiles p
JOIN retailers r ON r.id = $retailer_id
WHERE p.role = 'buyer'
  AND p.active = true
  AND p.email IS NOT NULL
  AND p.retailer_id = r.id
```

**Render HTML (245-258):**
- Per locale (PL vs EN per kupiec)
- Funkcja `renderRetailerEmail()` z `_shared/render-retailer-email.js`
- Zwraca `{ html, subject, month }`

**Wysyłka przez Resend (277-327):**
- Loop po `activeBuyers` (sequential)
- Per buyer: `POST https://api.resend.com/emails` z `{ from, to: [buyer.email], subject, html }`
- Zbiera `resendResults[]`

**Aktualizacja DB (329-368):**
```sql
UPDATE legacy_sends
SET status = 'sent',
    data = data || jsonb_build_object(
      'status', 'sent',
      'sentAt', $now,
      'emailSentAt', $now,
      'resendMessageIds', $messageIds,
      'resendBuyerEmails', $emails
    ),
    resend_message_id = $firstMessageId
WHERE legacy_id IN (eligible_ids)
```

**Notify supplier (370-445):**
- Opcjonalny email do dostawcy (template `tplOffersSentToRetailer`)
- Fire-and-forget — jeśli padnie, nie blokuje response

### G.4 Response shape

```json
{
  "ok": true,
  "sent_count": 8,
  "buyer_count": 3,
  "buyers_succeeded": ["buyer1@x.com", "buyer2@y.com"],
  "buyers_failed": [],
  "send_ids_marked": [1234, 1235, ...],
  "subject": "...",
  "subjects_by_locale": { "pl": "...", "en": "..." }
}
```

### G.5 Krok 4: UI po sukcesie (`onSent` callback, 7363-7388)

Lokalna mutacja `sends` state — przelicza po stronie klienta że status=`sent`, dopisuje `sentAt`, `emailSentAt`, `daysLeft=14`, `resendBuyerEmails`. Modal się auto-zamyka po 1.5s.

### G.6 ⚠️ Ryzyka duplikacji

`canEmailRetailerSend` filtruje po `!hasRetailerEmailMarker`. Ale:
- Jeśli send-retailer-batch padnie po wysłaniu Resend ALE przed UPDATE DB → marker NIE zostanie zapisany → admin może wysłać ponownie → **2× mail do kupca**.
- **Brak idempotency key** w request payload.
- **Brak retry logic** w db.js.

---

## H. Tracking maila (Resend webhooks)

### H.1 Co istnieje

- ✅ `notify-supplier-read.js` (Netlify function) — ale to **NIE** jest webhook od Resend. To call z frontendu gdy kupiec kliknie w aplikacji → `markLegacySendRead` RPC (013, linie 23-70).
- ✅ Kolumna `resend_message_id` (mig 027) — wypełniana po wysłaniu.
- ✅ Kolumna `email_opened_at` (mig 027) — gotowa do populacji, **ale nikt jej nie populuje**.
- ✅ Komentarz w mig 027 opisuje docelowy flow webhook'a Resend.

### H.2 ❌ CZEGO BRAKUJE

- **Brak handler'a webhooka Resend** (np. `netlify/functions/resend-webhook.js`). Pole `email_opened_at` jest nieużywane w produkcji.
- Implikacja: status `'opened'` w UI **nigdy się nie pojawi** dopóki nie ma webhooka.
- W tej chwili UI ma kod renderujący `opened` (kolor purple), ale ten branch jest dead — bo żaden send nigdy nie ma `status='opened'`.

### H.3 Implikacja dla Pipeline 2.0

To nie jest scope Pipeline 2.0 UX redesign. To **osobny ticket** — `feat/resend-open-webhook` — który włącza istniejącą infrastrukturę. Plan Pipeline 2.0 powinien założyć że `email_opened_at` jest **opcjonalny** dziś i pokazywać go gdy istnieje.

---

## I. Lista UX problemów obecnego widoku

### I.1 Karty zamiast tabeli

- Per-sieć karty w Moderacja: OK przy 5-10 sieciach, mordercze przy 30+
- Per-send karty w Tracking: 1 karta = ~150px wysokości → 100 sendów = 15000px scroll. Brak gęstości info.
- **Rekomendacja:** tabela z gęstym layoutem (1 rząd = 1 send = 40-60px)

### I.2 Za dużo kolorów

Status badge: amber/green/red/orange/teal/purple/dark-green — admin ma trudność rozróżnić "co wymaga uwagi" vs "wszystko OK".

**Rekomendacja:** kolor tylko jako ALARM (czerwony=problem, pomarańczowy=czeka, zielony=zrobione). Reszta neutralna.

### I.3 Mieszanie panelu kupca z e-mailem

W status `'sent'` UI nie rozróżnia:
- "Propozycja jest w panelu kupca + mail wysłany"
- "Propozycja jest w panelu kupca + mail jeszcze NIE wysłany" (legacy data)

**Rekomendacja:** osobne kolumny w tabeli:
- Kolumna "Panel" — boolean / data
- Kolumna "Email" — boolean / data
- Kolumna "Odczyt" — najnowszy z `opened/read/read_manual` lub `—`

### I.4 Rozliczenia w tym samym widoku co tracking

"Wysłane & Tracking" miesza:
- Operacyjny widok "co czeka na odczyt 14d" (action: nudge kupca)
- Operacyjny widok "co rozliczyć" (action: settlement / refund)

**Rekomendacja:** osobne zakładki **Tracking** (odczyty, 14d, nudge) i **Rozliczenia** (charge/refund/wallet_tx).

### I.5 Brak koszyka mailingowego

Admin może wysłać "wszystko co czeka" per sieć, ale **nie** może:
- Wybrać konkretne propozycje do nadzwyczajnego mailingu (np. mid-month, ad-hoc)
- Zaplanować mailingu (data wysyłki, batch)
- Zobaczyć "co jest w koszyku" zanim wyśle (modal wymusza decyzję na 1 ekranie)

**Rekomendacja:** osobna zakładka **Mailing** z koszykiem persistent — admin dodaje propozycje do koszyka, potem wysyła zbiorczo.

### I.6 Brak bulk actions

Nie można:
- Zaznaczyć N propozycji → approve wszystkie
- Zaznaczyć N propozycji → reject wszystkie
- Zaznaczyć N propozycji → dodaj do mailingu
- Zaznaczyć N propozycji → potwierdź odczyt ręcznie

**Rekomendacja:** checkbox per row + sticky bulk action bar.

### I.7 Brak search / filter / sort

Brakuje:
- Search po nazwie produktu, dostawcy, sieci
- Filter po retailer, supplier, status, billingStatus
- Sort po dacie wysłania, dacie deadline, kwocie, %% odczytów

**Rekomendacja:** tabela z header sortable + global search + filter panel.

### I.8 Brak eksportu CSV

Admin nie może wyciągnąć listy do arkusza (np. dla księgowości, mailingu masowego, raportowania).

**Rekomendacja:** `[Pobierz CSV]` w toolbarze tabeli — exportuje current view (po filtrach).

### I.9 Brak widoczności kiedy ostatnio wysłano

Kolumna `data.emailSentAt` istnieje, ale nie jest pokazana w UI. Admin nie wie:
- Czy do tej sieci już dzisiaj poszło?
- Czy do tego kupca już dzisiaj poszło?
- Kiedy ostatnio rozsyłaliśmy hurtowo do Auchan?

**Rekomendacja:** kolumna "Email wysłany" z timestampem + indicator "Dzisiaj X maili do tej sieci".

### I.10 Brak idempotency

Patrz §G.6 — admin może wysłać 2× ten sam batch po crashu Netlify function.

**Rekomendacja:** idempotency key w request (hash retailer_id + sorted send_ids + admin_id) + DB constraint.

### I.11 Performance — brak paginacji

Patrz §E — przy 500+ rekordach UI staje się wolny. Branch 1 Pipeline 2.0 **musi** mieć paginację albo wirtualizację.

### I.12 Brak alarmu "kupiec nie odpowiada N tygodni"

`unread_expired` zostaje w tle, ale admin musi sam ręcznie sprawdzić "kto z kupców systematycznie ignoruje maile". Brak agregowanego widoku per kupiec.

**Rekomendacja:** osobny dashboard w Tracking → "Top 10 kupców z najgorszym open rate".

---

## J. Powiązania z Companies 2.0

| Komponent Companies 2.0 | Reuse w Pipeline 2.0 |
|---|---|
| `<AdminRightDrawer>` z subtabami (Branch 2 Companies) | Drawer dla detali propozycji (Branch 2 Pipeline) — JEŚLI wydzielony jako reusable component, nie inline |
| Feature flag pattern (`src/config/features.js`) | Dokładamy `ADMIN_PIPELINE_2_0_*` flags |
| Tab UI pattern (5 tabów z counter badges) | 4 taby Pipeline (Moderacja / Mailing / Tracking / Rozliczenia) |
| `useTranslation("legacy")` + klucze pod `admin.pipeline.*` | Już istnieją z P2-pipeline (linia 1728+ w `legacy.json`) — dokładamy rozszerzenia |
| Helper `copyContact` | Możliwy reuse dla copy email/phone kupca w drawerze propozycji |
| Conditional render path (`if (FLAG) return <V2/>;`) | Ten sam wzorzec |

### J.1 Wymaganie dla Companies Branch 2

Plan Pipeline 2.0 zakłada że Companies Branch 2 **wydzieli drawer jako reusable**:
```js
// src/components/admin/AdminRightDrawer.jsx (proponowane)
export function AdminRightDrawer({ open, onClose, header, footer, tabs, activeTab, onTabChange, children, onPrev, onNext })
```

Jeśli Companies Branch 2 zrobi drawer inline w `PageAdminFirmy`, Pipeline 2.0 Branch 2 będzie musiał najpierw refactor wydzielający go. To dodaje ~1 commit do Pipeline Branch 2.

**Rekomendacja:** dopisać do Companies Branch 2 acceptance: "drawer jako exportable component w `src/components/admin/`".

---

## Summary stats

| Aspect | Liczba | Notes |
|---|---|---|
| Linie PageAdminPipeline | ~287 | 7282-7568 |
| Linie EmailNewsletterModal | ~210 | 8791-9000+ |
| State variables | 6 | tab, autoOpenedTracking, expandedRetailers, previewOffer, historyId, emailPreview |
| Major functions wywołane | 5 | moderate, sendApproved, updateSendDate, updateSendPos, confirmManual, undoConfirm |
| `send_status` enum values | 10 | queued/pending_moderation/approved/rejected/sent/opened/read/read_manual/unread_expired/refunded |
| DB tables tknięte | 5 | legacy_sends, legacy_offers, companies, retailers, profiles |
| Netlify functions w flow | 2+ | send-retailer-batch, notify-supplier-read |
| Migracje SQL dotyczące pipeline'u | 6 | 001, 004, 010, 013, 018, 027, 028 |
| Zakładki obecne | 2 | Moderacja, Wysłane & Tracking |
| Filtry per zakładka | 0 | brak filtru po retailer/status w obrębie tabu |
| Sortowanie | brak | ❌ |
| Search | brak | ❌ |
| Pagination / virtualization | brak | ❌ (loadLegacySends ładuje WSZYSTKO) |
| Bulk actions | brak | ❌ |
| Export CSV | brak | ❌ |
| Idempotency guard | brak | ❌ (możliwe duplikaty maili) |
| Resend open webhook handler | brak | ❌ (kolumna gotowa, handler nie) |
| Pg_cron dla expire/refund | brak | ❌ (RPC są, auto-trigger nie) |

---

## Top 10 obserwacji dla redesignu Pipeline 2.0

1. **Panel/email JEST rozdzielone w DB** — Pipeline 2.0 można zrobić **tylko UX-em, bez migracji**. To dobre.
2. **`status='sent'` semantycznie miesza** dwa stany — UI powinno rozdzielić "Panel" i "Email" jako dwie kolumny.
3. **`loadLegacySends` ładuje całość** — wirtualizacja LUB server-side paginacja **MUSI** być w Branch 1, nie później.
4. **Karty mordercze przy 500+ sendach** — tabela jest jedyną opcją skali.
5. **Brak bulk select** — admin nie może działać operacyjnie przy dużym wolumenie.
6. **Brak filtru per retailer/status/supplier** — najbardziej basic CRM-feature, fundamentalne dla pracy.
7. **Mailing jako koszyk persistent** zamiast ad-hoc modal — admin powinien móc kompletować maila przez dzień, wysłać kiedy gotowy.
8. **Rozliczenia powinny być osobnym tabem** — miks z trackingiem mylił admina.
9. **Idempotency w wysyłce** — krytyczne dla zaufania (admin nie może bać się klikać "Wyślij").
10. **Resend open webhook** — to osobny ticket (`feat/resend-open-webhook`), poza scope Pipeline 2.0 UX.

---

## Open questions (do planu)

1. **Kto teraz wywołuje `expire_legacy_sends_14d` i `refund_unread_expired_legacy_sends`?** Jeśli nikt — to bug produkcyjny (dostawcy nie dostają refundów). Pipeline 2.0 może dodać explicit button dla admina, ale nie zastąpi cron'a.
2. **Realny wolumen sendów dzisiaj i prognoza 12mc?** Decyduje o wyborze: pagination 50/page vs wirtualizacja.
3. **Czy `email_opened_at` ma jakikolwiek populator** poza planowanym webhookiem Resend?
4. **Czy są jakieś `data.emailSentAt` w produkcji bez `resend_message_id`** (legacy)? Wpływa na backward compat.

---

## Sign-off

Audit gotowy do plan stage. Następny dokument: `ADMIN_PIPELINE_2_0_PLAN.md` z architekturą 4 tabów, koszykiem mailingu, tabelą + filtrami, planem 4-5 sekwencyjnych branchy kodowych.
