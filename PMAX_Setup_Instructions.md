# Performance Max PL + EN — Instrukcja konfiguracji

**Wersja:** 27.04.2026
**Czas wykonania:** 15-20 minut na kampanię = 30-40 min razem
**Konto:** 895-780-5133 (freshmarket@freshmarket.eu)

---

## Dlaczego PMax (przypomnienie)

Search PL/EN ma problem **„Mała liczba wyszukiwań"** dla niszowych B2B fraz. PMax obchodzi to przez:
- **AI Google sam dobiera odbiorców** (na bazie Twoich audiencji + zachowania użytkowników)
- **Cały ekosystem Google:** Search, Display, YouTube, Gmail, Discover, Maps
- **Bez słów kluczowych** = działa od razu, niezależnie od search volume

---

## ⚠️ WAŻNE: Najpierw napraw konwersje

Przed startem PMax — w **Cele → Konwersje** sprawdź, że masz przynajmniej jedną aktywną konwersję (np. `form_submit`). Bez konwersji PMax będzie ślepy. Jeśli ich nie ma:
1. Idź do **Cele → Działania powodujące konwersję**
2. Sprawdź czy import z GA4 działa (powinien być `_GA4_Freshmarket.eu` connected)
3. Oznacz `form_submit` jako **Główną** (Primary)

---

# 🇵🇱 KAMPANIA 1: Stands - PMax PL

## KROK 1: Utwórz nową kampanię

**Utwórz** (lewa kolumna, niebieski +) → **Kampania** → **Potencjalni klienci**

## KROK 2: Cele konwersji

Zaznacz tylko:
- ✅ `form_submit` (najważniejsze)
- ✅ Kontakty (jeśli masz)

Odznacz:
- ❌ Wyświetlenia strony (zbyt szerokie)

## KROK 3: Typ kampanii

→ **Performance Max**

## KROK 4: URL i nazwa

| Pole | Wartość |
|---|---|
| Końcowy URL | `https://freshmarket.eu/pl/exhibitors` |
| Nazwa kampanii | `Stands - PMax PL` |

→ **Dalej**

## KROK 5: Strategia ustalania stawek

- **Konwersje** (Maximize Conversions)
- ⚠️ NIE zaznaczaj „Ustaw docelowy CPA" na początku — niech AI się uczy 7 dni przed manipulacją

→ **Dalej**

## KROK 6: Ustawienia kampanii

### Lokalizacje
- **Polska** (i tylko Polska)

### Języki
- **Polski**

### Inne ustawienia
- **Rozszerzenie URL końcowego** → ✅ Włącz (Google znajdzie najlepsze podstrony)
- **Wykluczenia adresów URL:** dodaj `*thank-you*`, `*confirmation*`, `*admin*`

### Harmonogram reklam
- 24/7 (lub Pn-Pt 6:00-22:00 jeśli chcesz oszczędzić)

→ **Dalej**

## KROK 7: Grupa plików (Asset Group) — TO NAJWAŻNIEJSZE

Nazwa grupy plików: **PL Stands AssetGroup**

### Końcowy URL
`https://freshmarket.eu/pl/exhibitors`

### Obrazy (5-20)
Przeciągnij/wgraj te 5 plików (już są w Bibliotece):
- `Kopia 0186_R6M29996_happymoon.pl_www.jpg`
- `Kopia 0179_R6M29977_happymoon.pl_www.jpg`
- `Kopia 0173_R6M29947_happymoon.pl_www.jpg`
- `Kopia 0168_R6M29932_happymoon.pl_www.jpg`
- `Kopia 0126_R6M29752_happymoon.pl_www.jpg`

### Logo
- Logo Fresh Market (PNG transparentne, 1200×1200)
- Logo Fresh Market poziome (1200×300) jeśli masz

### Wideo (opcjonalne)
- `Fresh Market 2026 promo` (mamy 1:02 wideo w Bibliotece)

