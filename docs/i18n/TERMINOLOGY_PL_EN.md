# Słownik terminologii Fresh Market B2B — PL → EN

**Status:** Draft do akceptacji (przed startem prac i18n)
**Cel:** ustalenie standardu terminologii ZANIM ruszymy kod. Po akceptacji ten plik jest źródłem prawdy dla wszystkich tłumaczeń (UI, maile, dokumenty legal).

**Zasady:**
- **Wersje PL i EN są RÓWNORZĘDNE** — obie są oficjalnymi wersjami aplikacji i dokumentów. Polski nie ma pierwszeństwa nad angielskim ani odwrotnie. *Prawo właściwe* (governing law) — osobna sprawa: zawsze polskie (siedziba Operatora).
- Każdy klucz w plikach `pl/*.json` i `en/*.json` musi używać terminologii z tego dokumentu
- Nie zmieniamy terminologii po starcie prac bez świadomej decyzji + sprintu refaktorowego
- Wariacje (np. liczba mnoga, dopełniacz) są naturalne — chodzi o ujednolicenie głównej formy
- Treści użytkownika (nazwy firm, opisy ofert) NIE są tłumaczone — to UGC
- Emoji (⭐ 👍 ❌) mogą występować w UI, ale **NIE są częścią terminologii kanonu** — tłumaczymy tylko teksty

---

## 1. Role i konta

| PL | EN | Uwagi |
|---|---|---|
| Dostawca | Supplier | Firma produkująca / dystrybuująca owoce-warzywa-kwiaty |
| Kupiec | Buyer | Osoba reprezentująca sieć handlową / dystrybutora |
| Sieć handlowa | Retail chain | np. Biedronka, Lidl |
| Dystrybutor | Distributor | hurtowy odbiorca |
| Sieć (skrót, gdy oczywiste) | Retailer | krótsza forma w UI |
| Administrator | **Admin** | naturalna forma w aplikacjach (nie "Administrator") |
| Super administrator | **Super admin** | poziom z dostępem do zarządzania zespołem |
| Zwykły administrator | Admin | bez prefiksu — dla skrótu |
| Konto | Account | |
| Profil firmy | Company profile | |
| Profil użytkownika | User profile | |
| Operator (właściciel platformy, KJOW) | Operator | w dokumentach legal też: "Service Provider" |

---

## 2. PreConnect (moduł całoroczny)

| PL | EN | Uwagi |
|---|---|---|
| **PreConnect** | **PreConnect** | nazwa brandowa, nie tłumaczymy |
| Propozycja asortymentowa | **Product proposal** | główny termin |
| Propozycja (skrót) | Proposal | gdy kontekst jasny |
| Dodaj propozycję | Add proposal | |
| Moje propozycje | My proposals | sidebar item |
| Edytuj propozycję | Edit proposal | |
| Duplikuj propozycję | Duplicate proposal | |
| Usuń propozycję | Delete proposal | |
| **Wysyłka** (do sieci) | **Submission** | NIE "Shipment" (kojarzy się z fizyczną dostawą) |
| Wysyłki | Submissions | sidebar item |
| Wyślij propozycję | Submit proposal | akcja |
| Wysłane | Submitted | status / filter |
| **Okno wysyłki** | **Submission window** | pierwszy wtorek miesiąca |
| Najbliższe okno wysyłki | Next submission window | dashboard supplier |
| Pakiet (kredytów) | Package / Plan | "Standard 30" → "Standard 30 plan" |
| **Kredyt** (1 wysyłka = 1 kredyt) | **Credit** | |
| Kredyty PreConnect | PreConnect credits | dashboard kafel |
| Zostało N kredytów | N credits remaining | |
| Kup pakiet | Buy package | |
| Aktywny pakiet | Active package | |
| Pipeline | Pipeline | admin tab — zostawić EN |
| Moderacja | Moderation | tab w pipeline |
| Do moderacji | Pending moderation | status |
| Zatwierdź | Approve | akcja moderacji |
| Odrzuć | Reject | akcja moderacji |
| Wysłane & tracking | Sent & tracking | tab w pipeline |
| Zwrot kredytu | Credit refund | gdy propozycja wygasła nieotwarta |
| 14-dniowa gwarancja zwrotu | 14-day refund guarantee | marketing copy |
| Wygasła | Expired | status wysyłki po 14d |
| Otwarte (przez kupca) | Opened (by buyer) | status w KPI |
| Zobaczone / rozliczone | Seen / settled | KPI dashboard supplier |
| Czekają | Pending | KPI dashboard supplier |
| Współczynnik zobaczeń | View rate | KPI dashboard supplier |

