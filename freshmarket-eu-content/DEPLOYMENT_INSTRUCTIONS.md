# DEPLOYMENT — krok po kroku

Instrukcja dla **Arthura** — co kliknąć, gdzie i kiedy. Każdy krok ma konkretny rezultat do potwierdzenia.

---

## ETAP 1 — kod do GitHuba

### 1.1 Sklonuj repo lokalnie (jeśli jeszcze nie)

W **GitHub Desktop**:
- File → Clone repository
- URL: `https://github.com/artursilvicola/freshmarket-eu`
- Local path: `C:\Users\Artur\Documents\GitHub\freshmarket-eu`

### 1.2 Skopiuj zawartość `freshmarket-eu-content/` do clone'a

**PowerShell:**
```powershell
$src = "C:\Users\Artur\OneDrive\Dokumenty\Claude\Projects\Fresh Market 2026\freshmarket-eu-content"
$dst = "C:\Users\Artur\Documents\GitHub\freshmarket-eu"
Copy-Item -Recurse -Force "$src\*" "$dst\"
```

### 1.3 Commit + push

W **GitHub Desktop**:
- Zobaczysz wszystkie nowe pliki na liście changes
- Summary: `Initial Astro skeleton + content + Decap CMS + Netlify Forms`
- Commit to main → Push origin

---

## ETAP 2 — test lokalny (opcjonalny ale zalecany)

```powershell
cd C:\Users\Artur\Documents\GitHub\freshmarket-eu
npm install
npm run dev
```

Otwórz `http://localhost:4321` — powinieneś zobaczyć:
- ✓ Homepage EN z hero, listą sieci 2026, recenzjami
- ✓ `/pl/` — ta sama strona po polsku
- ✓ `/contact` + `/pl/contact` — formularz kontaktowy
- ✓ `/registration` — formularz rejestracji
- ✓ `/award` — formularz Fresh Market Award
- ✓ Stopka z danymi KJOW

Build test:
```powershell
npm run build
npm run preview
```

---

## ETAP 3 — Netlify (deploy automatyczny z GitHub)

### 3.1 Utwórz site

1. Wejdź: https://app.netlify.com
2. **Add new site → Import an existing project**
3. Connect to **GitHub** → autoryzuj
4. Wybierz repo: `artursilvicola/freshmarket-eu`
5. Build settings (autodetect z `netlify.toml`):
   - Branch: `main`
   - Build command: `npm run build`
   - Publish directory: `dist`
6. Click **Deploy site**

Po ~2 min dostaniesz URL typu `https://random-name-12345.netlify.app`.

### 3.2 Zmień nazwę site (opcjonalnie)

Site settings → Site information → Change site name → `freshmarket-eu`
→ URL: `https://freshmarket-eu.netlify.app`

### 3.3 Environment variables

Site settings → Environment variables → **Add a variable**:

| Klucz | Wartość |
|---|---|
| `PUBLIC_SITE_URL` | `https://freshmarket.eu` |
| `PUBLIC_B2B_URL`  | `https://app.freshmarket.eu` |

Po zmianie env vars: Deploys → **Trigger deploy → Clear cache and deploy site**.

---

## ETAP 4 — Netlify Forms

Forms aktywują się **automatycznie** po pierwszym deployu (wykrycie z `public/__forms.html`).

### 4.1 Sprawdź

Netlify → **Forms** → powinieneś zobaczyć 3 formularze: `contact`, `registration`, `award`.

### 4.2 Powiadomienia mailowe

Forms → kliknij na formularz → **Settings** → **Form notifications** → Add notification:
- Type: Email
- Email to notify: `freshmarket@freshmarket.eu`
- Subject: `[Fresh Market] Nowe zgłoszenie — {form_name}`

Powtórz dla wszystkich 3 formularzy.

### 4.3 Test

Wejdź na `https://freshmarket-eu.netlify.app/contact`, wypełnij i wyślij. Sprawdź mail i zakładkę Forms.

---

## ETAP 5 — Decap CMS (GitHub OAuth)

### 5.1 Utwórz GitHub OAuth App

https://github.com/settings/developers → **New OAuth App**

| Pole | Wartość |
|---|---|
| Application name | `freshmarket.eu CMS` |
| Homepage URL | `https://freshmarket.eu` |
| Authorization callback URL | `https://api.netlify.com/auth/done` |

→ **Register application** → skopiuj **Client ID** + wygeneruj **Client Secret**.

### 5.2 Dodaj OAuth provider w Netlify

