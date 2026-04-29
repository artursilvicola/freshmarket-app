# Fresh Market 2026 — "20th Edition · Exhibitor Stories"

System produkcyjny dla serii ~40 archiwalnych grafik LinkedIn/Facebook.

## Zawartość folderu

- `FM2026_20th_{rok}_{firma}_A_1080x1350.png` — **Wariant A** (editorial / premium): tekst firmowy nałożony na dolną część zdjęcia z gradientem zieleni, typografia serif Lora, subtelna winieta i ziarno papieru.
- `FM2026_20th_{rok}_{firma}_B_1080x1350.png` — **Wariant B** (social-friendly): zdjęcie bez nakładki tekstowej, dolny blok tekstu na ciemnej zieleni, czytelniejsze na małych ekranach.
- `FM2026_20th_2008_MegaFresh_A_1080x1080.png` — eksport kwadratowy tego samego masteru (dla uniwersalnego feedu).
- `fm_series_generator.py` — skrypt Pythona produkujący grafiki seryjnie.
- `exhibitors.csv` — przykładowy plik wejściowy do batcha.

## Dlaczego PNG, nie PSD?

PSD to natywny format Adobe i nie da się go wygenerować spoza Photoshopa z pełną edytowalnością (Smart Objects, live text layers). Zrobiłem więc **pixel-perfect wersje PNG**, które:

1. Możesz używać **bezpośrednio** na LinkedIn / Facebook — są gotowe do publikacji.
2. Możesz otworzyć w Photoshopie jako referencję i zbudować obok PSD z warstwami (wymiary, pozycje, kolory są zdefiniowane w `fm_series_generator.py` — sekcja `CONFIGURATION`).
3. Możesz regenerować zmieniając parametry w CSV (patrz poniżej) — nie musisz w ogóle używać Photoshopa.

## Jak wyprodukować wszystkie ~40 grafik

### Opcja 1 — bez Photoshopa (rekomendowane dla szybkiej produkcji)

1. Umieść archiwalne zdjęcia w podfolderze, np. `photos/`.
2. Wypełnij `exhibitors.csv`:
   ```csv
   year,company,tagline,photo_path
   2008,Mega Fresh,When vegetable production was still catching up,photos/megafresh_2008.jpg
   2008,Tajfun,When packaged salads first arrived from Italy,photos/tajfun_2008.jpg
   ...
   ```
3. Uruchom (dla wariantu A):
   ```bash
   python3 fm_series_generator.py --batch exhibitors.csv --variant A
   ```
   Dla wariantu B: dodaj `--variant B`.

Skrypt przetwarza każde zdjęcie: kadrowanie z zachowaniem środka (safe dla twarzy), delikatna korekta tonalna (kontrast 1.05, nasycenie 0.92, brightness 0.98) — **bez** zmian twarzy, bez AI-upiększania.

### Opcja 2 — w Photoshopie (jeśli chcesz ręcznej kontroli)

Otwórz wygenerowany PNG (wariant A lub B) jako warstwę referencyjną. Odtwórz strukturę warstw:

```
00_GUIDES              — prowadnice 80 px od krawędzi
01_BACKGROUND_TEXTURE  — ciemna zieleń #1B3A2A + subtelne grain
02_TOP_BANNER          — cream #F4EBD8, miękko wygięty dolny brzeg
03_SERIES_TITLE        — "20TH EDITION OF FRESH MARKET · EXHIBITOR STORIES"
                         Lora 26 pt, letter-spacing 3, INK #1C2820
04_YEAR                — Lora 110 pt, OFF_WHITE #F8F4EA
05_PHOTO_SMART_OBJECT  — archiwalne zdjęcie (Smart Object!)
06_PHOTO_ADJUSTMENT    — Curves/Levels, gentle contrast, -8 saturation
07_BOTTOM_GRADIENT     — gradient zieleni #1B3A2A 0→75% alpha (dolne 38% zdjęcia)
08_FRESH_MARKET_YEAR   — "FRESH MARKET 2008", Poppins Medium 22 pt, gold #BF9E61
09_COMPANY_NAME        — Lora 56 pt, OFF_WHITE
10_TAGLINE             — Lora Italic 30 pt, CREAM_SOFT
11_EXPORT_GUIDES       — markery export 1080×1350 / 1080×1080 / 1200×1500
```

## Paleta

| Rola | HEX | Użycie |
|---|---|---|
| Green Deep | `#1B3A2A` | tło główne, gradient overlay |
| Green Rich | `#1F4A34` | subtelny gradient w tle |
| Cream | `#F4EBD8` | baner górny |
| Gold / Beige | `#BF9E61` | separator, hairline frame |
| Off-White | `#F8F4EA` | tekst na zieleni |
| Ink | `#1C2820` | tekst na cream |

## Typografia (zainstalowane w generatorze)

- **Lora** (variable serif) — tytuł serii, rok, nazwa firmy, tagline (italic)
- **Poppins** (medium/bold) — linia eventu "FRESH MARKET {year}"

Jeśli chcesz inny serif (Playfair, Cormorant, EB Garamond) — zainstaluj w systemie, podmień ścieżkę w `fm_series_generator.py` (stałe `FONT_LORA`, `FONT_LORA_ITALIC`).

## Ważne zasady (wbudowane w skrypt)

- Kadrowanie z zachowaniem **środka zdjęcia** — twarze i logo firm nie są brutalnie odcinane.
- Korekta tonalna **subtelna** — nie ma AI-upiększania, zmiany twarzy, przesadnego HDR.
- Pozycje wszystkich elementów **identyczne** dla wszystkich 40 grafik — seria zachowuje spójność.
- Jeśli dostarczysz poprawny PNG z logiem Fresh Market — dodaję do prawego dolnego rogu bez deformacji (obecny master działa bez logo, zgodnie z brifem: "priorytetem jest seria tytułowa").

## Stałe dane do grafiki

Zmieniasz tylko 4 pola: `year`, `company`, `tagline`, `photo_path`.
Wszystko inne (baner, typografia, kolory, układ) jest zablokowane w skrypcie/szablonie.
