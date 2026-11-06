# Nowy wygląd maili + biblioteka zdjęć Marketing PreConnect — plan (06.11.2026, Claude; do review Codexa)

Gałąź `feat/marketing-photos` (od main 2447650). Bez wdrożenia, migracji produkcyjnych i prawdziwej wysyłki do osobnej zgody Artura.
Krok 0 (ten katalog): makieta HTML układu v2 do akceptacji wyglądu PRZED podpięciem biblioteki i mechanizmu wysyłki.

## 0. Makieta (do akceptacji Artura)
`makieta.py` generuje 6 wariantów (PL z kredytami / bez kredytów / grupa ręczna, EN credits / no credits, PL bez obrazków); zrzuty w `zrzuty/`.
Układ (kolejność z zadania): jasny nagłówek z zielonym logo + „PreConnect” → zdjęcie 600 px z podpisem → dyskretny dopisek „Zaprezentuj swoją firmę kupcom online” → hasło „Pierwszy krok do nowej sieci handlowej.” → powitanie + dwa zdania (lewo) → pasek: data mailingu + przycisk (data nad przyciskiem — na telefonie dwie kolumny łamały datę w słupek) → pomoc człowieka → zasady kredytów (szara ramka) → jasna stopka z adresem KJOW, reply-to i wypisem (teksty = dotychczasowa stopka produkcyjna).
Zdjęcie: `foto-spotkania-1200.jpg` (z PNG 1000×667 → JPG 98 KB, bez EXIF; źródło ma tylko 1000 px, więc 1200 nie da się bez powiększania). Logo: `fresh-market-logo-bez-roku-green.png` → 240×96.
Bez obrazków: alt zdjęcia, hasło i przycisk zostają tekstem (zrzut 05).

## 1. Magazyn plików
- Nowy bucket Supabase Storage `marketing-photos` (public read, 5 MB limit, `image/jpeg,image/png,image/webp`), ścieżka `photos/<photo_id>/v<version>.jpg`. Zapis WYŁĄCZNIE przez funkcję Netlify z service_role (polityki storage: brak INSERT/UPDATE/DELETE dla anon/authenticated — admin, dostawca, kupiec nie piszą bezpośrednio).
- Przygotowanie pliku w przeglądarce admina (canvas): podgląd kadru i zatwierdzenie kadru przez admina, skalowanie do ≤1200 px szerokości (bez powiększania, bez rozciągania — proporcje z kadru), re-enkodowanie JPEG q≈82 → re-enkodowanie usuwa EXIF/GPS. Do serwera trafia tylko ta wersja (base64 w JSON, limit ~1,5 MB po kodowaniu → ~1 MB pliku; Netlify 6 MB).
- Funkcja `marketing-photos` (admin JWT jak reszta modułu): sprawdza magiczne bajty (JPEG/PNG/WebP), realne wymiary (parser nagłówków, bez natywnych zależności), rozmiar ≤ 1 MB, zapisuje do bucketa z `cacheControl: 31536000, immutable`, liczy sha256, zapisuje metadane. Oryginał nie opuszcza przeglądarki.
- Admin widzi w UI ostrzeżenie: obraz w mailu będzie dostępny pod publicznym adresem HTTPS.

## 2. Model danych (migracja `20261107100000_marketing_photos.sql`, addytywna)
- `marketing_photos` (id, name, alt_pl, alt_en, caption_pl, caption_en, kind `authentic|ai`, source text, rights_confirmed bool + rights_note, categories text[] ∈ {b2b_talks, products, company}, active bool default true, created_by, created_at, updated_at).
- `marketing_photo_versions` (id, photo_id, version int, storage_path, public_url, width, height, bytes, sha256, created_at, created_by) — NIEZMIENNE: nowy kadr/poprawka = nowy wiersz i nowy adres; pod adresem użytym w mailu nic się nie podmienia (immutable cache + brak UPDATE/DELETE w polityce).
- `marketing_campaigns` + `photo_id`, `photo_version_id` (FK), `layout_version int default 1` (1 = dotychczasowa czapka, 2 = nowy układ). Zmiana zdjęcia = `update_content` z `expected_version` → `content_version + 1` (istniejące wersjonowanie).
- Zamrożenie przy zatwierdzeniu: `frozen_content.photo = {id, version_id, url, alt_pl, alt_en, caption_pl, caption_en}` + `frozen_content.layout_version`; wiadomości w rejestrze mają pełny HTML (jak dziś) → ponowienie i stare maile korzystają z zapisanego HTML i tego samego adresu obrazu. Wyłączenie zdjęcia (`active=false`) nie dotyka wersji ani kampanii.
- Widok `marketing_photo_usage`: per zdjęcie — ostatnia kampania z faktyczną wysyłką (status sent/sending z ≥1 wiadomością accepted), liczba kampanii, lista otwartych kampanii (draft/approved/sending) z przypisanym zdjęciem. Historia użycia = wiersze kampanii (bez osobnej tabeli).
- RLS: tabele zdjęć czytane tylko przez admina (jak marketing_*), zapis przez service_role.

