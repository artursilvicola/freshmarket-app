# P2-3 supplier dashboard — audit (FAZA A)

**Status:** audit only, **zero zmian w kodzie**. Czeka na review Codexa zanim implementacja FAZA B.

Branch: `feat/i18n-p2-3-supplier-dashboard` · Baseline: `main` po `v-i18n-buyer-flow` (commit `95fc316` + docs `a0a1e5f`).

## Cel audytu

Po decyzji "P2-2d anulowane" (CompanyPreviewModal jako shared) potrzebujemy pewności że P2-3 nie powtórzy błędu scope. **Każdy komponent supplier dashboard musi być zweryfikowany — czy jest supplier-only, czy shared.**

## Metodologia

1. Grep wszystkich nazw komponentów z planu P2-3 (PageDashboard + 8 widgetów + helpery):
   ```
   PageDashboard, pickSupplierDashState, NextStepCard, PkgCard,
   NextWindowCard, KpiRow, ActivityCard, FmCompactCard,
   OnboardingChecklist, HelpStripDashboard
   ```
2. Plus helper `pluralDni` (polskie liczebniki dnia, używany w 3 widgetach).
3. Dla każdego — lista wszystkich miejsc użycia (callers).
4. Klasyfikacja:
   - **supplier-only** — używany tylko przez supplier dashboard → bezpieczne do bilingualizacji w P2-3
   - **shared** — używany też przez supplier/admin/buyer/FM → wymaga osobnej decyzji (jak `CompanyPreviewModal`)

## Wyniki audytu

### Wszystkie 9 komponentów: **SUPPLIER-ONLY** ✅

| Komponent | Linia | Liczba call sites | Lokalizacja | Klasyfikacja |
|---|---|---|---|---|
| `PageDashboard` | 3347 | 1 | `App()` render switch, linia 2978 (`pg==="dashboard"`) | Supplier-only — sprawdzone że admin/buyer/FM nie renderują go (linia 2390 — historyczny komentarz o bugu, naprawiony) |
| `pickSupplierDashState` | 3338 | 1 | `PageDashboard` linia 3348 | Helper supplier-only |
| `NextStepCard` | 3549 | 2 | `PageDashboard` linie 3472 (State B), 3505 (State A/default) | Supplier-only |
| `PkgCard` | 3577 | 2 | `PageDashboard` linie 3482 (placeholder), 3508 | Supplier-only |
| `NextWindowCard` | 3606 | 2 | `PageDashboard` linie 3483 (dim), 3509 | Supplier-only. **Już ZMODYFIKOWANY w P2-1** — date dispatch po locale, ale tekst "Najbliższe okno wysyłki" i "za X dni" wciąż PL |
| `KpiRow` | 3635 | 2 | `PageDashboard` linie 3490 (placeholder), 3517 | Supplier-only |
| `ActivityCard` | 3662 | 1 | `PageDashboard` linia 3532 | Supplier-only. **Już ZMODYFIKOWANY w P2-1** — `relTime` date dispatch po locale, ale "przed chwilą", "godz. temu", "dni temu" wciąż PL |
| `FmCompactCard` | 3703 | 1 | `PageDashboard` linia 3533 | Supplier-only — FM compact widget dla supplera (nie mylić z `PageSupplierFM` ani `PageAdminFM`) |
| `OnboardingChecklist` | 3767 | 1 | `PageDashboard` linia 3473 (tylko State B `pending_review`) | Supplier-only |
| `HelpStripDashboard` | 3862 | 2 | `PageDashboard` linie 3492 (State B), 3542 (State A) | Supplier-only |

### Helper `pluralDni` (linia 3329)

Funkcja zwracająca polskie odmiany dnia ("dzień" / "dni" / "dni"). **3 call sites, wszystkie w supplier dashboard:**
- linia 3622: `NextWindowCard`
- linia 3671: `ActivityCard.relTime`
- linia 3705: `FmCompactCard`

**Klasyfikacja: supplier-only** (mimo polskiej gramatyki w nazwie). Bezpieczne do bilingualizacji w P2-3.

