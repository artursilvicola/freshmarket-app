# Szablon grafiki LinkedIn — "20 lat Fresh Market – Historia wystawców"

**Cel:** jeden powtarzalny layout, ~40 grafik, każda z podmienianym rokiem / nazwą firmy / archiwalnym zdjęciem / hasłem. Wszystkie w tym samym stylu (zielony Mega Fresh).

---

## 1. Prompt do wklejenia w Photoshopie (Adobe Firefly / AI assistant)

```
Stwórz szablon grafiki na LinkedIn w formacie kwadratu 1080×1080 px (300 DPI, RGB),
który posłuży jako powtarzalny layout dla serii "20 lat Fresh Market – Historia wystawców".

Layout podziel na cztery strefy od góry do dołu:

1) TOP BAND (stały, nie zmieniam między grafikami)
   - Wysokość: 96 px
   - Tło: solid #1F7A3A (Fresh Market green)
   - Napis wyśrodkowany w pionie i poziomie:
     "20 LAT FRESH MARKET · HISTORIA WYSTAWCÓW"
   - Font: Montserrat Bold, 22 pt, kolor biały #FFFFFF, uppercase, letter-spacing 2
   - Po lewej stronie bandu: biały znaczek jubileuszowy "20" w okręgu (średnica 64 px), Montserrat Black

2) YEAR BLOCK (zmienny — podmieniam rok)
   - Wysokość: 180 px
   - Tło: #F6FBF3 (bardzo jasny zielony, niemal biały)
   - Duży rok, np. "2008" — wyśrodkowany
   - Font: Montserrat Black, 140 pt, kolor #1F7A3A
   - Pod rokiem cienka linia 2 px × 120 px, kolor #7CB342, wyśrodkowana

3) PHOTO AREA (zmienne — podmieniam zdjęcie archiwalne)
   - Wysokość: ~620 px (reszta kadru)
   - Zdjęcie wypełniające, mode: "Fit frame" (crop do środka jeśli trzeba)
   - Efekt: delikatne zgaszenie nasycenia -15, kontrast +10 (żeby archiwalne zdjęcia wyglądały spójnie)
   - Na dole zdjęcia liniowy gradient #1F7A3A alpha 0% → alpha 75%, wysokość 280 px
     (żeby napis na dole był zawsze czytelny)

4) LOWER LOCKUP (zmienny — podmieniam nazwę firmy i hasło; nakładka na dolnej części zdjęcia)
   - Nazwa firmy: Montserrat Black, 56 pt, biała, wyśrodkowana, pozycja ok. 160 px od dolnej krawędzi
     Przykład: "MEGA FRESH"
   - Pod nazwą: hasło (6–10 słów), Montserrat Medium Italic, 26 pt, białe @ 90% opacity,
     wyśrodkowane, pozycja ok. 80 px od dolnej krawędzi
     Przykład: "Gdy rynek warzyw dopiero nabierał skali"
   - Logo Fresh Market 2026 (wersja biała, wys. 40 px) w prawym dolnym rogu, margines 40 px

Zachowaj wszystkie warstwy nazwane i pogrupowane:
  [00] TOP BAND (locked)
  [01] YEAR
  [02] PHOTO
  [03] COMPANY
  [04] TAGLINE
  [05] LOGO
Dzięki temu będę podmieniał tylko cztery grupy (01–04) dla każdej kolejnej grafiki.
```

---

## 2. Specyfikacja techniczna (dla ręcznej pracy w Photoshopie)

### Kanwa
- Rozmiar: **1080 × 1080 px**
- DPI: 300, Color mode: RGB, 8-bit
- Safe area: 48 px od każdej krawędzi

### Paleta kolorów
| Rola | Kolor | HEX |
|---|---|---|
| Primary green (Fresh Market) | ciemny, liściasty | `#1F7A3A` |
| Accent green | jaśniejszy, trawiasty | `#7CB342` |
| Tło year block | prawie biały z zielonkawym tintem | `#F6FBF3` |
| Text na tle jasnym | ink | `#0F172A` |
| Text na zieleni | biały | `#FFFFFF` |