## 3. Rotacja (serwer, akcja `suggest_photo` + przy `create`)
Kandydaci: `active = true` i mają ≥1 wersję. Wykluczenia: zdjęcia z 4 ostatnich kampanii, które faktycznie wysłały; zdjęcia przypisane do innych otwartych kampanii. Kolejność: nigdy niewysłane → najdawniej użyte (po `last_sent_at`) → najstarsze. Gdy po wykluczeniach pusto: zwróć najmniej ostatnio użyte z `warning: too_few_photos` (UI pokazuje ostrzeżenie i pozwala świadomie powtórzyć). Ręczny wybór „Wybierz zdjęcie”: lista z miniaturą, ostatnim użyciem i liczbą kampanii. Jedno zdjęcie na kampanię, wspólne PL/EN; podgląd i Test nie liczą się jako użycie (liczy się tylko faktyczna wysyłka).

## 4. Szablon v2 (`marketing-templates.js`)
`renderMarketingTemplate` dostaje `layoutVersion` (1|2) i `photo` (url, alt, caption). v2 = układ makiety; treść grupy nadal z `content {subject, body, cta}` (edytowalna PL/EN), hasło i dopisek stałe w układzie (PL/EN), `{{mailing_date}}` w pasku. Logo zielone w `public/brand/fm-email-logo-green.png` (jak białe). Brak zdjęcia (kampania bez zdjęcia / layout 1) = dotychczasowy render. Grupy i ich reguły bez zmian; teksty: mają kredyty → „Przygotuj propozycję”; bez kredytów → „Zobacz pakiety PreConnect”; ręczna → neutralnie, bez „Przygotuj…” zakładającego kredyty? (propozycja: ten sam przycisk „Przejdź do PreConnect”).

## 5. UI (MarketingActivation)
Zakładka „Biblioteka zdjęć”: dodawanie wielu plików (kolejka, miniatury), kadrowanie z podglądem i zatwierdzeniem, pola (nazwa, alt PL/EN, podpis PL/EN, rodzaj, źródło, prawa, kategorie), lista z miniaturą, ostatnią wysyłką, liczbą kampanii, przełącznik „wyłącz z wyboru”. W kampanii: kafelek zdjęcia (propozycja z rotacji) + „Wybierz zdjęcie” (modal); po zatwierdzeniu kafelek z zamrożonej wersji. Dostawca/kupiec: brak dostępu (funkcje tylko admin; RLS).

## 6. Testy
Jednostkowe: rotacja (nigdy niewysłane → najstarsze; 4 ostatnie wysyłki; otwarte kampanie; za mało → warning), szablon v2 PL/EN z i bez zdjęcia (alt, podpis, brak `<script>`, brak zakazanych obietnic), zamrożenie zdjęcia w `frozen_content`, zmiana zdjęcia bumpuje `content_version` i blokuje zatwierdzenie starej wersji (409), wyłączenie zdjęcia nie zmienia zamrożonych kampanii, walidacja pliku (magiczne bajty, wymiary, rozmiar). PGlite: migracja + widok użycia + polityki. Komponent: zakładka, wybór, ostrzeżenie o publicznym adresie. Podgląd na bazie testowej: zrzuty desktop/mobile/bez obrazków. Prawdziwa poczta dopiero po zgodzie, tylko adresy próbne, z flagą, listą dozwolonych i wypisami bez zmian.

## 7. Wdrożenie / wycofanie (później)
Migracja (bucket + tabele + kolumny, addytywna) PRZED kodem; kod przez main/Netlify; rollback kodu = Publish poprzedniego deployu; tabele zostają. Stare kampanie (layout 1) renderują jak dotąd.
