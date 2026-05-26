# P0 i18n MVP — Summary

Stan branch `feat/i18n-mvp` w momencie zamknięcia P0. Tag: `v-i18n-mvp`.

## Co P0 daje produkcji

**Publiczny onboarding EN spójny od ekranu do skrzynki.** Anglojęzyczny dostawca może:
1. Wejść na `b2b.freshmarket.eu/login` → przełączyć język na English (LanguageSwitcher).
2. Zarejestrować firmę przez `/zarejestruj-dostawce` w EN — wszystkie etykiety, consent block i komunikaty po angielsku.
3. Dostać welcome mail po angielsku (Resend, locale-aware z `payload.locale`).
4. Kliknąć "Forgot password?" — mail przychodzi bilingual (PL + EN obok siebie, bo Supabase Auth nie zna locale przy generowaniu tokenu).
5. Wejść na `/reset-password` z linku — strona po angielsku.
6. Zobaczyć stopkę panelu po angielsku z linkami do EN draftów `/regulations` i `/privacy-policy` (z banerem "subject to legal review").

Polski dostawca dostaje wszystko po polsku jak dotąd — bez regresji.

## Commit log P0 (9 kroków implementacji + 2 dokumenty terminologii)

| Commit | Krok | Zakres |
|---|---|---|
| `3184b9d` | docs | Słownik terminologii PL→EN draft v1.0 |
| `fe866fa` | docs | Poprawki Codexa → v1.1 (Submission/Retailer/Admin, sentence case, daty european) |
| `21f8abd` | Krok 1 | Fundament i18n (react-i18next, struktura `src/i18n/{pl,en}/{common,auth}.json`, `locale.js` helpery, `<LanguageSwitcher>` szkielet) |
| `b096579` | Krok 2 | `migrations/036_profiles_locale.sql` + odczyt w `AuthProvider` |
| `119aec4` | Krok 3 | `<LanguageSwitcher>` 3 warianty + best-effort DB sync |
| `0a7e853` | Krok 3b | Pending sync flag (fix nadpisania PL po loginie gdy niezalogowany wybrał EN) + locale propagation do `register-supplier-self` |
| `b3d94de` | Krok 3c | Pending sync: kasowanie flagi dopiero po sukcesie DB (Codex review) |
| `54b7bd7` | Krok 4 | Tłumaczenie 4 stron auth (LoginPage, RegisterSupplierPage, ResetPasswordPage, PurchaseReturnPage) z lokalizacją linków legal |
| `723e700` | Krok 4b | EN legal drafts (`public/regulations.html`, `public/privacy-policy.html`) + redirects w `netlify.toml` + `Terms of Service` w `en/auth.json` (Codex review) |
| `e022311` | Krok 5 | `<LegalFooter>` bilingual (PL/EN labelki + URL-e) |
| `29a1324` | Krok 6 | Welcome mail locale-aware (Resend) + Supabase Auth templates bilingual (reset-password, confirm-signup, magic-link) |

## Co działa w P0 (zweryfikowane)

**UI:**
- LanguageSwitcher (`<LanguageSwitcher>`) w 3 wariantach (auth/panel/compact) na 4 stronach auth + PanelTopBar.
- Detekcja initial locale: localStorage `fm_locale` → `navigator.language` → `'pl'`.
- Persistence: localStorage dla niezalogowanych, `profiles.locale` dla zalogowanych.
- Pending sync flag dla przejścia niezalogowany→zalogowany.
- Fallback `fallbackLng: false` — brakujący klucz pokazuje surowy klucz, nie maskuje polskim.

**Strony bilingual:**
- `/login`
- `/zarejestruj-dostawce`
- `/reset-password`
- `/zakup-ok` (PayU return landing)

**Dokumenty legal:**
- PL: `/regulamin`, `/polityka-prywatnosci` (bez zmian, finalne v1.0)
- EN drafts z banerem "subject to legal review": `/regulations`, `/privacy-policy`

**Maile:**
- Welcome supplier (Resend) — locale-aware PL/EN
- Admin notification (Resend) — zawsze PL (zespół FM)
- Reset password (Supabase Auth) — bilingual
- Confirm signup (Supabase Auth) — bilingual
- Magic link (Supabase Auth) — bilingual

**Stopka panelu:**
- `<LegalFooter>` bilingual w `AdminPanel` / `SupplierPanel` / `BuyerPanel`

## Co NIE jest w P0 (świadomie pominięte)