### Nagłówki (5-15, max 30 znaków każdy)
```
Fresh Market 2026
Wystawcy Fresh Market 2026
Targi branży fresh
Zarezerwuj stoisko
Stoiska na FM 2026
Wróć na Fresh Market 2026
24 września w Warszawie
3000+ kupców branży
Stoiska zabudowane
Spotkaj kupców fresh
Targi B2B Warszawa
Pokaż markę branży
```

### Długie nagłówki (1-5, max 90 znaków każdy)
```
Fresh Market 2026 — największe targi B2B branży fresh w Polsce
Zarezerwuj stoisko na Fresh Market 2026 i dotrzyj do 3000+ kupców branży
Targi fresh produce 24 września 2026 w Warszawie — zarezerwuj swoje miejsce
```

### Opisy (4-5, max 90 znaków każdy)
```
Stoiska zabudowane i lekkie. Kto pierwszy, lepsza lokalizacja. Rezerwuj teraz.
Strefa wystawców czynna cały dzień 24 września 2026 w Warszawie.
Pokaż markę branży fresh - owoce, warzywa, kwiaty, opakowania, IT, logistyka.
Dotrzyj do 350+ uczestników wydarzenia B2B - networking i ekspozycja.
Logo na stronie + wpis w katalogu w cenie stoiska. Zarezerwuj.
```

### Wezwanie do działania (CTA)
**Zarezerwuj** (lub: Dowiedz się więcej, Skontaktuj się)

### Nazwa firmy
`Fresh Market 2026`

## KROK 8: Sygnały odbiorców (BARDZO WAŻNE!)

PMax używa „sygnałów" jako podpowiedzi dla AI. Dodaj wszystko co masz:

### Twoje dane (Custom Audiences)
- ✅ All Users of _GA4_Fresh-market.pl
- ✅ All Users of _GA4_Freshmarket.eu (mieszane PL/EN)
- ✅ FM All Visitors 30d
- ✅ FM PL Visitors 30d (po synchronizacji ~24h)
- ✅ FM Mailchimp Subscribers PL 2026 (mała ale niech jest)

### Niestandardowe segmenty (wpisz słowa kluczowe)
Google AI użyje ich tylko jako podpowiedź dla algorytmu:
```
targi spożywcze
targi b2b
targi owoców warzyw
wystawca fresh produce
expo fresh polska
food trade show
b2b food expo
horeca expo
```

### Dane demograficzne
- Wiek: 25-65
- Płeć: Wszystkie
- Status rodzinny: Wszystkie
- Dochód: Top 50%

### Zainteresowania i nawyki — wybierz
- Decydenci biznesowi (Business Decision Makers)
- Profesjonaliści w branży spożywczej
- Importerzy/Eksporterzy
- B2B Marketing
- Konferencje i targi

## KROK 9: Budżet

**5,00 zł/dzień** (na start, możesz później zwiększyć do 10-15)

## KROK 10: Przegląd → Publikuj

Sprawdź wszystko → kliknij **Opublikuj kampanię**

Status: **Wstrzymana** na start (zalecam!)
Po 24h zatwierdzenia reklam → włącz manualnie.

---

# 🇬🇧 KAMPANIA 2: Stands - PMax EN

Powtórz powyższe kroki, ale z różnicami:

## RÓŻNICE wobec PL:

### KROK 4
| Pole | Wartość |
|---|---|
| Końcowy URL | `https://freshmarket.eu/exhibitors` |
| Nazwa kampanii | `Stands - PMax EN` |

### KROK 6 — Lokalizacje
**WYBIERZ TYLKO TE KRAJE:**
- Niemcy
- Holandia
- Hiszpania
- Włochy
- Francja
- Czechy
- Słowacja
- Litwa
- Ukraina
- Rumunia
- Maroko
- Egipt
- Turcja
- Mołdawia
- Albania
- Macedonia Północna
- Węgry
- Grecja
- Portugalia (dodaj!)
- Belgia (dodaj!)

**WYKLUCZ:**
- Polska (żeby PL ad ich nie targetował)

### KROK 6 — Język
**Angielski** (tylko)

### KROK 7 — Końcowy URL
`https://freshmarket.eu/exhibitors`

