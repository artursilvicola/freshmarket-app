# Integracja freshmarket.eu ↔ B2B (PreConnect)

Dwa osobne deploye Netlify, jedna marka, jeden user journey.

```
┌──────────────────────────────────┐         ┌──────────────────────────────────┐
│   freshmarket.eu (Astro static)  │         │  app.freshmarket.eu (React+Vite) │
│   • Marketing + treść (CMS)      │  ────►  │  • Login (Supabase Auth)         │
│   • Formularz rejestracji        │  link   │  • Panele admin/dostawca/kupiec  │
│   • Galeria, agenda, award       │         │  • PreConnect matchmaking        │
│   • Decap CMS                    │  ◄────  │  • Storage zdjęć (Supabase)      │
│   Repo: freshmarket-eu           │ shared  │  Repo: freshmarketb2b            │
│   Hosting: Netlify               │  brand  │  Hosting: Netlify                │
└──────────────────────────────────┘         └──────────────────────────────────┘
                                                         │
                                                         ▼
                                       ┌─────────────────────────────────┐
                                       │    Supabase                      │
                                       │    • auth.users                  │
                                       │    • companies (suppliers)       │
                                       │    • retailers                   │
                                       │    • legacy_offers (JSONB)       │
                                       │    • legacy_sends (JSONB) + RLS  │
                                       │    • Storage: photos, logos      │
                                       └─────────────────────────────────┘
```

## 1. Cross-linking (już zrobione)

Komponent **`B2BAppCTA.astro`** wstawiony na stronach:
- `/registration` (PL/EN)
- `/exhibitors-hub`
- `/distributors-hub`
- `/retail-chains-hub`

Link kieruje na `https://app.freshmarket.eu` — uczestnik trafia na login.

## 2. Wspólny brand (już zrobione)

Te same kolory w obu projektach:
- `brand.700` = `#2d5a2e` (zielony Fresh Market)
- `accent.500` = `#e57e25` (pomarańczowy CTA)
- Te same fonty: Inter / Plus Jakarta Sans

W przyszłości: wyciągnąć kolory do osobnego pakietu npm `@freshmarket/brand` (na razie nadmiarowe).

## 3. Subdomena `app.freshmarket.eu`

Konfiguracja DNS + Netlify — opisane w `DEPLOYMENT_INSTRUCTIONS.md` etap 6.3.

## 4. Auto-onboarding (etap II — TODO)

Cel: gdy ktoś opłaci rejestrację na freshmarket.eu → automatycznie dostaje konto w B2B.

**Flow:**
1. User wypełnia `RegistrationForm` na freshmarket.eu
2. Submit → Netlify Function `/.netlify/functions/checkout` → Stripe Checkout
3. Po opłaceniu → Stripe webhook → Netlify Function `/.netlify/functions/stripe-webhook`:
   - Tworzy `auth.users` w Supabase (przez Service Role Key)
   - Tworzy odpowiedni rekord w `companies` lub przypisuje do `retailers`
   - Wysyła magic link mailem (Supabase Auth → resend magic link)
4. User klika magic link → trafia na `app.freshmarket.eu` → automatyczny login → swój panel

**Pliki do dodania (etap II):**
- `netlify/functions/stripe-webhook.js` — odbiera Stripe events, tworzy konto w Supabase
- Env vars w Netlify (freshmarket.eu site):
  - `STRIPE_SECRET_KEY` (z Stripe Dashboard)
  - `STRIPE_WEBHOOK_SECRET` (z konfiguracji webhooka)
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (z Supabase → Project settings → API)

**Stripe webhook URL do dodania w Stripe:**
```
https://freshmarket.eu/.netlify/functions/stripe-webhook
```
Eventy: `checkout.session.completed`, `payment_intent.succeeded`.

## 5. Wspólny header (opcjonalnie, etap III)

Jeśli okaże się że użytkownik często przechodzi tam i z powrotem — można rozważyć:
- Globalny pasek "Wracaj do freshmarket.eu" w nagłówku B2B
- Kontekstowy komunikat "Zalogowany jako X" z linkiem do panelu na freshmarket.eu

Na razie: nadmiarowe. Każda strona robi swoje, link "Otwórz aplikację B2B" wystarczy.

## 6. Cookie consent — ustalić wspólnie

Cookie banner ma localStorage key `freshmarket_cookie_consent`. Domena `freshmarket.eu` i `app.freshmarket.eu` mają **osobne localStorage** (security feature browsera).

→ Każda subdomena pyta osobno. To OK — można explicite napisać w polityce prywatności że są dwie aplikacje.

## 7. Analytics

Plan: jeden Plausible Analytics konto, dwa site-y:
- `freshmarket.eu` — marketing funnel
- `app.freshmarket.eu` — engagement

Plausible script w `BaseLayout.astro` (freshmarket.eu) i w `index.html` (B2B). Skonfigurować po deployu.

## 8. SEO — kanoniczne linki

`freshmarket.eu` ma sitemap z `@astrojs/sitemap` (auto). `app.freshmarket.eu` powinno mieć `noindex` w robots (to panel B2B, nie content site):

W repo B2B: `public/robots.txt`:
```
User-agent: *
Disallow: /
```

## Status integracji

- [x] Cross-linking (B2BAppCTA.astro)
- [x] Wspólny brand (kolory, fonty)
- [x] Plan DNS dla app.freshmarket.eu (DEPLOYMENT_INSTRUCTIONS.md)
- [ ] Auto-onboarding via Stripe webhook (etap II)
- [ ] Wspólny pasek powrotu (etap III, opcjonalne)
- [ ] Plausible Analytics (etap II)
- [ ] B2B robots.txt (do dodania w repo B2B)