---

## 3. Spotkania B2B / FM 2026

| PL | EN | Uwagi |
|---|---|---|
| **Spotkania B2B** | **B2B Meetings** | główny termin |
| Spotkania FM 2026 | FM 2026 Meetings | brand-specific |
| Fresh Market 2026 | Fresh Market 2026 | nazwa eventu, nie tłumaczymy |
| Event / wydarzenie | Event | "Event day", "during the event" |
| **Wybór sieci** | **Retailer selection** | faza 2 supplier. NIE "Network selection" (mylące z siecią komputerową) |
| Sieci główne (⭐) | **Priority retailers** | nie "Main networks" — to UI label, naturalniej |
| Sieci rezerwowe (👍) | **Backup retailers** | nie "Reserve networks" |
| Slot główny | Priority slot | |
| Slot rezerwowy | Backup slot | |
| Algorytm | Algorithm | |
| Uruchom algorytm | Run algorithm | |
| Korekty | Adjustments | admin tab |
| Ręczna korekta | Manual adjustment | |
| Publikacja planu | Plan publication | |
| Plan opublikowany | Plan published | status |
| Twoje spotkania | Your meetings | sidebar item |
| **Numer spotkania** | **Meeting number** | system kolejkowy |
| Kolejka spotkań | Meeting queue | model FM B2B |
| Wzajemne potwierdzenie | Mutual confirmation | match dwustronny |
| Match dwustronny | Mutual match | |
| Akceptacja jednostronna (sieć chce, dostawca nie wybrał) | **Buyer interested** | nie "One-sided acceptance" — brzmi prawno-technicznie. W UI naturalniej |
| Bramka 1 / Bramka 2 | Gate 1 / Gate 2 | event day |
| Obsługa B2B | B2B support staff | osoby odprowadzające do spotkania |
| Wywołanie numeru | Number call | proces na evencie |
| Kupiec chce (odpowiedź buyer) | **Interested** | nie "Buyer wants" — dosłowne tłumaczenie |
| Daj szansę | **Maybe** lub **Consider** | nie "Give a chance" — dosłowne |
| Nie chcę | **Not interested** | nie "Don't want" — dosłowne |
| Przenieś na koniec kolejki | Move to back of queue | friction modal |
| Wzajemnie wybrali | Mutually selected | |
| Czerwona strefa | Red zone | numery > 35 |
| Pomarańczowa strefa | Orange zone | numery 26-35 |
| Zielona strefa | Green zone | numery ≤ 25 |

---

## 4. Statusy

Statusy techniczne (enumy DB) zostają po angielsku — w UI mapujemy na localized labels.

| Status DB (EN) | Label PL | Label EN |
|---|---|---|
| `pending_review` | Oczekuje na zatwierdzenie | Pending review |
| `active` | Aktywne | Active |
| `inactive` | Nieaktywne | Inactive |
| `draft` | Szkic | Draft |
| `published` | Opublikowana | Published |
| `pending_moderation` | Do moderacji | Pending moderation |
| `approved` | Zatwierdzona | Approved |
| `rejected` | Odrzucona | Rejected |
| `queued` | W kolejce | Queued |
| `sent` | Wysłana | Sent |
| `read` | Przeczytana / zobaczona | Read / seen |
| `read_manual` | Oznaczona ręcznie | Manually marked |
| `expired` | Wygasła | Expired |
| `refunded` | Zwrócona (kredyt) | Refunded |
| `unread_expired` | Nieotwarta — wygasła | Unread — expired |