### KROK 7 — Nagłówki EN (5-15, max 30 znaków)
```
Fresh Market 2026
Book Your Stand at FM 2026
Europe's Fresh Industry Expo
Meet 3000+ Buyers
Showcase Your Brand Live
Fresh Market — 24 Sept 2026
Reserve Your Stand Now
B2B Fresh Produce Expo
Polish Food Industry Expo
Fresh Produce Trade Show
Warsaw Sept 2026
Exhibit at FM 2026
```

### KROK 7 — Długie nagłówki EN (max 90 znaków)
```
Fresh Market 2026 — The Premier B2B Expo for Fresh Produce Industry in Europe
Reserve your exhibition stand at Fresh Market 2026 and reach 3000+ industry buyers
Polish Food Industry Trade Show — September 24, 2026 in Warsaw
```

### KROK 7 — Opisy EN (max 90 znaków)
```
Reserve your exhibition stand at Fresh Market 2026. Connect with 3000+ industry buyers.
Join 150+ exhibitors at Europe's leading fresh produce expo. Warsaw, September 24, 2026.
Limited stands available. Early booking = better location. Don't miss this opportunity.
Present your products to decision-makers from retail, HoReCa and distribution across Europe.
Full day of B2B meetings, product showcases and industry networking. Book now.
```

### KROK 7 — CTA
**Book now** (lub: Learn more, Sign up)

### KROK 8 — Sygnały odbiorców (EN)
- ✅ FM Mailchimp Subscribers EN 2026 (7,539 osób — twoja największa baza!)
- ✅ FM EN Visitors 30d (po synchronizacji)
- ✅ All Users of _GA4_Freshmarket.eu

### Niestandardowe segmenty EN
```
fresh produce expo
b2b food trade show
horeca exhibition
food import export
fruit vegetable trade show
poland trade show
warsaw expo
food industry conference
wholesale food expo
exhibition stand booking
```

### KROK 9 — Budżet
**7,00 zł/dzień** (większy potencjał = większy budżet)

---

# 📋 Podsumowanie

Po skonfigurowaniu obu kampanii (PMax PL i PMax EN), oraz biorąc pod uwagę istniejące:

| Kampania | Budżet/dzień | Status | Typ |
|---|---|---|---|
| Stands - Search PL | 8 zł | 🟢 Aktywna | Search |
| Stands - Search EN | 7 zł | 🟢 Aktywna | Search |
| Stands - Brand | 3 zł | 🟢 Aktywna | Search |
| Stands - Remarketing Display EN | 5 zł | 🟢 Aktywna | Display |
| Stands - Remarketing Display PL | 3 zł | ⏸️ Wstrzymana | Display |
| **Stands - PMax PL** *(nowa)* | **5 zł** | ⏸️ Wstrzymana | **PMax** |
| **Stands - PMax EN** *(nowa)* | **7 zł** | ⏸️ Wstrzymana | **PMax** |
| **TOTAL** | **38 zł/dzień** | | |

Twoje 1009 zł = ~26 dni pełnego budżetu.

---

# ⏰ Po skonfigurowaniu

1. **24-48h** — Google sprawdza wszystkie reklamy w PMax
2. **Ręcznie aktywuj** kampanie (Wstrzymana → Aktywna)
3. **7 dni nauki AI** — nie modyfikuj nic w PMax przez pierwszy tydzień!
4. **Po 7 dniach** sprawdź:
   - Ile konwersji
   - Jaki CPA
   - Z jakich kanałów (Search/Display/YouTube/Gmail) idą wyniki

---

# 💡 Dlaczego ta strategia zadziała

W przeciwieństwie do Search:
- Brak ograniczenia „Mała liczba wyszukiwań" 
- AI testuje setki kombinacji nagłówków/obrazów/audiencji
- Korzysta z naszych 14 obrazów + 30s wideo + audiencji GA4
- Skaluje się przez wiele kanałów Google jednocześnie

**Pierwszych 7 dni może być słabo (faza nauki) — to NORMALNE.** Po 14 dniach algorytm znajduje swoje optimum.

---

**Plik wygenerowany:** 27.04.2026
**Autor:** Claude (asystent AI)
**Konsultacja przy konfiguracji:** sesja 27.04.2026
