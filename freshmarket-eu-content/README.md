# freshmarket.eu — Astro + Netlify + Decap CMS

Nowy serwis freshmarket.eu — migracja z `router.php` (cyber-folks) na Astro 5 deployowany na Netlify, z CMS-em opartym o Decap (free, GitHub-backed) dla edycji nietechnicznej.

**Repo (już sklonowane):** [artursilvicola/freshmarket-eu](https://github.com/artursilvicola/freshmarket-eu)
**Production:** https://freshmarket.eu (po migracji DNS)
**Aplikacja B2B:** https://app.freshmarket.eu (PreConnect, osobny deploy → freshmarketb2b.netlify.app)

---

## Struktura projektu

```
freshmarket-eu-content/
  package.json
  astro.config.mjs
  tailwind.config.mjs
  tsconfig.json
  netlify.toml
  .gitignore

  src/
    env.d.ts
    content.config.ts          ← schema kolekcji (Zod)
    styles/global.css
    i18n/translations.ts        ← EN/PL nav, footer, formularze
    layouts/BaseLayout.astro
    components/
      Header.astro              ← logo + nav + EN/PL flagi
      Footer.astro              ← 4 kolumny + KJOW
      Hero.astro                ← bg video lub image + CTA
      CookieBanner.astro
      ContactForm.astro         ← Netlify Forms
      RegistrationForm.astro    ← Netlify Forms (Stripe = TODO)
      AwardForm.astro           ← Netlify Forms (assets via link)
      B2BAppCTA.astro           ← link do app.freshmarket.eu
    pages/
      index.astro               ← EN homepage
      [...slug].astro           ← EN dynamic pages
      404.astro
      pl/
        index.astro             ← PL homepage
        [...slug].astro         ← PL dynamic pages
    content/
      pages/
        en/  (16 plików)        ← treść EN
        pl/  (16 plików)        ← treść PL

  public/
    __forms.html                ← rejestracja Netlify Forms (build-time)
    _redirects                  ← stare URL-e + /app/* → app.freshmarket.eu
    robots.txt
    admin/
      index.html                ← Decap CMS UI
      config.yml                ← schema CMS-u

  netlify/
    functions/
      checkout.js               ← stub Stripe Checkout (do włączenia w II etapie)
```

---

## Instalacja lokalna

```bash
# 1. Sklonuj repo (już zrobione)
git clone https://github.com/artursilvicola/freshmarket-eu.git
cd freshmarket-eu

# 2. Skopiuj cały folder freshmarket-eu-content/* do roota repo
#    (Windows PowerShell — z folderu projektu Cowork):
#    Copy-Item -Recurse -Force "freshmarket-eu-content\*" "<ścieżka-do-clone>\"

# 3. Instalacja zależności
npm install

# 4. Lokalny dev server
npm run dev
# → http://localhost:4321
```

---

## Deploy na Netlify

### Krok 1 — utwórz site

1. Wejdź na https://app.netlify.com
2. **Add new site → Import an existing project**
3. Wybierz GitHub → `artursilvicola/freshmarket-eu`
4. Build settings (autodetect z `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Node version: 20

### Krok 2 — environment variables

W Netlify → Site settings → Environment variables dodaj:

```
PUBLIC_SITE_URL = https://freshmarket.eu
PUBLIC_B2B_URL  = https://app.freshmarket.eu
```

(Stripe i inne sekrety — w II etapie.)

### Krok 3 — Decap CMS przez GitHub OAuth

Decap CMS używa GitHub OAuth do autoryzacji edytorów. Konfiguracja:

1. **GitHub:** Settings → Developer settings → **OAuth Apps** → **New OAuth App**
   - Application name: `freshmarket.eu CMS`
   - Homepage URL: `https://freshmarket.eu`
   - Authorization callback URL: `https://api.netlify.com/auth/done`
2. Skopiuj **Client ID** i **Client Secret**
3. **Netlify:** Site settings → Access control → OAuth → Add provider → GitHub
   - Wklej Client ID + Secret
4. Sprawdź `public/admin/config.yml` — pole `backend.repo` powinno być `artursilvicola/freshmarket-eu` ✓
5. Po deployu → wejdź na `https://freshmarket.eu/admin/` → kliknij **Login with GitHub**

### Krok 4 — Netlify Forms

Forms aktywują się automatycznie po deployu, dzięki:
- statycznej deklaracji w `public/__forms.html` (build-time detection)
- atrybutom `data-netlify="true"` w komponentach Astro

W Netlify zobaczysz formularze w **Forms** tab po pierwszym deployu.

**Powiadomienia mailowe** — Forms → Settings → Form notifications → Add notification:
- Email: `freshmarket@freshmarket.eu`
- Form: All forms (lub osobno dla contact / registration / award)

### Krok 5 — migracja DNS z cyber-folks

Plan migracji **bez downtime**:

1. **Najpierw skonfiguruj Netlify domain (test):**
   - Site settings → Domain management → Add custom domain
   - Tymczasowo: `staging.freshmarket.eu`
   - W cyber-folks DNS → dodaj rekord CNAME `staging` → `<your-site>.netlify.app`
   - Sprawdź czy strona działa pod `staging.freshmarket.eu`

2. **Przełączenie głównej domeny:**
   - W Netlify → Add custom domain → `freshmarket.eu`
   - W cyber-folks DNS → zmień rekordy:
     ```
     A    @       75.2.60.5         (Netlify load balancer)
     A    @       99.83.190.102
     CNAME www    apex-loadbalancer.netlify.com
     ```
   - LUB jeśli cyber-folks wspiera ANAME/ALIAS:
     ```
     ALIAS @     apex-loadbalancer.netlify.com
     ```
3. **Subdomena B2B:**
   ```
   CNAME app   freshmarketb2b.netlify.app
   ```
   W panelu B2B (Netlify) → Add custom domain → `app.freshmarket.eu`

4. **Email — bez zmian!** Rekordy MX, SPF, DKIM zostają w cyber-folks (jeśli mail jest tam hostowany).

5. **SSL:** Netlify automatycznie wystawi Let's Encrypt po propagacji DNS (15min–24h).

---

## Praca z treścią (Decap CMS)

Po wejściu na `https://freshmarket.eu/admin/` jako edytor:

1. **Strony EN** / **Strony PL** — edycja markdownów ze schemy zdefiniowanej w `config.yml`
2. **Site settings** — dane kontaktowe, NIP, logo
3. Każdy zapis = commit do brancha `main` na GitHubie → automatyczny deploy na Netlify (~1min)

**Workflow:** edytor edytuje, klika "Publish" → commit → Netlify build → live.

---

## TODO — kolejne etapy

### Etap II: Stripe Checkout (płatność za rejestrację)
- Konto Stripe + produkty Standard/Business
- Włączyć `netlify/functions/checkout.js` (instrukcja w pliku)
- Zmienić `RegistrationForm.astro` → action na `/.netlify/functions/checkout`
- Webhook Stripe → Netlify Function → wpis w Supabase (B2B)

### Etap III: Cloudinary (galeria + video tła)
- Upload zdjęć i wideo z poprzednich edycji
- W komponencie `Hero.astro` → wymiana `<video src=...>` na Cloudinary URL z transformacjami

### Etap IV: Pełna integracja z B2B
- Po opłaceniu rejestracji → automatyczne utworzenie konta w Supabase (auth.users + companies)
- Magic link do app.freshmarket.eu → użytkownik trafia od razu do panelu PreConnect
- Wspólny brand (te same kolory `brand.700`, `accent.500` w obu projektach ✓)

### Etap V: Tłumaczenia PL (uzupełnienie stubów)
Pełną treść EN trzeba przetłumaczyć dla 8 stubów PL:
`distributors-hub`, `retail-chains-hub`, `participants`, `exhibitors-hub`, `venue`, `important-dates`, `gallery`, `regulation`. Najszybciej w panelu Decap CMS po deployu.

---

## Źródła i kontakt

**Organizator:** KJOW Sp. z o. o., ul. Marii 17/25, 05-803 Pruszków, NIP: 118 197 6336
**Kontakt:** freshmarket@freshmarket.eu, +48 603 424 346
**Stara strona:** https://freshmarket.eu (router.php na cyber-folks, dostęp: s56.cyber-folks.pl:2223)