---

## 5. Płatności i finanse

| PL | EN | Uwagi |
|---|---|---|
| Płatność | Payment | |
| Faktura | Invoice | |
| Faktura VAT | VAT invoice | |
| Zakup pakietu | Package purchase | |
| Cena | Price | |
| Cena netto | Net price | |
| Cena brutto | Gross price | |
| VAT 23% | 23% VAT | |
| Karta kredytowa / debetowa | Credit / debit card | |
| Saldo (balans) | Balance | |
| Historia transakcji | Transaction history | |
| Numer zamówienia | Order number | |
| Data płatności | Payment date | |
| Status płatności | Payment status | |
| Pomyślnie opłacone | Successfully paid | |
| Płatność oczekująca | Payment pending | |
| Płatność nieudana | Payment failed | |
| Anuluj zamówienie | Cancel order | |
| Powrót do panelu | Return to panel | |

---

## 6. Admin panel (zarządzanie)

| PL | EN | Uwagi |
|---|---|---|
| Panel administratora | **Admin panel** | |
| Dashboard | Dashboard | nie tłumaczymy |
| Firmy | Companies | sidebar |
| Sieci | **Retailers** | sidebar (nie "Networks" — mylące) |
| Wiadomości | Messages | sidebar |
| Branding | Branding | nie tłumaczymy |
| Administratorzy | **Admins** | sidebar (super-admin only) |
| Promuj do administratora | Promote to admin | |
| Odbierz uprawnienia | Revoke privileges | |
| Aktywuj konto | Activate account | |
| Zatwierdź firmę | Approve company | |
| Zablokuj firmę | Block company | |
| Wgraj logo Fresh Market | Upload Fresh Market logo | branding |

---

## 7. Legal / RODO

| PL | EN | Uwagi |
|---|---|---|
| Regulamin | **Terms of Service** | główny termin |
| Regulamin korzystania | Terms of Use | wariacja |
| Polityka Prywatności | **Privacy Policy** | |
| RODO | **GDPR** | EN forma rozpoznawalna |
| Administrator danych osobowych | Data controller | RODO |
| Podmiot przetwarzający | Data processor | RODO |
| Dane osobowe | Personal data | |
| Cookies / pliki cookies | Cookies | |
| Zgoda | Consent | |
| Akceptuję | I accept | checkbox |
| Wycofanie zgody | Consent withdrawal | |
| Prawo do bycia zapomnianym | Right to erasure | RODO |
| Wersja językowa dokumentu | **Official language version** | równorzędność PL i EN |
| Obie wersje językowe są oficjalne | Both language versions are official | klauzula w legal docs |
| Prawo właściwe | **Governing law** | osobno od wersji językowej (zawsze: Polish law) |
| Wersja 1.0 | Version 1.0 | |
| Obowiązuje od | Effective from | |
| Wchodzi w życie | Comes into force | |
| Kontakt | Contact | |
| Reklamacja | Complaint | |
| Konsument | Consumer | nie używamy — to platforma B2B |

---

## 8. Maile

| PL (subject + key copy) | EN | Uwagi |
|---|---|---|
| Witaj w Fresh Market B2B | Welcome to Fresh Market B2B | welcome supplier |
| Twoje konto zostało utworzone | Your account has been created | welcome body |
| Konto czeka na zatwierdzenie | Account pending approval | welcome body |
| Nowa propozycja od dostawcy | New proposal from supplier | pipeline buyer |
| Twoja propozycja została otwarta | Your proposal has been opened | tracking supplier |
| Przypomnienie: 14 dni do wygaśnięcia | Reminder: expires in 14 days | |
| Zwrot kredytu — propozycja wygasła | Credit refund — proposal expired | |
| Resetowanie hasła | Password reset | Supabase Auth |
| Potwierdź adres e-mail | Confirm email address | Supabase Auth |
| Link do zalogowania | Sign-in link | Supabase Auth (magic link) |
| Zaproszenie do zespołu administratorów | Invitation to admin team | |
| Pozdrawiamy / Zespół Fresh Market | Regards / Fresh Market Team | sign-off |

