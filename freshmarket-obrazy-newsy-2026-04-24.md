# Zdjęcia w newsach — fix i zalecenia

**Data:** 2026-04-24
**Status:** CSS naprawiony na serwerze. Działa dla wszystkich istniejących i przyszłych artykułów.

## Co było zepsute

Zdjęcie w artykule "2008 — Agro-Paprix" miało wymiary **1024 × 1536 pikseli (portret, wysokie)**. CSS kontenera `.fm-news-article-hero` nie miał żadnego ograniczenia `max-height` ani `aspect-ratio` — więc przy szerokości 1052px obraz renderował się na **1578 pikseli wysokości** (prawie cały ekran).

Ten problem dotyczył wszystkich artykułów — po prostu do tej pory nikt nie wrzucał tak wysokich obrazów, więc nie było zauważalne.

## Co naprawiono (CSS)

Dodano do `assets/css/style.css` blok reguł ograniczających:

```css
/* FM NEWS HERO IMAGE FIX - added 2026-04-24 */
.fm-news-article-hero {
  max-width: 1100px;
  margin: 0 auto 24px;
  overflow: hidden;
  border-radius: 8px;
  background: #f8f8f8;
  text-align: center;
}
.fm-news-article-hero img {
  max-width: 100%;
  max-height: 500px;
  width: auto;
  height: auto;
  display: inline-block;
  object-fit: contain;
}
@media (max-width: 768px) {
  .fm-news-article-hero img {
    max-height: 360px;
  }
}
/* news list card thumbnails */
.fm-news-item-thumb, .fm-news-card-thumb {
  max-height: 220px;
  object-fit: cover;
}
```

**Co to robi:**
- Hero image w szczegółach artykułu jest **nie wyższy niż 500 pikseli** (360 na mobile).
- Obraz zachowuje proporcje (`object-fit: contain`) — nie jest rozciągany ani przycinany, ale może mieć szare paski po bokach (tło `#f8f8f8`) jeśli obraz jest bardzo wąski/wysoki.
- Miniaturki na liście newsów nie wyższe niż 220 pikseli.
- Backup oryginalnego CSS: `style.css.bak-20260424-161911`

## Jak zobaczyć efekt w twojej przeglądarce

Cache-buster `?v=...` w URL do CSS aktualizuje się co godzinę (`date('YmdH')` w Router.php). **Po naturalnej zmianie godziny** (17:00, 18:00 itd.) każdy user zobaczy nowy CSS automatycznie bez żadnych działań.

**Żeby zobaczyć TERAZ:**
- Chrome/Edge: **Ctrl + F5** (lub Ctrl + Shift + R) na stronie newsa
- Firefox: **Ctrl + Shift + R**
- Safari: **Cmd + Option + R**
- Lub otwórz DevTools (F12) → Network → zaznacz "Disable cache" i odśwież

## Optymalne wymiary obrazu do uploadu

Admin UI już to pokazuje ("Zalecane: 1200×800px, JPG/PNG/WEBP, maks. 2MB"), ale warto zapamiętać kryteria:

### Dla hero image w artykule

| Parametr | Wartość | Dlaczego |
|---|---|---|
| **Orientacja** | **landscape (szeroki)** | hero banner wygląda dobrze tylko w poziomie |
| **Proporcje** | **3:2 lub 16:9** | 1200×800 (3:2) lub 1600×900 (16:9) |
| **Rozdzielczość** | **1600 × 900–1100** | ostro na monitorach HD i retina, bez przesady |
| **Format** | **JPG** (dla zdjęć) lub **WebP** | WebP mniejszy o 30-40% przy tej samej jakości |
| **Rozmiar pliku** | **< 500 KB**, idealnie 200–400 KB | szybkie ładowanie na mobile |

### Dla miniaturek w liście (card thumbnails)

Ten sam obraz co hero — system używa tego samego pliku. Miniaturka jest renderowana mniejsza.

### Czego unikać

