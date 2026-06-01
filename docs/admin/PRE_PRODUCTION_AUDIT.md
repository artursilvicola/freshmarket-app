# Audyt przedprodukcyjny — Fresh Market B2B

**Branch:** `audit/pre-production-check`
**Metoda:** mechaniczne checki (build / node --check / i18n symetria / flagi / PL-leftovers) + 4 równoległe deep-read audyty (routing+dostawca, Pipeline+koszyk, kupiec+firmy, maile/functions) + samodzielna weryfikacja spornych punktów.
**Zakres `main`:** stan po moderation-mode + supplier-flow + auth-recovery.

---

## Mechaniczne checki — wynik

| Check | Wynik |
|---|---|
| `npm run build` | ✅ 1594 modules, zielony |
| `node --check` × 15 Netlify functions | ✅ wszystkie OK |
| i18n leaf symetria | ✅ legacy 2297=2297, auth 136=136, common 62=62, panel 11=11 |
| `admin.json` istnieje? | ✅ NIE (namespace `legacy`) |
| PL-leftovers w EN UI | ✅ brak realnych (12 trafień = imię „Oksana Kozłowska", bilingual switcher, `_meta._note` — false positives) |
| Feature flags | ⚠️ patrz P1-flags niżej |

---

## Raport problemów

### P0 — blokery produkcji
**BRAK.** Żaden przepływ krytyczny (dostawca→moderacja→panel→e-mail→odczyt) nie ma blockera. Maile filtrowane po `retailer_id` + status + anti-duplicate; kupiec nie widzi `approved`; routing role-aware; recovery z no-role działa.

### P1 — ważne przed startem

| # | Gdzie | Problem | Jak odtworzyć | Wpływ | Fix | DB? |
|---|---|---|---|---|---|---|
| P1-flags | `src/config/features.js` | Stan flag do świadomej decyzji przed prod: `ADMIN_PIPELINE_2_0_TABLE=true` (tabela live), `ADMIN_PIPELINE_2_0_MAILING_BASKET=true` (koszyk live — w trakcie audytu flipnięty na true w working tree). Companies: `DRAWER=false`, `FILTERS=false`. | — | Jeśli koszyk ma iść na prod — OK; jeśli nie — przed merge ustawić `MAILING_BASKET=false`. **To decyzja Artura, nie bug.** | ustawić wartość flagi | nie |

### P2 — poprawki UX / hardening

| # | Gdzie | Problem | Wpływ | Fix | DB? |
|---|---|---|---|---|---|
| P2-basket-guard | `openRetailerEmailFromBasket` (~8036) | `canEmailRetailerSend` dopuszcza `approved`; teoretycznie e-mail mógłby pójść za propozycję spoza panelu. W praktyce nieosiągalne (checkbox koszyka tylko dla `sent`), ale brak jawnego guardu na ścieżce wysyłki. | Defense-in-depth | **NAPRAWIONE w tym branchu:** dodany `s.status === "sent"` w filtrze basketSends. | nie (frontend) |
| P2-supplier-limit-refresh | `pkgMax` (~2755) | Limit dostawcy czyta z `dbCapacity` (company_capacity) z fallbackiem na `limits`. Admin `updateLimit`→`refreshCapacity` aktualizuje to źródło, ale dostawca nie ma live-push — widzi nowy limit po odświeżeniu/re-login. | Niski — dostawca i tak odświeża | (opcjonalnie) realtime/refetch po stronie dostawcy. Nie blocker. | nie |
| P2-debug-logs | `mark-buyer-preconnect-seen.js:71`, `_shared/supplier-read-notify.js:152` | `console.log` debugowe w prod (w try/catch, nieszkodliwe). | Kosmetyka/logi | usunąć przed prod. | nie |

### OK — sprawdzone i działa

| Obszar | Wynik |
|---|---|
| **Routing** /admin→PageAdminDash, /dostawca, /kupiec, no-role recovery, account switcher role-aware | ✅ |
| **Dostawca** tworzenie oferty (draft/active) → `sendToChain` → `pending_moderation`; statusy odróżnione (approved#2563eb vs pending#ca8a04) | ✅ |
| **Dostawca** `pkgMax` z company_capacity (nie ze starych `limits`) — sync z adminową zmianą działa po refetch | ✅ (P2 wyżej = tylko brak live-push) |
| **Admin Pipeline** tryb moderacji (auto-switch + modeTouchedRef), Zatwierdź/Odrzuć tylko pending/queued, „Gotowe do panelu" + „Wyślij zatwierdzone do panelu kupca (N)"→sendApproved | ✅ |
| **Admin Pipeline** track: search/filtry/CSV/paginacja; kolumny Panel/E-mail/Odczyt/Rozliczenie rozdzielone | ✅ |
| **Koszyk** `basketEligible = sent && !emailSent`, checkbox tylko track+eligible, round-trip JSONB, grupy per sieć, „Wyślij e-mail do tej sieci" zawężony do koszyka, `handleEmailSent` czyści koszyk, drugi wtorek miesiąca, zero auto-wysyłki | ✅ |
| **Kupiec** widzi tylko `sent/opened/read/read_manual/unread_expired` swojej sieci; NIE widzi `approved`; privacy guard (buyerRetailerId); logo+profil+szczegóły; odczyt→`markBuyerPreconnectSeen` | ✅ |
| **Admin Firmy** 5 tabów statusów, kontakt+copy+mailto/tel, `updateLimit`→`dbAdminSetCompanyPackage`→`refreshCapacity`, filtr per status, fallback bez FILTERS/DRAWER | ✅ |
| **Maile** `send-retailer-batch`: explicit `send_ids`, filtr `retailer_id`+status+anti-duplicate, tylko aktywni kupcy, mail tylko z przekazanych sendów, idempotency; `resend-webhook` event→opened; `mark-buyer-preconnect-seen` sent/opened→read; magic link dynamiczny | ✅ |
| **i18n** symetria 4 namespace, brak admin.json, brak realnych PL-leftover | ✅ |

---

## Decyzja

**READY FOR PRODUCTION — warunkowo.**

Brak P0. Brak realnych P1 (jedyny P1 to **decyzja Artura o stanie flagi koszyka** — nie bug). Jeden P2 (basket guard) naprawiony w tym branchu. Pozostałe P2 (debug logi, supplier limit live-push) są kosmetyczne i nie blokują startu.

**Przed merge na prod — 1 decyzja:**
- `ADMIN_PIPELINE_2_0_MAILING_BASKET`: zostaje `true` (koszyk live) czy wraca na `false` (ukryty do osobnego flipu)? Aplikacja działa w obu przypadkach.