Site settings → **Access control** (lub **Identity** w starszym UI) → scroll do **OAuth** → **Install provider** → GitHub:
- Client ID: (z GitHub)
- Client Secret: (z GitHub)

### 5.3 Test logowania do CMS

Wejdź: `https://freshmarket-eu.netlify.app/admin/`
- Klik **Login with GitHub**
- Autoryzuj
- Powinieneś zobaczyć dashboard z kolekcjami: **Strony EN**, **Strony PL**, **Site settings**

### 5.4 Edycja testowa

CMS → Strony EN → otwórz `index` → zmień coś w hero → **Publish**.
W ciągu ~1 min Netlify zrobi nowy deploy → zmiana online.

---

## ETAP 6 — migracja DNS z cyber-folks (UWAGA: tu jest moment "go-live")

### 6.1 Test z subdomeną — BEZ ryzyka

1. **Netlify** → Site settings → Domain management → **Add custom domain**: `staging.freshmarket.eu`
2. **Cyber-folks DNS** (https://s56.cyber-folks.pl:2223 → Domeny → DNS):
   - Add record: `CNAME` → name: `staging` → value: `freshmarket-eu.netlify.app` → TTL: 3600
3. Czekaj 15-30 min → otwórz `https://staging.freshmarket.eu`
4. Jeśli działa → **Wystawi się Let's Encrypt SSL automatycznie** (5-10 min)

### 6.2 Przełączenie produkcji freshmarket.eu

**KIEDY:** w okienku niskiego ruchu (np. niedziela rano).

1. **Netlify** → Add custom domain: `freshmarket.eu` + `www.freshmarket.eu`
2. **Cyber-folks DNS** → zmień rekordy:

   **Wariant A — Netlify DNS (zalecane, bo apex + auto SSL):**
   - W Netlify: Domain → DNS → Set up Netlify DNS → otrzymasz 4 nameservery (np. `dns1.p01.nsone.net`)
   - W cyber-folks → Domeny → freshmarket.eu → **Zmień nameservery** na te 4 z Netlify
   - **UWAGA:** to przeniesie WSZYSTKIE rekordy DNS, w tym MX (poczta). Najpierw zaimportuj rekordy MX/SPF/DKIM do Netlify DNS, **inaczej email padnie!**

   **Wariant B — zostaje cyber-folks DNS, zmiana tylko A/CNAME (bezpieczniej dla email):**
   - Usuń stare rekordy A `@` → zostaw tylko:
     ```
     A     @       75.2.60.5
     A     @       99.83.190.102
     CNAME www     apex-loadbalancer.netlify.com
     ```
   - **MX, SPF, DKIM** — bez zmian, zostają w cyber-folks → poczta `freshmarket@freshmarket.eu` działa dalej.

3. Propagacja: 15 min – 24h. Sprawdź: https://dnschecker.org/#A/freshmarket.eu
4. Po przełączeniu — Netlify wystawi SSL automatycznie.

### 6.3 Subdomena B2B

1. **Cyber-folks DNS** (lub Netlify DNS):
   ```
   CNAME app   freshmarketb2b.netlify.app
   ```
2. **W panelu B2B Netlify** (`freshmarketb2b`): Site settings → Domain → Add custom domain → `app.freshmarket.eu` → SSL automatyczny.

---

## ETAP 7 — po go-live

### 7.1 Zaktualizuj redirecty starych URL

Otwórz starą stronę `https://freshmarket.eu` (jeszcze przez Wayback Machine albo cache) i wynotuj wszystkie linkowane adresy. Dopisz mappingi do `public/_redirects`. Te już są:
```
/index.php → /
/registration.php → /registration
/contact.php → /contact
/agenda.php → /agenda
/award.php → /award
```

### 7.2 Submit sitemap do Google

https://search.google.com/search-console/ → Property → Sitemaps → submit `https://freshmarket.eu/sitemap-index.xml`

### 7.3 Backup starej strony

**Przed wyłączeniem cyber-folks** — pobierz cały kod (router.php + assets) jako archiwum ZIP, na wszelki wypadek.

---

## ROLLBACK plan (gdyby coś poszło nie tak)

W cyber-folks DNS zmień rekordy A z powrotem na poprzednie IP serwera cyber-folks. Propagacja 15 min – 24h. Stara strona wraca.

---

## Kontakty pomocnicze

- **Netlify support:** https://answers.netlify.com
- **Decap CMS:** https://decapcms.org/docs/
- **Astro docs:** https://docs.astro.build
- **Cyber-folks:** support@cyber-folks.pl, panel s56.cyber-folks.pl:2223
