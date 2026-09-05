# Karty spotkań B2B FM 2026 — eksport planu (PDF · Excel · wysyłka)

Stan: **wdrożone 5/6.09.2026** (branch `feat/admin-instructions-announcements` → `main`).
Decyzje projektowe: patrz artifact „Karta Spotkań FM 2026" v7 (projekt zaakceptowany 5.09) i notatki w pamięci sesji.

## Co to robi

Po zatwierdzeniu planu spotkań (zakładka **FM Spotkania → Plan spotkań**, ~22.09) admin jednym
przyciskiem dostaje:

| Wynik | Dla kogo | Co zawiera |
|---|---|---|
| **Karta dostawcy** (PDF, 1–2 str.) | każda firma dopuszczona do FM B2B | numer spotkania · sieć (z logo) · kategorie · GATE 1/2 · instrukcja „Jak dotrzeć na spotkanie" · kontakty PL/EN · sponsorzy. **Bez nazwisk i kontaktów kupców.** |
| **Karta sieci** (PDF, 2–5 str.) | każda sieć FM 2026 | kolejka dostawców: logo · kraj · krótki opis · osoba i telefon z profilu · „Informacje o dniu spotkań" (10:00/9:00, ~10 min, lunch 13–14, koniec 17:00 → kolacja sala Bolero) |
| **DRUK-dostawcy.pdf / DRUK-sieci.pdf** | drukarnia | wszystkie karty jedna za drugą (A4), do kopert |
| **plan-spotkan.xlsx** | zespół / recepcja | 1 wiersz = 1 spotkanie + arkusze Dostawcy / Sieci / Info (zawiera dane kupców — tylko organizator) |
| **ZIP** | archiwum | wszystkie karty + Excel |
| **Wysyłka mailem** | dostawcy i sieci | każdy dostaje swoją kartę PDF, w swoim języku (PL dla firm z Polski, EN dla pozostałych) |

Reguły wbudowane: jeden język na kartę (kraj = PL → PL, inaczej EN), wiersz tabeli nigdy nie jest
cięty między stronami, nazwa firmy w nagłówku i stopce **każdej** strony, GATE 1 = pełna plakietka,
GATE 2 = obrys (czytelne w druku cz-b).

## Jak używać (admin)

1. **Sieci → ustaw GATE** (selektor obok przełącznika FM 2026) dla każdej sieci FM — inaczej karty
   dostawców pokażą „GATE ?" (panel wypisze, którym sieciom brakuje).
2. **Firmy** — upewnij się, że firmy mają logo i **krótki opis PL i EN** (Excel → arkusz Dostawcy,
   kolumna „Opis EN: BRAK" = do przetłumaczenia przyciskiem AI w profilu firmy).
3. **FM Spotkania → Plan spotkań → „Pobierz dane i przygotuj karty"** — panel pobiera dane z bazy,
   renderuje wszystkie karty w przeglądarce (~1 min) i pokazuje listę z podglądem.
4. Pobierz: **Excel**, **DRUK-dostawcy.pdf**, **DRUK-sieci.pdf**, **ZIP**.
5. **„Wyślij test na mój adres"** — pierwsza karta na e-mail admina (działa zawsze).
6. **„Wyślij dostawcom" / „Wyślij sieciom"** — aktywne tylko gdy plan jest **zatwierdzony**
   (bez znaku wodnego). Wysyłka idzie karta po karcie (Resend, załącznik PDF), z postępem
   i statusem per firma; data wysyłki zapisuje się w `fm_plan_sent_at`.

Przed zatwierdzeniem planu panel pracuje w trybie **SYMULACJA** (pary robocze, znak wodny) —
do sprawdzania układu i danych. Wysyłka do uczestników jest wtedy zablokowana.

## Elementy techniczne

- `src/lib/fm-plan/` — wspólny, czysty JS (przeglądarka + Node):
  `i18n.js` (teksty PL/EN, reguła języka), `model.js` (dane → karty; symulacja; logotypy),
  `layout.js` (pdfmake: `dontBreakRows`, nagłówek/stopka per strona), `excel.js` (xlsx),
  `fonts.js` (Barlow Condensed + IBM Plex Sans, subset Latin-Ext, base64), `assets.js` (logo FM, sponsorzy).
- `src/components/admin/FmPlanExport.jsx` — panel (lazy-loaded), renderer = pdfmake w przeglądarce;
  obrazy WebP/SVG → PNG przez canvas. Zbiorcze PDF: pdf-lib. ZIP: jszip.
- `netlify/functions/fm-plan-data.js` — komplet danych (service role). Auth: JWT admina
  **lub** nagłówek `x-fm-token` = env `FM_EXPORT_TOKEN` (token serwisowy dla CLI; usunięcie
  zmiennej w Netlify zamyka tę ścieżkę) **lub** `x-fm-local: 1` tylko w `netlify dev`.
- `netlify/functions/fm-plan-send.js` — wysyła jedną kartę (PDF z przeglądarki, base64 ≤ 4 MB)
  przez Resend (`from: newsletter@freshmarket.eu`, `reply_to: support@`), oznacza `fm_plan_sent_at`.
- `scripts/fm-plan-export.mjs` — CLI (Node): `node scripts/fm-plan-export.mjs --data <json|URL> --out out/x [--simulate]`
  → karty, DRUK-*.pdf, xlsx, zip, index.html. Obrazy WebP → PNG przez `sharp`.
- `supabase/migrations/051_fm_plan_export.sql` — `retailers.fm_gate`, `retailers/companies.fm_plan_sent_at`
  (**aplikować ręcznie**; do czasu migracji: „GATE ?" i brak znacznika wysyłki).

## Draft z 5.09 (dane realne, pary symulowane)

`out/fm-plan-draft-2026-09-05/` (poza repo): 65 kart dostawców, 22 karty sieci, DRUK-*.pdf, Excel, ZIP.
Wnioski z danych: 59/65 firm ma logo, 22/22 sieci ma logo; opis PL ma 53 firmy, **opis EN tylko 7**
(karty EN dla firm bez opisu EN pokazują opis PL); 51/65 firm ma kontakt w profilu; sieci Fozzy Group
i FRAC nie mają kupców w bazie; 200 wyborów dostawców, 11 odpowiedzi sieci (stan 5.09 wieczorem).