- **Portretowe (wysokie) zdjęcia** — wyglądają źle jako hero banner, nawet z moim fixem będą małe z szarymi paskami po bokach. Zawsze przytnij lub wybierz inne ujęcie.
- **Zdjęcia < 800px szerokości** — będą pikselizowane na dużych ekranach.
- **Pliki > 2 MB** — spowalnia Lighthouse score, performance, i ma wpływ na SEO.
- **PNG zamiast JPEG dla fotografii** — PNG 3-5× większy niż JPEG dla zdjęć. PNG zostaw do grafik z tekstem, logo, screenshotów.

## Jak przyciąć/zmniejszyć obraz ręcznie przed uploadem

**Najszybciej, online, bez instalacji:**

- **Squoosh** — `https://squoosh.app` — Google, konwersja JPG → WebP, resize, kompresja w jednym miejscu.
- **TinyPNG** — `https://tinypng.com` — kompresja JPG/PNG do 60-80% rozmiaru bez utraty widocznej jakości.
- **iloveimg.com/crop-image** — crop/resize online.

**Lokalnie w Windows:**
- Otwórz zdjęcie w **Aplikacji Zdjęcia** → "Edytuj" → Przycinanie → wybierz proporcje 16:9 lub 3:2.
- Albo Paint → Zmień rozmiar → 1600 px szerokości.

**Jeśli używasz Canva:**
- Ustaw Custom size 1600 × 1000, tam wklej zdjęcie, wyeksportuj jako JPG Q80.

## Opcja na przyszłość: auto-resize przy upload

Obecnie serwer akceptuje upload w dowolnym rozmiarze i zapisuje 1:1 w `/uploads/news/`. Można to zautomatyzować.

### Co trzeba zrobić

W handlerze uploadu newsów (prawdopodobnie w `Router.php` w sekcji `/admin/news/save` lub w `NewsController`) przed `move_uploaded_file()` dodać logikę resize:

```php
// Resize uploaded image to max 1600x1000, keep aspect ratio
$maxWidth = 1600;
$maxHeight = 1000;
$info = getimagesize($_FILES['featured_image']['tmp_name']);
[$origW, $origH, $type] = $info;

if ($origW > $maxWidth || $origH > $maxHeight) {
    $ratio = min($maxWidth / $origW, $maxHeight / $origH);
    $newW = (int)($origW * $ratio);
    $newH = (int)($origH * $ratio);
    
    $src = match($type) {
        IMAGETYPE_JPEG => imagecreatefromjpeg($_FILES['featured_image']['tmp_name']),
        IMAGETYPE_PNG => imagecreatefrompng($_FILES['featured_image']['tmp_name']),
        IMAGETYPE_WEBP => imagecreatefromwebp($_FILES['featured_image']['tmp_name']),
        default => null,
    };
    if ($src) {
        $dst = imagecreatetruecolor($newW, $newH);
        imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
        // Save as WebP at quality 82 for best ratio
        imagewebp($dst, $targetPath, 82);
        imagedestroy($src);
        imagedestroy($dst);
    }
}
```

**Korzyści:**
- User może wrzucić cokolwiek (nawet RAW 20 MB z aparatu) i strona nie zwolni.
- Wszystkie zdjęcia w jednym formacie (WebP) — spójny wygląd, lepsza wydajność.
- Nie trzeba pamiętać o optymalizacji przed uploadem.

**Wymaga rozszerzenia PHP GD** (zwykle jest w cyber-folks). Sprawdź przez `phpinfo()` czy `extension_loaded('gd')` zwraca `true`.

To jest odrębny task — wymaga czasu na refactor plus testy na staging.

## Rollback (w razie problemów z CSS fixem)

```bash
# Przez FTP lub panel cyber-folks:
cd /home/rxdpelhpvh/domains/freshmarket.eu/public_html/assets/css/
mv style.css style.css.new
mv style.css.bak-20260424-161911 style.css
touch style.css
```

To przywraca oryginalny CSS w 5 sekund.
