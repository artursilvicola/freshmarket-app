# Assets — placeholdery do podmiany

Wszystkie pliki w `public/assets/` to **wygenerowane placeholdery** (białe tło, ramka brand, nazwa firmy). Należy je podmienić na prawdziwe loga i grafiki przed publikacją.

## Skąd wziąć oryginały

Najszybsza droga: pobrać ze starej strony **freshmarket.eu** (router.php). Loga są w katalogach `wp-content/uploads/` lub bezpośrednio w `assets/` na cyber-folks (FTP: `s56.cyber-folks.pl:2223`).

## Lista placeholderów (47 PNG/JPG + 1 MP4) wygenerowanych automatycznie

### Branding (SVG — można zostawić jeśli pasuje)
- `assets/logo-freshmarket-2026.svg` — główne logo (zielony + pomarańczowy)
- `assets/logo-freshmarket-2026-white.svg` — wersja na ciemne tło
- `assets/flags/en.svg` — flaga UK (gotowa, nie trzeba podmieniać)
- `assets/flags/pl.svg` — flaga PL (gotowa, nie trzeba podmieniać)
- `favicon.svg` — ikonka FM (zielony/pomarańczowy)

### Loga sieci handlowych 2026 (6 PNG)
`assets/logos/retailers/` — Archelan, Auchan, Biedronka, Carrefour, Dino, Rohlik.cz

### Loga dystrybutorów 2026 (14 PNG)
`assets/logos/distributors/` — Augma, Bimaro, Bukat, Consorfrut, Fruland, Green Factory, Greenyard, TITBIT, Bury, Fresh Factory, Fresh World, Frutreal, OGL, Pazal

### Loga uczestników 2025 (20 PNG)
`assets/logos/participants-2025/` — Albert, Auchan, Biedronka, Bingo, Carrefour, IKI, Nasz Sklep, Profi, Archelan, ATB, BILLA, Dino, Intermarche, Polo Market, Rohlik, Sinclair, SPAR, Stokrotka, Topaz, VARUS

### Loga firm cytujących (6 PNG)
`assets/logos/reviews/` — AKSUN, Carrefour, Fruitnet, Greenyard, Hazera, JM Biedronka

### Inne
- `assets/images/exhibition-hero.jpg` — hero strony Exhibition (1600×600)
- `assets/video/hero-bg.mp4` — wideo tła homepage (12KB placeholder z obrazka)

## Jak podmienić

**Wariant A — przez Decap CMS (najwygodniej dla edytora):**
1. Wejdź na `https://freshmarket.eu/admin/`
2. CMS → Strony → Główna → Hero → wybierz nowy obraz/video
3. Albo przez Media library: upload do `public/assets/uploads/`

**Wariant B — bezpośrednio w repo (technicznie):**
1. Skopiuj prawdziwe pliki PNG/MP4 do tych samych ścieżek (zachowując nazwy)
2. Commit + push → Netlify auto-deploy

## Przyszłość — Cloudinary

Dla zdjęć i wideo długoterminowo zalecane Cloudinary (auto-resize, WebP, CDN):

```yaml
hero:
  background_video: "https://res.cloudinary.com/freshmarket/video/upload/q_auto/hero.mp4"
```
