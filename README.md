# Fresh Market — aplikacja B2B

Platforma B2B dla dostawców i sieci handlowych w branży owoców i warzyw.

## Stack

- **Frontend:** React 18 + Vite + React Router
- **Backend / DB:** Supabase (PostgreSQL + Auth + Storage)
- **Hosting:** Netlify
- **Email:** Resend (przez Netlify Functions)

## Trzy panele

- `/admin` — administrator (moderacja, retailerzy, Fresh Market event)
- `/dostawca` — dostawca (oferty, wysyłki, finanse, profil firmy)
- `/kupiec` — kupiec (oferty od dostawców, ulubione, katalog)

Po zalogowaniu użytkownik jest automatycznie przekierowany do swojego panelu na podstawie roli w tabeli `profiles`.

## Pierwsze uruchomienie

Pełna instrukcja krok po kroku: **[SETUP_INSTRUKCJA.md](./SETUP_INSTRUKCJA.md)**.

W skrócie:
1. Załóż projekt na Supabase, wgraj migracje z `supabase/migrations/`
2. Skopiuj `.env.example` jako `.env`, wstaw klucze
3. `npm install && npm run dev`
4. Wypchnij na GitHub, podłącz do Netlify

## Struktura

```
src/
├── auth/          # logowanie, rejestracja, ProtectedRoute, AuthProvider
├── components/    # PhotoUploader i inne reusable
├── lib/           # supabase client, db.js (CRUD)
├── panels/        # AdminPanel / SupplierPanel / BuyerPanel
└── legacy/        # PreconnectFM.jsx — istniejący kod aplikacji

supabase/
├── migrations/    # SQL do wgrania w Supabase SQL Editor
└── seed.sql       # dane testowe (retailery, firmy)

netlify/functions/ # serverless (mailing przez Resend)
```

## Bezpieczeństwo

Wszystkie tabele w Supabase mają **Row-Level Security**:
- Admin widzi wszystko
- Dostawca widzi tylko swoją firmę i swoje oferty
- Kupiec widzi tylko oferty wysłane do swojej sieci

To znaczy, że nawet przy włamaniu w przeglądarce (np. zmiana JS), baza nie pozwoli pobrać cudzych danych.

## Co dalej

Po pierwszym deployu (działająca aplikacja na Netlify), kolejne kroki to:
1. Migracja seed-data z `PreconnectFM.jsx` → Supabase (zastąpienie `useState(OFFERS_INIT)` zapytaniami z `db.js`)
2. Stripe Checkout do zakupu pakietów wysyłek
3. Konfiguracja Resend i wysyłka prawdziwych maili
4. Podpięcie domeny `app.freshmarket.eu`
