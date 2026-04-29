# Fresh Market 2026 — Audyt IT
**Data:** 22 kwietnia 2026
**Zakres:** freshmarket.eu (działanie techniczne, nie treść merytoryczna)
**Metodyka:** crawl via browser (40+ endpoints), inspekcja nagłówków HTTP, DOM, konsoli, zasobów, Performance API, próba dostępu do typowych ścieżek wrażliwych

---

## TL;DR

Strona techniczie działa i jest szybka (TTFB ~300 ms, HTTP/2 + HTTP/3, Brotli), ale ma kilka **krytycznych** problemów wpływających na SEO, wiarygodność i bezpieczeństwo. Najpoważniejsze:

1. **Stary WordPress na `old.freshmarket.eu` nadal żyje publicznie** — 18 pending updates, 1805 komentarzy w moderacji, admin bar WP wyświetla się w HTML. Każdy język poza PL (EN/ES/IT/DE/RU) linkuje właśnie tam, a 3/5 z tych redirectów daje 404.
2. **Brak podstawowych meta-tagów SEO** (opis, canonical, hreflang, og:\*) na całej witrynie; `/robots.txt` i `/sitemap.xml` zwracają 404.
3. **API `/api/venue-stands` jest publiczne i ujawnia wewnętrzne notatki** ("wolne w rzeczywistości", "test", "dla sponsor") oraz nazwy firm bez dostępu użytkownika.
4. **Brak HSTS/CSP/Permissions-Policy** — podstawowa higiena nagłówków bezpieczeństwa niewdrożona.
5. **Tytuły stron `/pl/*` są po angielsku** ("Contact — Fresh Market", "Venue — Fresh Market") — tłumaczenie niepełne.

Wszystko poniżej — z priorytetami.

---

## Priorytet 0 — Krytyczne (do zrobienia natychmiast)

### P0.1 — Stary WordPress na `old.freshmarket.eu` jest nadal publiczny i zaniedbany
- `https://old.freshmarket.eu/` → 200 OK, 368 KB, pełny stary serwis ("Fresh Market 2026 | 24 September 2026…").
- W HTML widoczny admin bar WordPress: *"18 updates available"*, *"1,805 Comments in moderation"*, użytkownik *arturfresh* zalogowany.
- Wtyczki widoczne: Avada, WPCode, Simply Static, SEO, Translate Page, Forms — wszystkie z zaległymi aktualizacjami.
- Z powodu tej domeny domeny językowe nowego serwisu są rozbite (zob. P0.2).

**Ryzyko:** publicznie wystawiony CMS z 18 niezałatanymi aktualizacjami i 1805 komentarzami w moderacji to typowy wektor włamania (znane CVE w WP/Avada, spam w komentarzach, eksfiltracja bazy). Ślady starej bazy klientów, zgłoszeń, maili — wszystko potencjalnie dostępne dla włamywacza.

**Co zrobić:**
1. Natychmiast zablokować dostęp do `old.freshmarket.eu` spoza Waszego IP (HTTP Basic Auth lub Nginx `allow/deny`).
2. Zrobić pełen backup (bazy + plików) i zarchiwizować.
3. Zdecydować: albo całkowite wyłączenie subdomeny (jeśli nie jest potrzebna nigdzie — po decyzji sprawdzić, czy żadne linki z zewnątrz tam nie prowadzą), albo wdrożenie Simply Static → statyczny snapshot bez PHP/WP.
4. Zdjąć rekord DNS `old.freshmarket.eu` lub przekierować 301 na nowy serwis.

### P0.2 — Wszystkie języki poza PL linkują do zepsutego starego serwisu
| Ścieżka | Redirect do | Wynik |
|---|---|---|
| `/en` | `old.freshmarket.eu/en` | **404** |
| `/it` | `old.freshmarket.eu/it` | **404** |
| `/de` | `old.freshmarket.eu/de` | **404** |
| `/es` | `old.freshmarket.eu/es` | 200 (ale strona po angielsku!) |
| `/ru` | `old.freshmarket.eu/ru` | 200 (też po angielsku!) |

Użytkownik klikający flagę EN/ES/IT/DE/RU w menu trafia na stary WordPress albo stronę 404 pod inną subdomeną. Z punktu widzenia widza to wygląda jakby strona była zepsuta.