### Typografia
- **Headline / nazwa firmy / rok:** Montserrat Black
- **Top band:** Montserrat Bold, uppercase, letter-spacing 2
- **Hasło:** Montserrat Medium Italic
- **Fallback** (gdyby Montserrat nie było): Arial Black / Arial

### Wymiary pasków (w px, od góry)
| # | Strefa | Wysokość | Tło |
|---|---|---|---|
| 1 | Top band | 96 | `#1F7A3A` |
| 2 | Year block | 180 | `#F6FBF3` |
| 3 | Photo + gradient | 804 | archiwalne zdjęcie |

---

## 3. Co podmieniasz dla każdej grafiki (tylko te 4 rzeczy)

1. **ROK** — np. `2008`, `2009`, `2012`...
2. **NAZWA FIRMY** — np. `MEGA FRESH`, `TAJFUN`, `MIORTO`...
3. **ZDJĘCIE** — archiwalne, podstaw do warstwy `[02] PHOTO`
4. **HASŁO** — 6–10 słów, np. `Gdy rynek warzyw dopiero nabierał skali`

---

## 4. Hasła (propozycje z wątku + moje dopełnienia)

**Mega Fresh 2008:**
- Gdy rynek warzyw dopiero nabierał skali
- Początki nowoczesnych dostaw do sieci
- Gdy rozdrobniona produkcja nie nadążała za popytem

**Tajfun / Miorto 2008 (sałaty pakowane):**
- Gdy sałaty pakowane przyjechały z Włoch
- Polska odkrywała lekkie sałaty
- Początek ery pakowanych sałat

**Uniwersalne ramy dla kolejnych firm:**
- „Gdy [kategoria] dopiero [czasownik w przeszłości]"
- „Początki [rzecz] w Polsce"
- „Kto pamięta [konkret]?"
- „Zanim [dzisiejsza norma] stała się standardem"

---

## 5. Checklist przed eksportem każdej grafiki

- [ ] Top band bez zmian
- [ ] Rok we właściwym kolorze `#1F7A3A`
- [ ] Zdjęcie archiwalne: nasycenie -15, kontrast +10
- [ ] Gradient dolny (zieleń → przeźroczyste) widoczny
- [ ] Nazwa firmy czytelna (biała, wyśrodkowana)
- [ ] Hasło 6–10 słów, nie więcej
- [ ] Logo FM2026 w prawym dolnym rogu
- [ ] Export: PNG, sRGB
- [ ] Nazewnictwo pliku: `FM2026_20lat_{rok}_{firma}.png` (np. `FM2026_20lat_2008_MegaFresh.png`)

---

## 6. Sugerowany workflow w Photoshop (web)

1. **Zbuduj master plik** `FM2026_Template_Master.psd` z wszystkimi warstwami (pkt 1 powyżej). Zablokuj warstwy [00] i [05].
2. **Duplikuj** plik dla każdej grafiki: `Save As → FM2026_20lat_2008_MegaFresh.psd`
3. **Podmień 4 rzeczy** (rok, firma, zdjęcie, hasło)
4. **Eksport** PNG przez `Quick Export`
5. **Batch:** gdy zrobisz 5–10 sztuk, zrób mini-kontrolę spójności (ustaw obok siebie i sprawdź czy wszystkie wyglądają jak jedna seria)

---

## 7. Opis pod post na LinkedIn (szablon)

```
{ROK} — {FIRMA}

{1 zdanie: co widać na zdjęciu}
{2–4 zdania: co się wtedy działo na rynku warzyw/owoców/kwiatów}
{1 zdanie: dlaczego to zdjęcie jest ważne dzisiaj}

Fresh Market 2026 to 20. edycja wydarzenia — dlatego wracamy do takich zdjęć
i przypominamy firmy, które tworzyły ten rynek od początku.

Kto pamięta tamte czasy?

#FreshMarket2026 #20latFreshMarket #HistoriaRynku #FreshProduce #Retail
```