**Decyzja do implementacji:** w EN sprowadza się do `count === 1 ? "day" : "days"` — prostsze niż polskie 3 formy. Można:
- A) zmodyfikować `pluralDni` żeby przyjmowała `i18n.language` i zwracała `day/days` dla EN
- B) zostawić `pluralDni` dla PL + dodać `pluralDaysEN` + wybierać per locale
- C) wynieść klucz `legacy.common.plural.days_one`/`days_few`/`days_many` do JSON z i18next `count` parameter (i18next ma wbudowaną obsługę plurals przez `_one/_few/_many` suffix). **REKOMENDACJA** — to standardowe podejście i18next.

## Estymacja liczby stringów per komponent

| Komponent | Linie kodu | Stringi (PL hardcoded) | Komentarz |
|---|---|---|---|
| `PageDashboard` | ~200 | ~40 | 7 wariantów `nextStep.{title,desc,cta}` (logic-heavy z `${refunds.length}`, `${total}`, `${pkgUsed}`, `${fmtPolishDate(...)}`) + 12 activity event templates + "Wysyłki PreConnect — ostatnie 30 dni" header + "brak danych" / "X wysyłek łącznie" + refunds banner z plural |
| `NextStepCard` | ~26 | **1** | Tylko "Twój następny krok" — reszta przychodzi przez props |
| `PkgCard` | ~30 | **8** | "Kredyty PreConnect", "aktywny pakiet: Standard {max}", "brak aktywnego pakietu", "/ {max} kredytów", placeholder hints, "Zobacz cennik"/"Kup pakiet" |
| `NextWindowCard` | ~28 | **3** | "Najbliższe okno wysyłki", "za {days} {pluralDni}", "Zobacz harmonogram" (date arrays już bilingual P2-1) |
| `KpiRow` | ~26 | **10** | 4 labels + 4 metas + "—" placeholder + "brak wysyłek" |
| `ActivityCard` | ~40 | **8** | "Ostatnia aktywność", "brak zdarzeń", plural "zdarzenie/zdarzenia/zdarzeń", "Wyślij pierwszą propozycję...", relTime PL strings (date dispatch już bilingual P2-1) |
| `FmCompactCard` | ~63 | **14** | Phase labels (3), "Spotkania FM 2026" header, 3 main texts, 4 step labels, 3 button label variants |
| `OnboardingChecklist` | ~94 | **16** | 5 steps × (label + hint + cta) + "Zacznij tutaj ({done}/{total})" |
| `HelpStripDashboard` | ~33 | **~10-12** | Toggle title, 2 section headings, 7 list items (3 PreConnect + 4 FM) |
| **RAZEM** | **~540 linii** | **~110-120** | |

## Propozycja podziału P2-3 na partie

Analogicznie do P2-2 (2a/2b/2c) — proponuję **3 partie** balansujące rozmiar i ryzyko.

### **P2-3a: pojedyncze widgety + helper** ⚡ low risk

**Branch:** `feat/i18n-p2-3a-supplier-widgets`

**Zakres:**
- `NextStepCard` (1 string)
- `PkgCard` (8)
- `NextWindowCard` (3)
- `KpiRow` (10)
- `HelpStripDashboard` (10-12)
- `pluralDni` helper — bilingualization (z i18next plurals lub manualnym wyborem locale)

**Razem:** ~35 stringów, 5 komponentów + 1 helper, ~140 linii kodu.

**Ryzyko:** ⚡ low. Małe, izolowane widgety. `pluralDni` w pełni supplier-only.

**Test plan:** Supplier EN dashboard → widgety pokazują EN labels; "1 day" / "5 days" plural w EN.

---

### **P2-3b: PageDashboard core (logic-heavy)** 🟠 high risk

**Branch:** `feat/i18n-p2-3b-supplier-dashboard-core`

**Zakres:**
- `PageDashboard` body (~200 linii):
  - 7 wariantów `nextStep` (próba użycia interpolacji z `{{refunds_count}}`, `{{total}}`, `{{used}}`, `{{max}}`, `{{date}}` przez `fmtPolishDate`)
  - 12 activity event templates (z JSX `<strong>` + `<em>` — wymaga `<Trans>` component lub strukturalnego stringa)
  - 30-day header + refunds banner z plural
  - Refunds banner: "1 zwrot kredytu" / "X zwrotów kredytów" — i18next plurals

**Razem:** ~40 stringów, 1 komponent, logic-heavy.

**Ryzyko:** 🟠 high — najtrudniejsza partia. Logic w 7 nextStep branches, JSX z mixed tekst+tagi w activity events, plurals.