**Co zrobić (decyzja biznesowa):**
- Jeśli ES/IT/DE/RU nie są obecnie utrzymywane → **usunąć flagi z menu** i zrobić 301 z `/en`, `/es`, `/it`, `/de`, `/ru` na stronę główną lub na kierunek PL/EN.
- Jeśli mają być w planach → zaimplementować je na nowym CMS (analogicznie jak `/pl`) zamiast trzymać je na starym WP.

### P0.3 — Publiczne API `/api/venue-stands` ujawnia wewnętrzne notatki
`GET https://freshmarket.eu/api/venue-stands` zwraca bez uwierzytelnienia JSON z 64 stoiskami. W polach `note` widać:
- `"wolne w rzeczywistości"` (stand 13 — oznaczone jako reserved, ale w rzeczywistości wolne)
- `"dla sponsor"` (stand 5, 6 — oznaczone jako booked, ale to notatka wewnętrzna)
- `"test"` (stand 10)
- `"wstępnie dla Brazyli"` (stand 8, 9)
- nazwy firm bookujących (Greenyard, Bayer_Polska, Yuksel Seeds itd.) — to w zasadzie jest OK dla mapy publicznej, ale zwykle prezentuje się to graficznie, nie w surowym JSON

**Ryzyko:** konkurent lub klient widzi Wasze wewnętrzne adnotacje sprzedażowe. Firmę ubiegającą się o rezerwację mogę poinformować, że "wybrane stoisko jest oznaczone jako zajęte, ale Wasza notatka mówi że jest wolne" → to zła optyka.

**Co zrobić:** rozdzielić pole `note` (internal) od `public_note`; z API zwracać tylko to drugie (i to opcjonalnie). Albo w ogóle nie zwracać `note` dla ruchu anonimowego.

### P0.4 — `robots.txt` i `sitemap.xml` zwracają 404
- `GET /robots.txt` → 404 (HTML, nie plain text)
- `GET /sitemap.xml` → 404

Google Search Console się oburzy; crawlery nie mają listy stron do zaindeksowania. Z punktu widzenia SEO to blocker.

**Co zrobić:**
- `robots.txt` — minimum: `User-agent: *` + `Allow: /` + `Sitemap: https://freshmarket.eu/sitemap.xml` + zakazać `/admin/`, `/b2b/`, `/_embed/`.
- `sitemap.xml` — wygenerowany automatycznie z listy aktywnych stron w CMS (PL + EN), z `<lastmod>` i `<xhtml:link rel="alternate" hreflang="…">` dla par językowych.

### P0.5 — Brak meta description / canonical / og:* / hreflang na całej witrynie
Na `/`, `/pl`, `/contact`, `/pl/contact`, `/venue-plan`, `/pl/venue-plan`, `/exhibitors`, `/pl/exhibitors`, `/retail-chains`, `/pl/retail-chains`, `/about-freshmarket-kjow` — **zero** meta description, zero canonical, zero og:title/og:image/og:description, zero twitter:card, zero hreflang.

**Wpływ:**
- Google wyświetla losowy fragment tekstu w SERP (zamiast kontrolowanego opisu).
- Strona udostępniona na LinkedIn / Facebook / Slack pokazuje się **bez obrazka i bez opisu** — to samobójcze dla wydarzenia B2B.
- Duplikaty `/` i `/pl/xxx` konkurują między sobą bez canonical — Google nie wie, która jest wersją kanoniczną.
- Brak hreflang = Google nie wie, że `/contact` i `/pl/contact` to ta sama strona w dwóch językach.

**Co zrobić:** w CMS (Page Builder) dodać pola per-strona: *Meta Description*, *OG Image*, *OG Title* (fallback do `<title>` i globalnego obrazka). Wygenerować canonical automatycznie z URL, a parę EN/PL powiązać hreflang-ami w `<head>`:
```html
<link rel="canonical" href="https://freshmarket.eu/contact">
<link rel="alternate" hreflang="en" href="https://freshmarket.eu/contact">
<link rel="alternate" hreflang="pl" href="https://freshmarket.eu/pl/contact">
<link rel="alternate" hreflang="x-default" href="https://freshmarket.eu/contact">
```

---

## Priorytet 1 — Wysokie

