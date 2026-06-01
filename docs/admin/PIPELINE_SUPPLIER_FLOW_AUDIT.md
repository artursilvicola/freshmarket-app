# Pipeline — pełna ścieżka propozycji: dostawca → moderacja → panel kupca → e-mail → odczyt

**Branch:** `feat/pipeline-supplier-flow-audit-polish`
**Status:** Audit + małe poprawki statusów. Bez migracji, RLS, PayU, mail templates, auto-wysyłki.
**Cel:** zmapować pełny przepływ statusów `legacy_sends` tak, by admin i dostawca widzieli ten sam sens, i naprawić miejsca, gdzie status `opened` był pomijany u dostawcy.

Numery linii względem `src/legacy/PreconnectFM.jsx` na `main` w momencie audytu (`29518ae`).

---

## 1. Ścieżka — tabela „kto klika / co widzi / status w DB / gdzie potem widać"

| # | Kto klika | Akcja w UI | Status w `legacy_sends` (DB) | Gdzie to potem widać |
|---|---|---|---|---|
| 1 | Dostawca | Zapisuje propozycję (oferta) | — (oferta w `legacy_offers`: `draft` / `active`) | PageOffers dostawcy |
| 2 | Dostawca | „Wyślij do sieci" | `pending_moderation` | Admin Pipeline tryb **Do moderacji**; dostawca PageWysylki tab „W moderacji" |
| 3 | Admin | **Zatwierdź** | `pending_moderation` → `approved` | Pipeline mod: status „Gotowe do panelu"; dostawca: „Zatwierdzona" |
| 3b | Admin | **Odrzuć** | `pending_moderation` → `rejected` | Pipeline / dostawca: „Odrzucona" |
| 4 | Admin | **Wyślij zatwierdzone do panelu kupca** (`sendApproved`) | `approved` → `sent` | Panel kupca (propozycja widoczna); Pipeline tryb **Wysłane/mailing** |
| 5 | Admin | **(opcjonalnie) koszyk e-mail** → „Wyślij e-mail do tej sieci" (`send-retailer-batch`) | `sent` pozostaje; marker `data.emailSentAt` + `resend_message_id` | Pipeline: kolumna **E-mail = Wysłany**; status panelu bez zmian |
| 6 | Kupiec | Otwiera maila (Resend webhook) | `sent` → `opened` | Panel kupca; dostawca: „Odczytana" (po tym fixie) |
| 7 | Kupiec | Otwiera ofertę w aplikacji | `sent`/`opened` → `read` (lub `read_manual` gdy admin potwierdzi ręcznie) | Dostawca: „Odczytana ✓"; rozliczenie kredytu/pakietu |
| 8 | System | 14 dni bez odczytu | `sent` → `unread_expired` (+ ewentualnie `refunded`) | Dostawca: „Wygasła / zwrot" |

**Kluczowe rozróżnienia (nigdy nie mieszać):**
- **`approved` ≠ „w panelu kupca".** approved = zaakceptowane przez moderację, ale kupiec NIE widzi. Dopiero `sendApproved` (`approved → sent`) pokazuje w panelu.
- **„w panelu kupca" ≠ „e-mail wysłany".** Panel = status (`sent`+). E-mail = osobny marker `data.emailSentAt` / `resend_message_id`. Propozycja może być w panelu bez wysłanego e-maila.
- **`opened` = kupiec otworzył e-mail** (Resend tracking). To już „zobaczone", liczone razem z `read`/`read_manual`.

---

## 2. Statusy widoczne dla kupca (panel)

`STATUS_VISIBLE` (linia ~6389) + `PANEL_STATUSES` (PipelineTableV2, linia ~7405 po fix f2e0927):
```
sent, opened, read, read_manual, unread_expired, refunded
```
`approved` / `pending_moderation` / `queued` / `rejected` — **NIE widoczne dla kupca**.

---