---

## 9. Komunikaty i akcje (button labels + toasty)

| PL | EN |
|---|---|
| Dodaj | Add |
| Edytuj | Edit |
| Zapisz | Save |
| Zapisz zmiany | Save changes |
| Anuluj | Cancel |
| Usuń | Delete |
| Potwierdź | Confirm |
| Wyślij | Send / Submit |
| Pobierz | Download |
| Wgraj | Upload |
| Zaloguj się | Sign in |
| Wyloguj | Sign out |
| Zarejestruj się | Sign up / Register |
| Załóż konto | Create account |
| Zapomniałeś hasła? | Forgot your password? |
| Zaloguj przez magic link | Sign in with magic link |
| Wstecz | Back |
| Dalej | Next |
| Gotowe | Done |
| Zamknij | Close |
| Otwórz | Open |
| Tak | Yes |
| Nie | No |
| Sukces | Success |
| Błąd | Error |
| Ostrzeżenie | Warning |
| Informacja | Information |
| Wymagane | Required |
| Opcjonalne | Optional |
| Brak danych | No data |
| Brak wyników | No results |
| Ładowanie... | Loading... |
| Zapisano | Saved |
| Skopiowano | Copied |

---

## 10. Polskie terminy które ZOSTAWIAMY w polskiej formie

Nazwy własne, brandowe, nie tłumaczone w EN:

- **Fresh Market** (brand)
- **PreConnect** (nazwa modułu)
- **FM 2026** (rok edycji)
- **B2B** (akronim międzynarodowy)
- **KJOW Sp. z o.o.** (nazwa firmy w dokumentach legal)
- **EXPO Łódź** (lokalizacja — można dodać "Expo Łódź, Poland")
- **PayU** (operator płatności, międzynarodowa marka)
- **Resend, Supabase, Netlify** (dostawcy techniczni)
- **Cyberfolks** (hosting)
- **Biedronka, Lidl Polska, Kaufland, Carrefour, Auchan, Selgros, Spar...** (nazwy sieci handlowych — własne)
- **NIP, KRS, REGON** (polskie identyfikatory rejestrowe — zostają w obu wersjach, w EN dodać "Polish tax/registry numbers" w nawiasie)

---

## 11. Zasady stylu EN

- **Sentence case prawie wszędzie w UI** — labelki, buttony, nagłówki kart, sidebar items, toasty:
  - "Add proposal" (NIE "Add Proposal")
  - "Retailer selection" (NIE "Retailer Selection")
  - "Your meetings" (NIE "Your Meetings")
- **Title Case** używamy tylko dla:
  - tytułów dokumentów legal ("Terms of Service", "Privacy Policy")
  - stron marketingowych zewnętrznych (poza aplikacją)
  - oficjalnych nazw eventów ("Fresh Market 2026 — B2B Meeting & Trade Show")
- **Imperative** dla buttonów ("Save changes", NIE "Saving changes")
- **Active voice** ("Buyer opened your proposal", NIE "Your proposal was opened by buyer")
- **B2B tone** — formalne, ale nie sztywne. Bez "Hey there!" w mailach. Bez "we're so excited" itp.
- **No exclamation marks** w komunikatach UI (poza marketingowymi typu welcome screen)
- **Date format:** `24 May 2026` (europejski, dzień przed miesiącem — bez przecinka). NIE `May 24, 2026` (USA-centric). NIE `24.05.2026` (PL — w EN traktowane jako daty UK numeric ale niejednoznaczne).
- **Number format:** `1,000` (przecinek tysięczny), `1.50` (kropka dziesiętna)
- **Currency:** `€60.00` lub `60 EUR` (Fresh Market używa EUR)
- **Time format:** `10:30` (24h, bez AM/PM). Konsystentnie w całej aplikacji — europejski format.

---

## 12. Wątpliwości / decyzje do podjęcia