### P1.1 — Brak HSTS i innych nowoczesnych security headers
Obecnie ustawione: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-XSS-Protection`.

Brakuje:
- **`Strict-Transport-Security`** (HSTS) — wymusza HTTPS w przeglądarce. Rekomendacja: `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`
- **`Content-Security-Policy`** (CSP) — obecnie dowolny skrypt z dowolnej domeny może się ładować. Minimum: ograniczyć do `freshmarket.eu`, Google (Analytics, Maps, YouTube, reCAPTCHA), Facebook (Pixel). Zacząć w `Content-Security-Policy-Report-Only` żeby nic nie zepsuć.
- **`Permissions-Policy`** — np. `camera=(), microphone=(), geolocation=()` jeśli strona tego nie używa.
- **`Cross-Origin-Opener-Policy: same-origin`** i `Cross-Origin-Resource-Policy: same-site` — hardening dla Spectre-like attacks.

### P1.2 — `/pl/about` jest rozbity (broken redirect)
- `/pl/about` → 301/302 → `/pl/about-freshmarket-kjow` → **404**
- `/about` → `/about-freshmarket-kjow` → 200 OK

Oznacza to, że CMS wygenerował słownik tłumaczeń slug-ów, ale dla polskiej wersji strony "about" nie ma odpowiednika. W menu PL nie ma linku do "about" → użytkownik który ręcznie wpisze adres, dostanie 404. Należy albo:
- stworzyć polską wersję slug (`/pl/o-freshmarket` albo `/pl/o-nas`) i wpiąć ją,
- albo zrobić 301 z `/pl/about` na EN wersję.

**Uwaga:** slug `about-freshmarket-kjow` z losowymi znakami wygląda jak auto-wygenerowany przez CMS. Zmieniłbym go na czytelny (`/about`, `/pl/o-nas`).

### P1.3 — Facebook Pixel podwojony (duplicate pixel ID)
W konsoli: `[Meta Pixel] - Duplicate Pixel ID: 802503549881155`.

Pixel ładuje się dwa razy → wszystkie konwersje, `PageView`, `Lead`, `Purchase` są liczone podwójnie w Meta Ads Manager. Jeśli reklamujecie się na Facebook/Instagram, macie fałszywe dane ROAS (o połowę niższy niż faktyczny) i Meta optymalizuje na zduplikowane sygnały.

**Co zrobić:** znaleźć gdzie pixel jest wstawiany 2x (zwykle: raz w base template + raz przez GTM, albo dwa wklejki w CMS). Usunąć jedno.

### P1.4 — Google Analytics zwraca 503 (pojedyncza obserwacja)
`POST region1.analytics.google.com/g/collect → 503` podczas jednego z fetchy. Może być chwilowe, ale warto sprawdzić w GTM/DebugView czy dane chodzą. Jeśli 503 powtarza się — to przerwa w zbieraniu danych i zwykle oznacza że `gtag.js` został wstawiony niepoprawnie albo CDN Google jest filtrowany przez regionalny firewall.

### P1.5 — Brak CAPTCHA/ratelimitu na formularzu kontaktowym
Z analizy zgubionych zgłoszeń (18 przed naprawą SMTP, z których ~13 wyglądało na spam/boty): `BradleyWrarp`, `NAERTREGE...`, `1winazerbaijanb`, `v3dN...` to zaawansowani spamerzy. Teraz kiedy wiadomości dochodzą, inbox `artur.stasiak@` dostanie tego więcej.

**Co zrobić:**
- dodać reCAPTCHA v3 (invisible) albo Cloudflare Turnstile na `/api/contact` i `/api/venue-reservations`,
- trzymać honeypot (już jest: pole `f_hp` i `website` — dobre),
- ratelimiting per IP (np. max 3 zgłoszenia / godzinę) w MailService albo na poziomie LiteSpeed/mod\_security.

### P1.6 — `.env` zwraca 406 zamiast 404
`GET /.env` → HTTP 406 (Not Acceptable). To sugeruje że plik fizycznie istnieje w katalogu publicznym, a mod\_security lub reguła web serwera go blokuje. Lepiej:
1. Przenieść `.env` **poza `public_html/`** (np. `/home/rxdpelhpvh/domains/freshmarket.eu/.env` i ładować przez `require_once __DIR__.'/../../.env.php'`).
2. Jeśli musi zostać w `public_html`, dodać `.htaccess`/LiteSpeed rule na zwrot 404 zamiast 406 (nie ujawniać istnienia).

Aktualnie ekspozycja jest prawdopodobnie bezpieczna (LiteSpeed blokuje serwowanie), ale 406 vs 404 to sygnał dla atakującego, że coś tam jest.

---

## Priorytet 2 — Średnie

### P2.1 — Tytuły stron `/pl/*` nie są przetłumaczone
| Ścieżka | Tytuł |
|---|---|
| `/pl` | "Fresh Market — B2B Meeting & Trade Show" (❌ EN) |
| `/pl/contact` | "Contact — Fresh Market" (❌ EN) |
| `/pl/venue-plan` | "Venue — Fresh Market" (❌ EN) |
| `/pl/exhibitors` | "Exhibitors — Fresh Market" (❌ EN) |
| `/pl/retail-chains` | "Retail Chains Hub — Fresh Market" (❌ EN) |

Dodać do CMS pole *Title PL* albo przynajmniej domyślne tłumaczenia nagłówków sekcji. Wpływa na CTR w Google (tytuł wyświetla się w SERP-ach) i UX (zakładka przeglądarki po angielsku na polskim serwisie).

### P2.2 — Faviconaprzewraca 404
`GET /favicon.ico` → 404 (zwraca stylowaną stronę 404 o wielkości 10 KB — zamiast malutkiej ikony serwer wysyła duże HTML!). Rekomendacja: dodać statyczny `favicon.ico` (najlepiej zestaw `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`, `site.webmanifest`).

### P2.3 — 107 obrazków bez `srcset` (brak responsive images)
Homepage ma 107 `<img>`, wszystkie z pojedynczym `src`, żaden z `srcset`/`<picture>`. To oznacza że mobilny użytkownik ściąga ten sam 1920×1080 JPEG co desktop → waste bandwidth. Rozkład formatów: 64 WebP ✓, 40 PNG ✗ (powinno być WebP/AVIF), 3 JPG.

**Co zrobić:** CMS image uploader powinien automatycznie generować 3–4 warianty rozdzielczości + używać `<picture>` albo `srcset="...480w, ...960w, ...1920w"`.

### P2.4 — YouTube iframe i zewnętrzne ramki blokują metryki ładowania
Performance timing pokazuje `loadEvent: 3576ms` (vs TTFB: 306 ms, DOMContentLoaded: 722 ms). Różnica to głównie YouTube iframe (3189 ms) + Google Maps iframe. Rekomendacja: lazy-load tych iframe-ów (`loading="lazy"` albo podmiana na placeholder + iframe po kliknięciu).

### P2.5 — 34 KB inline CSS + 41 KB inline JS na każdej stronie
CSS/JS wklejone bezpośrednio w `<head>`/`<body>`. Brak cachowania między stronami → każda nawigacja to pełen download ~75 KB. Lepiej wyekstrahować do zewnętrznych plików z długim `Cache-Control: max-age=31536000, immutable` i hash-based cache busting. Zwłaszcza że `Cache-Control` na HTML jest `no-store` — tym bardziej warto cache'ować assety.

### P2.6 — HTML lang="en" na stronie głównej `/`
`<html lang="en">` na `/`, `<html lang="pl">` na `/pl` — niby spójne, ale dla `/` nie jest oczywiste że to strona anglojęzyczna (domyślnie serwowana wszystkim). Screen readery i Google biorą to dobrze, tylko zostawiam jako obserwację — spójne z decyzją o EN jako domyślnym.

### P2.7 — Admin bez rate-limiting / IP allowlist
`/admin/login` jest publicznie dostępne pod swoim URL. Nie widziałem czy jest rate-limiting prób logowania (np. fail2ban, LiteSpeed Login Firewall). Rekomendacja:
- włączyć 2FA dla wszystkich kont admin (widać w menu że jest opcja "2FA"),
- ograniczyć `/admin/*` do białej listy IP (biuro + Arthur VPN),
- zalogować każdą próbę logowania i monitorować.

---

## Priorytet 3 — Niskie / higiena

### P3.1 — Cache-Control `no-store` na HTML
Wszystkie strony HTML mają `Cache-Control: no-store, no-cache, must-revalidate, max-age=0`. To obronna konfiguracja — dobre dla dynamicznego contentu, ale oznacza też że CDN (jeśli dodacie Cloudflare) nie będzie cache'ować. Dla stron marketingowych spokojnie można dać `max-age=300, s-maxage=3600, stale-while-revalidate=86400`.

### P3.2 — 2 obrazki bez `alt` (dostępność)
Drobne — 2 ze 107 na stronie głównej nie mają atrybutu `alt`. WCAG A. Uzupełnić.

### P3.3 — Header bez elementu `<header>` semantycznie
`document.querySelectorAll('header a').length === 0` — nawigacja jest w `<nav>`, co jest OK, ale warto dodać `<header>` wrapper dla semantyki (accessibility + SEO structured data).

### P3.4 — GET na `/api/contact` zwraca homepage (200) zamiast 405
Endpointy POST-only powinny zwracać `405 Method Not Allowed` na GET. Obecnie `/api/contact` GET → HTML homepage PL (200 OK, 108 KB). To nie błąd funkcjonalny, ale: (a) marnujemy 108 KB, (b) psujemy crawlerom (indeksują `/api/contact` jako kopię homepage).

### P3.5 — Brak polityki cookie w JSON/machine-readable formacie
Cookie banner `fm-cookie-v2` istnieje ✓. Warto jednak:
- dodać kategorie (niezbędne / analityczne / marketingowe) jeśli jeszcze nie ma,
- zalogować consent per user w bazie (data, IP, wersja polityki) — RODO wymaga udowodnienia zgody,
- w Manage podać listę konkretnych cookies/pixeli (GA4, Facebook Pixel, …) z ich TTL i celem.

### P3.6 — Brak cross-origin fetch protection na API
`/api/venue-stands` i `/api/contact` nie wysyłają CORS headerów — są przez to "zamknięte" do `freshmarket.eu`. OK. Ale jeśli kiedyś potrzebujecie wystawić API na zewnątrz (mobile app, partner), zrobić to explicit (nie wildcardem `*`).

### P3.7 — Pozostałości diagnostyczne w danych produkcyjnych
W bazie stoisk widać: `Fresh Market E2E Diagnostic` (stand 1 — to ja z testu), `"test"` (stand 10). Warto mieć procedurę cleanup testowych rezerwacji (albo osobne środowisko staging).

---

## Co działa bardzo dobrze ✅

- **TTFB ~300 ms** na homepage — backend jest szybki (PHP + LiteSpeed + MySQL na cyber-folks).
- **HTTP/3 + HTTP/2 fallback** (alt-svc header).
- **Brotli compression** — 108 KB HTML → 19.6 KB transfer (5.5× kompresja).
- **Obrazki lazy-loaded** (`loading="lazy"` wszędzie).
- **64 z 107 obrazków w formacie WebP**.
- **Honeypot fields** (`f_hp`, `website`) w formularzach — podstawowa ochrona przed spamem.
- **Cookie banner wdrożony**.
- **`/uploads/`, `/.git/*` zwracają 403** — dostęp do artefaktów Git i listingu katalogów zablokowany.
- **`phpmyadmin` nie jest wystawiony** (przekierowanie do landing cyber-folks).
- **Admin CSRF tokens** na formularzach (widziałem `csrf_token` w formularzach kolejki email).
- **Struktura URL czysta** — slug-ify, trailing slash konsekwentny, polskie slugi z PL prefix.

---

## Rekomendowana kolejność wdrożenia

1. **Dziś / jutro:** P0.1 (zablokować dostęp do old.freshmarket.eu), P0.4 (dodać robots.txt + sitemap.xml), P1.6 (przenieść .env), P1.3 (usunąć zduplikowany FB Pixel).
2. **Ten tydzień:** P0.2 (naprawić flagi EN/ES/IT/DE/RU), P0.3 (rozdzielić public/internal note w API), P0.5 (dodać meta description/og:* w CMS), P1.1 (HSTS + CSP w trybie report-only), P1.5 (reCAPTCHA).
3. **Następne 2 tygodnie:** P1.2 (naprawić /pl/about), P2.1 (tłumaczenia tytułów), P2.2 (favicon), P2.3 (responsive images).
4. **Przy okazji kolejnego deploymentu:** P2.4–P2.6, P3.*

---

## Co trzeba doweryfikować (nie dało się z tego sandboxa)

- **TLS grading** — `ssllabs.com/ssltest/analyze.html?d=freshmarket.eu` — sprawdzić wersje TLS, cipher suites, ważność certu, OCSP stapling. Odpalić raz, zapisać wynik.
- **DNS health** — CAA records, DNSSEC, MX (po naszej zmianie SMTP), SPF, DKIM, DMARC. Wg `dnschecker.org`.
- **Lighthouse audit** na mobile — DevTools → Lighthouse → mobile → report. Daje Performance, Accessibility, Best Practices, SEO (który pewnie da obecnie <70 przez brak meta).
- **OWASP ZAP / Burp passive scan** — czy są jakieś reflected/stored XSS w formularzach.
- **Logi dostępu** — czy ktoś próbował `/admin/login` brute-force; czy są requesty na `/wp-admin`, `/phpmyadmin` (bots).

---

*Raport wygenerowany automatycznie przez agenta IT podczas sesji Cowork. Żadne zmiany nie zostały wprowadzone — to tylko diagnoza.*