**Test plan:** Supplier EN dashboard → wszystkie 7 stanów `nextStep` (pending_review, no package, no offer, refunds, no sends, package > 80%, default) generują angielski tekst; activity events EN z `<strong>` zachowanym; refunds banner z poprawnym plural EN.

---

### **P2-3c: ActivityCard + OnboardingChecklist + FmCompactCard** 🟡 medium risk

**Branch:** `feat/i18n-p2-3c-supplier-onboarding-fm-compact`

**Zakres:**
- `ActivityCard` (8 strings — relTime PL strings: "przed chwilą", "godz. temu", "X dni temu")
- `OnboardingChecklist` (16 strings — 5 steps × label+hint+cta, "Zacznij tutaj ({done}/{total})")
- `FmCompactCard` (14 strings — 3 phase labels, 3 main texts, 4 step labels, 3 button label variants)

**Razem:** ~38 stringów, 3 komponenty, ~200 linii kodu.

**Ryzyko:** 🟡 medium — widgety samowystarczalne, ale FmCompactCard ma kilka wariantów stanu (phaseLabel ternary, bigText, conditional main text, button label ternary).

**Test plan:**
- Supplier EN → ActivityCard pokazuje "just now" / "X hours ago" / "X days ago" / "26 May"
- OnboardingChecklist EN → 5 steps po angielsku z "Start here (2/5)" progress
- FmCompactCard EN → 3 phase labels po angielsku, button label per state

## Kolejność wykonania (sugestia)

```
P2-3a (warm-up, najbezpieczniejsze) → review → merge → smoke
  ↓
P2-3b (PageDashboard core, najtrudniejsze) → review → merge → smoke
  ↓
P2-3c (3 widgety + onboarding) → review → merge → smoke
```

**Argument za tą kolejnością:**
1. P2-3a najpierw → ustawiamy wzorzec dla `pluralDni` (i18next plurals); używamy go w P2-3b/3c bez powtarzania decyzji
2. P2-3b drugie → najtrudniejsza partia gdy mamy świeżą uwagę po P2-3a
3. P2-3c ostatnie → największa partia w liczbie komponentów (3), ale mniej logiczna złożoność niż PageDashboard

## Zakaz dla P2-3 (zatwierdzony przez Codex)

- ❌ Bez `PageSupplierProfile` (czeka na supplier phase później, P2-5)
- ❌ Bez `CompanyPreviewModal` / `OfferPreviewModal` (shared modals → osobny branch `feat/i18n-p2-shared-modals` po fazach supplier+admin+FM)
- ❌ Bez Admin / FM views / czata
- ❌ Bez maili / Netlify functions / migracji
- ❌ Bez refaktoru struktury JSX
- ❌ Bez zmian w logice nextStep / activity events / FM phases / onboarding logic

## Pytania otwarte do Codex

1. **`pluralDni` bilingualization** — strategia A/B/C (patrz wyżej)? Rekomendacja: **C — i18next plurals** (`legacy.common.plural.days_one`/`days_few`/`days_many` z `count` param)
2. **Activity events JSX z `<strong>` + `<em>`** w PageDashboard (linie 3442-3461) — preferujesz `<Trans>` z components, czy zmianę na czysty string bez tagów? **Rekomendacja: `<Trans>` z components — zachowuje wizualne wyróżnienie**
3. **`nextStep.desc` z `${fmtPolishDate(nextWindow)}` interpolacją** — `fmtPolishDate` już jest bilingual z P2-1, ale string template musi przyjąć value. **Rekomendacja:** `t("...nextStep.default_desc", { credits: rem, date: fmtPolishDate(nextWindow) })`
4. **Czy P2-3a/b/c mają osobne branche czy jeden branch w 3 commitach?** P2-2 było w 3 osobnych branchach (a/b/c) — sugerowałbym tę samą strategię dla P2-3

## Czego ten dokument NIE robi

- ❌ Nie zmienia ani jednej linii w `src/legacy/PreconnectFM.jsx`
- ❌ Nie zmienia ani jednej linii w `src/i18n/{pl,en}/legacy.json`
- ❌ Nie zmienia ani jednej linii w `db.js`
- ❌ Tylko nowy plik audit doc

Implementacja zaczyna się dopiero po akceptacji Codexa decyzji na 4 pytania otwarte powyżej.