## 3. Audyt widoków dostawcy — znalezione braki (`opened` pomijany)

Status `opened` (kupiec otworzył maila przez Resend) był **poprawnie** obsłużony w panelu admina i kupca, ale **konsekwentnie pomijany** w widokach dostawcy — przez co otwarte maile znikały ze statystyk i historii. Naprawione w tym branchu:

| Linia | Miejsce | Było | Jest (fix) |
|---|---|---|---|
| 3691 | PageDashboard — `stSeen` (zobaczone 30d) | `["read","read_manual"]` | `["opened","read","read_manual"]` |
| 3692 | PageDashboard — `stExpired` | `s.status==="expired"` (zły enum!) `\|\| "refunded"` | `["unread_expired","refunded"]` |
| 4303 | PageWysylki — tab „Wysłane" filtr | `["sent","read","read_manual"]` | `["sent","opened","read","read_manual"]` |
| 4350 | PageWysylki — sieci stats `sent` | `["sent","read","read_manual"]` | `+opened` |
| 4351 | PageWysylki — sieci stats `read` | `["read","read_manual"]` | `+opened` |
| 4459 | PageWysylki — history tab „Wysłane" licznik | `["sent","read","read_manual"]` | `+opened` |
| 5059 | PageOffers — KPI „odczytane" przy ofercie | `["read","read_manual"]` | `+opened` |

**Bug uboczny (linia 3692):** użyto literału `"expired"`, którego nie ma w enumie (poprawny: `unread_expired`) — licznik wygasłych na dashboardzie praktycznie nie działał. Naprawione.

---

## 4. Koszyk e-maili — kwalifikacja (kluczowa decyzja)

**Wymaganie biznesowe (Codex):** koszyk mailingu przyjmuje TYLKO propozycje już w panelu kupca i bez wysłanego e-maila — najpierw panel, potem miesięczny mail.

**Było:** `basketEligible = inPanel && !emailSent` — za szeroko (`inPanel` obejmuje też `opened/read/read_manual/unread_expired/refunded`).

**Jest (fix, linia ~7427):** `basketEligible = s.status === "sent" && !emailSent`.
- `approved` — NIE (to wysyłka do panelu, nie e-mail; admin nie może mylić),
- `opened`/`read`/`read_manual` — NIE (kupiec już widział, mail po fakcie bez sensu),
- `unread_expired`/`refunded` — NIE (zamknięte).

**Backend `send-retailer-batch`:** technicznie nadal dopuszcza `["approved","sent"]` (`canEmailRetailerSend`, linia 904) — **świadomie nie zmieniane** (poza scope, bez ryzyka, bo UI nie wystawia approved do koszyka, a marker `inEmailBasket` ląduje tylko na `sent`). Gdyby w przyszłości zacieśniać też backend → osobny krok z testem.

---

## 5. Co NIE zostało zmienione (guardraile)

Bez: migracji SQL, zmian RLS, zmian PayU, zmian mail templates, automatycznej wysyłki/cron, flipu flagi koszyka na produkcji (`ADMIN_PIPELINE_2_0_MAILING_BASKET` zostaje `false`), zmian w `send-retailer-batch` (tylko ewentualny komentarz). Flaga `ADMIN_PIPELINE_2_0_TABLE` zostaje `true`.

---

## 6. Acceptance (ścieżka end-to-end)

1. Dostawca wysyła propozycję → `pending_moderation` → widzi „W moderacji".
2. Admin zatwierdza → `approved` → „Gotowe do panelu".
3. Admin „Wyślij zatwierdzone do panelu kupca" → `sent` → kupiec widzi w panelu.
4. Koszyk e-maili pokazuje tylko `sent` bez wysłanego e-maila.
5. Kupiec otwiera maila → `opened` → dostawca widzi jako „Odczytana" (po tym fixie).
6. Kupiec otwiera ofertę → `read` → rozliczenie + dostawca widzi odczyt.
