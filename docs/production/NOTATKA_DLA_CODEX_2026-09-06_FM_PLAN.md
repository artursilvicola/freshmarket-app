# Notatka dla Codexa — karty spotkań B2B (eksport planu), 5/6.09.2026

Claude, nocna sesja. Wszystko na `origin/main` (review rób na origin/main, nie na lokalnym main).
Instrukcja użytkowa i architektura: `docs/production/FM_PLAN_EXPORT.md`.

## Co powstało (commity z 5/6.09)

1. `src/lib/fm-plan/` — czysty JS współdzielony przez przeglądarkę, funkcje Netlify i CLI:
   `i18n.js`, `model.js`, `layout.js` (pdfmake), `excel.js`, `fonts.js` (base64 subset), `assets.js`.
2. `src/components/admin/FmPlanExport.jsx` — panel w FM Spotkania → Plan spotkań (lazy chunk ~460 KB
   + czcionki ~480 KB, główny bundle bez zmian). Jeden renderer PDF = pdfmake w przeglądarce
   (te same PDF-y do pobrania i do wysyłki).
3. `netlify/functions/fm-plan-data.js` (dane, service role; auth: JWT admina | `x-fm-token` =
   `FM_EXPORT_TOKEN` | `x-fm-local` tylko w `netlify dev`) i `fm-plan-send.js` (Resend + załącznik).
4. `scripts/fm-plan-export.mjs` — CLI (sharp do WebP→PNG). Draft na realnych danych: `out/fm-plan-draft-2026-09-05/`.
5. `supabase/migrations/051_fm_plan_export.sql` — `retailers.fm_gate`, `fm_plan_sent_at` ×2. **Nieaplikowana** — Artur.
6. `src/lib/countries-data.js` — dane krajów wyjęte z `countries.js` (który importował i18n → nieużywalny w Node); `countries.js` re-eksportuje.

## Prośba o review — konkretne punkty

1. **Bezpieczeństwo `fm-plan-data`**: ścieżka tokenu serwisowego (`x-fm-token`, porównanie
   `timingSafeEqual`, min. 32 znaki, wartość tylko w Netlify env jako secret). Uzasadnienie:
   generator CLI/cron bez sesji przeglądarki; `netlify dev` nie wstrzykuje sekretów. Czy akceptujesz,
   czy wolisz np. krótkotrwałe tokeny? Usunięcie env `FM_EXPORT_TOKEN` zamyka ścieżkę.
2. **`fm-plan-send`**: limit 4 MB base64 na żądanie, `from: newsletter@freshmarket.eu` (zweryfikowana
   domena), `reply_to: support@`. Brak rate-limitingu — wysyłka idzie sekwencyjnie z panelu (~150
   maili, 1–2 s każdy). Czy Resend plan wytrzyma 150 maili z załącznikami w ciągu kilku minut?
3. **RODO**: karta dostawcy nie zawiera danych kupców (`layout.js` nie dostaje `card.buyers` poza
   kartą sieci) — proszę o kontrolę, że żadne pole kupca nie przecieka do `supplierDoc`. Excel
   master zawiera dane kupców — pobieralny tylko przez admina (UI + JWT).
4. **`model.js` symulacja** działa tylko gdy `fm_settings.schedule.nums` jest puste; po zatwierdzeniu
   planu (`saveFmSchedule`) `pairsFromSchedule` mapuje `sid` (UUID lub legacy) i `cid`
   (`fm26_chain_id`). Sprawdź zgodność z kształtem, jaki zapisuje `approveAndPublish` w PreconnectFM.
5. **Tryb `working` vs `final`**: `mode = "working"` gdy `algo_phase` nie zawiera `publish|final` —
   zweryfikuj realne wartości `algo_phase` po publikacji (dziś: `preferences_open`), bo od tego
   zależy odblokowanie przycisków „Wyślij dostawcom / sieciom".
6. **Netlify bundling**: `fm-plan-send.js` celowo NIE importuje z `src/` (teksty maili zduplikowane
   w funkcji), żeby nie polegać na bundlowaniu poza katalogiem funkcji. Jeśli wolisz jedno źródło —
   przenieść teksty do `netlify/functions/_shared/fm-plan-mail.js`.

## Otwarte / do zrobienia przed 22.09

- Aplikacja migracji 051, ustawienie GATE 1/2 dla 22 sieci (panel Sieci).
- Opisy EN: tylko 7/65 firm ma `description_short_en` — przycisk AI w profilu firmy (translate).
- Sieci bez kupców w bazie: Fozzy Group, FRAC (karty sieci bez adresata).
- Test wysyłki („Wyślij test na mój adres") po deployu — Artur rano.
- Ewentualnie: pomiar wysokości wiersza przy ekstremalnie długich nazwach (pdfmake radzi sobie
  przez `dontBreakRows`, ale warto obejrzeć DRUK-*.pdf z realnego planu 22.09).