**Panele (P1):**
- `PanelTopBar` — labelki menu, badge admin/super, breadcrumb dalej PL
- Wnętrza `AdminPanel`, `SupplierPanel`, `BuyerPanel` — sekcje/tabele/formularze/przyciski dalej PL
- Email moderation UI w `AdminPanel` (kolejka ofert)

**Maile (P1/P2):**
- 11 pozostałych Resend templates: `account_activated`, `account_rejected`, `account_suspended`, `offer_to_moderation`, `offer_approved`, `offers_sent_to_retailer`, `offer_read_by_buyer`, `offer_expired`, `admin_new_registration` — zostają PL
- Pipeline batch mailing do retailerów (monthly digest)

**PreconnectFM (P2):**
- `src/legacy/PreconnectFM.jsx` — 4000+ linii, wnętrze aplikacji, niedotykane
- AI chat (asystent admina dla odpowiedzi PreConnect)
- FM B2B Meetings UI (faza preferencji, pairing, harmonogram)

**Legal (osobny PR z review prawniczki):**
- EN tłumaczenia `/regulations` i `/privacy-policy` są **draftami** — banner mówi to wprost. Production-ready EN legal wymaga osobnego review prawnego (KJOW i/lub kancelaria) i nowego commitu który zdejmie banner.

**Kupcy (poza zakresem onboarding self-service):**
- Buyer dalej idzie przez admina (zgodnie z Regulaminem § 5), nie ma self-registration
- Welcome mail dla Buyera nie istnieje — Admin tworzy konto i Buyer dostaje credentials osobno

## Plan na P1 i P2

### P1 — podstawowe panele bilingual
Cel: anglojęzyczny dostawca po loginie dostaje cały panel po angielsku (oprócz PreConnect content, który jest P2).

Zakres (proponowane mini-kroki):
- Krok 8: `PanelTopBar` (labelki + badge admin/super)
- Krok 9: `SupplierPanel` wnętrza (formularze profilu, tabele)
- Krok 10: `BuyerPanel` wnętrza
- Krok 11: `AdminPanel` wnętrza (Companies, Users, Packages — bez kolejki moderation)

Strategia: każdy panel jako osobny mini-krok do review Codex, z dedykowanym namespace `panel.<name>` w `auth.json` lub nowe `panel.json`. Symetria PL/EN wymuszona.

### P2 — PreconnectFM + AI + FM B2B
Cel: pełna aplikacja bilingual.

Zakres (większe):
- PreconnectFM.jsx (offerty, pipeline, finance, statystyki)
- AI chat (asystent admina)
- FM B2B Meetings (faza preferencji, pairing, harmonogram, ekran wydarzenia)
- 11 maili Resend (account states + offer lifecycle)

Strategia: prawdopodobnie najpierw migracja PreconnectFM.jsx na useTranslation z PL keys (bez EN), potem dodawanie EN w drugim kroku. Inaczej zmiana wszystkiego naraz jest za ryzykowna.

## Migration steps przed merge P0 → main

1. **Supabase Cloud:**
   - [ ] Sprawdzić że migration `036_profiles_locale.sql` jest wgrane (jeśli nie — wkleić z `supabase/migrations/036_profiles_locale.sql`)
   - [ ] Wkleić 3 bilingual auth templates w Dashboard (Authentication → Email Templates) — patrz `supabase/auth-email-templates/README.md`
2. **Netlify:** deploy z brancha `feat/i18n-mvp` powinien jechać automatycznie
3. **QA:** wykonać checklist z `docs/i18n/P0_QA_CHECKLIST.md` na preview deploy
4. **Tag:** `git tag -a v-i18n-mvp` + push (już zrobione w Kroku 7)
5. **Merge:** PR `feat/i18n-mvp` → `main` po sign-off

## Co Codex powinien sprawdzić przed merge

Najwyższy priorytet:
- [ ] Klucze PL/EN są symetryczne (`auth.json` 99/99, `common.json` 33/33)
- [ ] `PreconnectFM.jsx` nie ma żadnych zmian (`git diff main..feat/i18n-mvp -- src/legacy/PreconnectFM.jsx` → pusto)
- [ ] Build przechodzi w Netlify
- [ ] Manual QA checklist A1-A7, B1-B5, C1-C4, D1-D3, E1-E3 zaliczone

Średni priorytet:
- [ ] EN drafty `/regulations` i `/privacy-policy` mają banner subject-to-legal-review (nie wprowadzą w błąd anglojęzycznego usera że są finalne)
- [ ] Welcome mail PL nadal działa identycznie jak przed P0 (brak regresji dla obecnych supplierów)
- [ ] Admin notification do `newsletter@freshmarket.eu` zostaje zawsze PL (zespół FM)