Sytuacje gdzie warto się upewnić zanim wdrożymy:

| Pojęcie | Wątpliwość | Decyzja |
|---|---|---|
| "Propozycja" | "Proposal" vs "Offer"? | ✅ **Proposal** — bo nie zawiera ceny obligatoryjnie. "Offer" w B2B sugeruje ofertę handlową z ceną. |
| "Sieć handlowa" | "Retail chain" vs "Retailer" vs "Network"? | ✅ **Retail chain** dla pełnego terminu, **Retailer** dla skrótu w UI. NIE "Network" (mylące z siecią komputerową). |
| "Wysyłka" | "Submission" (Codex) vs "Send" vs "Shipment"? | ✅ **Submission** — Codex ma rację, "Send"/"Shipment" mylące |
| "Kupiec" | "Buyer" vs "Purchaser"? | ✅ **Buyer** — standardowe w retail/FMCG |
| "Dostawca" | "Supplier" vs "Vendor"? | ✅ **Supplier** — branża spożywcza, food supply chain |
| "Pakiet" (PreConnect) | "Package" vs "Plan" vs "Subscription"? | ✅ **Package** dla single purchase, **Plan** jako semantyczny synonim |
| "Slot spotkania" | "Slot" vs "Time slot" vs "Meeting slot"? | ✅ **Meeting slot** dla jasności, **slot** w skrócie |
| "Kategoria zakupowa" | "Buying category" vs "Product category"? | ✅ **Product category** — najprościej |
| "Numer spotkania" (queue) | "Meeting number" vs "Queue number"? | ✅ **Meeting number** — to nasz brand, model kolejkowy opisujemy osobno |
| "Korekta" (admin) | "Adjustment" vs "Correction" vs "Override"? | ✅ **Adjustment** dla normalnej zmiany, **Override** dla wymuszenia mimo "remove" |
| "Sieci główne / rezerwowe" | "Main/Reserve" (dosłowne) vs "Priority/Backup"? | ✅ **Priority/Backup** (Codex) — naturalniej w UI |
| "Odpowiedzi kupca" | "Buyer wants / Give a chance / Don't want" (dosłowne) | ✅ **Interested / Maybe / Not interested** (Codex) — czysta terminologia |
| "Administrator" w UI | "Administrator" (formalne) vs "Admin"? | ✅ **Admin** (Codex) — naturalniej w aplikacjach |
| "Akceptacja jednostronna" | "One-sided acceptance" (prawno-techn.) | ✅ **Buyer interested** — UI-friendly. "One-sided" tylko w dokumentacji wewnętrznej |
| "Wersja językowa wiążąca" | "Polish version prevails" vs równorzędność | ✅ **Równorzędność** (Codex) — PL i EN obie oficjalne. Klauzula: "Both language versions are official." Prawo właściwe (governing law) = polskie, ale to OSOBNE od wersji językowej. |
| Daty (EN format) | `May 24, 2026` (USA) vs `24 May 2026` (europ.) | ✅ **24 May 2026** (Codex) — Fresh Market to europejski event |
| Godziny (EN format) | `10:30 AM` (USA 12h) vs `10:30` (24h)? | ✅ **10:30** (24h) — standard europejski |
| Style cases | Title Case (USA) vs Sentence case? | ✅ **Sentence case** wszędzie w UI (Codex), Title Case tylko dla dokumentów legal |

---

## Akceptacja

Po przeglądzie zaakceptuj jedną z opcji:

- **A) Akceptuję w całości** — startuję Krok 1 (branch + safety baseline)
- **B) Mam uwagi do konkretnych terminów** — wskaż które (np. „Propozycja → Offer, nie Proposal") → uaktualnię tabelę → akceptujesz finalną wersję
- **C) Chcę żeby native speaker EN spojrzał na słownik** — pauza ~1-2 dni na walidację → potem start

**Po akceptacji** — ten plik staje się read-only reference dla całego projektu i18n. Każda zmiana wymaga świadomej decyzji + commit'a.
