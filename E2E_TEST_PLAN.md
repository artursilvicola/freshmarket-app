# Plan testów end-to-end Fresh Market

**Cel:** sprawdzić działanie pełnego workflow PreConnect + Fresh Market 2026 przez 3 role.
**Konto testowe:** `test.dostawca.20260430@freshmarket.test` / hasło `TestPass2026!`
**Konto admina:** `artur@kjow.pl` / Twoje hasło

---

## A. Setup (5 minut, jednorazowo)

1. Otwórz Supabase SQL Editor
2. Wgraj plik **`supabase/tests/e2e_setup.sql`** → Run
3. Wynik: 1 oferta + 1 wysyłka PENDING_MODERATION do Biedronki

Po tym kroku w bazie czeka:
- **Oferta #8888**: "Pomidory malinowe PL Premium" — UNICA GROUP (sup-s1), 3 zdjęcia, pełen formularz wypełniony, GlobalGAP+BRC, 4.50 EUR/kg, 80T/tyg
- **Wysyłka #8888**: do Biedronki (retailer_id=100), status `pending_moderation`

---

## B. Test 1 — Widok dostawcy (perspektywa: kto stworzył ofertę)

**Setup:** w SQL Editor uruchom **`e2e_role_switcher.sql` BLOK 2** (supplier).

1. Wyloguj się z aplikacji
2. Zaloguj jako Test Dostawca → automatycznie kierowany na `/dostawca`
3. **Pasek testowy (oczekiwane):** "Panel Dostawcy" + zielony tag **Dostawca** + "Test Dostawca"
4. **Sidebar (oczekiwane):** Wysyłki / Moje propozycje / Finanse / Twoja firma + Spotkania FM 2026

### B.1. Moje propozycje
- Klik **Moje propozycje**
- Powinieneś zobaczyć **listę z ofertą "Pomidory malinowe PL Premium"** + 9 z seed (UNICA, PIK, FRESH INSIDE)
- Klik na ofertę → otwiera formularz edycji
- Step 1 → sekcja "D. Zdjęcia produktu" → 3 placeholder zdjęcia widoczne (czerwone, turkusowe, żółte)

### B.2. Wysyłki
- Klik **Wysyłki**
- Wybierz tab **"Do moderacji"** lub **"Wszystkie"**
- Powinna być wysyłka "Pomidory malinowe... → Biedronka" ze statusem **Pending moderation**

### B.3. Twoja firma
- Klik **Twoja firma**
- Sekcja **Logo** → uploader obecny (ramka kropkowana albo logo jeśli wgrałeś)
- Wgraj testowe logo (Twoje, dowolny PNG/JPG) drag&drop
- Po wgraniu logo pokazuje się w preview

**Oczekiwany wynik:** Wszystko widoczne, brak błędów. Dostawca widzi swoje oferty + wysyłki.

---

## C. Test 2 — Widok admina (moderacja + sieci)

**Setup:** w SQL Editor uruchom **`e2e_role_switcher.sql` BLOK 1** (admin) **lub** zaloguj się jako prawdziwy admin (artur@kjow.pl).

1. Wyloguj, zaloguj jako admin
2. **Pasek testowy:** "Panel Administratora" + fioletowy tag **Admin** + switcher pokazujący "Test Admin"
3. **Sidebar:** Pipeline / Sieci / Firmy / Wiadomości + FM Spotkania

### C.1. Pipeline (moderacja wysyłek)
- Klik **Pipeline** w sidebarze
- W tabeli wysyłek znajdź **#8888 Pomidory malinowe → Biedronka** (status `pending_moderation`)
- Klik **Zatwierdź** → status zmienia się na `approved`
- Po zatwierdzeniu pojawia się przycisk **"Wyślij zatwierdzone"** (lub podobny) lub klik per row "Wyślij" → status zmienia się na `sent`

> **Alternatywnie SQL:** w Supabase możesz pominąć UI i wykonać:
> ```sql
> update legacy_sends set status='sent', data = data || jsonb_build_object('status','sent','sentAt', now()::text)
> where legacy_id = 8888;
> ```

### C.2. Sieci (logo Biedronki)
- Klik **Sieci**
- Znajdź **Biedronka** w liście, klik żeby rozwinąć
- Pierwsza sekcja: **LOGO SIECI** — uploader
- Wgraj testowe logo Biedronki (PNG/JPG, np. ze strony Biedronki lub własne)
- Po wgraniu logo pojawia się w preview 64×64

**Oczekiwany wynik:** Wysyłka Pomidorów ma status `sent`, gotowa dla kupca. Logo Biedronki w bazie.

---

## D. Test 3 — Widok kupca (TEN co miał dostać ofertę)

**Setup:** w SQL Editor uruchom **`e2e_role_switcher.sql` BLOK 3** (buyer Biedronka).

1. Wyloguj, zaloguj
2. **Pasek testowy:** "Panel Kupca" + niebieski tag **Kupiec** + "Test Kupiec Biedronka"
3. **Sidebar:** Propozycje asortymentowe / Dostawcy / Zapisane / Mój Profil

### D.1. Lista propozycji
- Klik **Propozycje asortymentowe**
- W liczniku liczba ofert powinna wzrosnąć (była 3, teraz powinna być **4**: poprzednie 3 + Pomidory malinowe)
- Pierwsza karta na liście (Premium = z gradientem zlotym): **"Pomidory malinowe PL Premium"** od UNICA GROUP
- **Miniatura:** **TYLKO 1 zdjęcie głowne** (czerwone) z badge'em **+2** w rogu
- Pod nazwą: GlobalGAP, BRC, PL · DE, CZ, SK, HU
- Cena: **4.50 EUR/kg**

### D.2. Szczegóły oferty
- Klik **Szczegóły** przy karcie
- W hero header: 1 duże zdjęcie + badge "+2"
- Sekcja **"Identyfikacja produktu"** — otwarta, widoczne: Pomidory malinowe / Pink Lady F1 / warzywa / pomidory / 🇵🇱 Polska / Mazury / Program staly / Premium
- Sekcja **"Co wyróżnia tego dostawcę?"** — otwarta, widoczne 3 benefity
- Sekcja **"Zdjęcia produktu (3)"** — **ZAMKNIĘTA** (z ikoną 📸)
- **Klik sekcji** → rozwija się
- Wszystkie **3 zdjęcia** widoczne w grid 4:3, oznaczone "Główne", "Zdjęcie 2", "Zdjęcie 3"
- Klik w zdjęcie → otwiera oryginał w nowej karcie

### D.3. Test izolacji (BLOK 4 — Lidl)
- W SQL: uruchom **`e2e_role_switcher.sql` BLOK 4** (buyer Lidl)
- Wyloguj, zaloguj
- W liście propozycji **NIE powinno być Pomidorów malinowych** (bo wysłane do Biedronki nie do Lidla)
- Liczba propozycji: 1 (tylko ta wysłana do Lidla z seed)

**Oczekiwany wynik:** Buyer Biedronki widzi pomidory ze zdjęciami; buyer Lidla ich nie widzi (RLS izolacja).

---

## E. Test 4 — Fresh Market 2026 (algorytm spotkań)

To jest najbardziej skomplikowana faza. Wymaga zrozumienia **5 etapów algorytmu**:

| Etap | Daty | Co się dzieje |
|---|---|---|
| 1 | 1–16 września | Dostawcy wybierają preferowane sieci (top 5 + 60 dla algorytmu) |
| 2 | 16 września | Zamknięcie wyborów dostawców — dalsze zmiany tylko przez admina |
| 3 | 17–22 września | Algorytm matchingu (admin uruchamia) + ręczne korekty admina |
| 4 | 22 września | Publikacja finalnego harmonogramu + numerów stolików |
| 5 | 24 września | Wydarzenie Fresh Market 2026 (MCC Mazurkas, Ożarów Maz.) |

### E.1. Włączenie FM (admin)
- Zaloguj jako admin
- Sidebar → **FM Spotkania**
- Lub bezpośrednio w SQL:
  ```sql
  update fm_settings set
    schedulingOpen = true,
    "currentPhase" = 1
  where id = (select id from fm_settings limit 1);
  ```
- Sidebar dostawcy/kupca odblokuje "Spotkania FM 2026"

### E.2. Faza 1 — Dostawca wybiera sieci
- Zaloguj jako dostawca (Test Dostawca / supplier)
- Sidebar → **Wybór sieci** (pod Fresh Market 2026)
- Powinieneś zobaczyć listę dostępnych sieci (Biedronka, Lidl, Kaufland...)
- Wybierz **5 priorytetowych** (top picks) + dodatkowe 60 jako "także zainteresowany"
- Zapisz preferencje
- W tle: tworzy się rekord w tabeli `fm_prefs` (jsonb)

### E.3. Faza 1 — Kupiec akceptuje dostawców
- Zaloguj jako kupiec
- Sidebar → **Spotkania FM 2026**
- Lista dostawców z preferencjami pasującymi do sieci kupca
- **Akceptuj** lub **odrzuć** każdego dostawcę
- W tle: rekord w `fm_resps` (jsonb)

### E.4. Faza 3 — Admin uruchamia algorytm
- Zaloguj jako admin
- Sidebar → **FM Spotkania**
- Powinien być przycisk **"Uruchom algorytm matchingu"** lub podobny
- Algorytm parsuje fm_prefs + fm_resps, generuje pary spotkań
- Wynik zapisuje się w fm_resps (zone: 'green' / 'orange' / 'red' / 'blocked')

### E.5. Faza 3 — Admin ręcznie koryguje
- Po algorytmie admin może ręcznie zmienić pozycje w harmonogramie
- Drag&drop w UI (niesprawdzone w tym tescie)

### E.6. Faza 4 — Publikacja
- Admin: kliknij **"Opublikuj harmonogram"** (ustaw `fm_settings.planPublished = true`)
- Wszystkie strony widzą finalny harmonogram

### E.7. Faza 4 — Dostawca/Kupiec widzą swoje spotkania
- Zaloguj jako dostawca → **Twoje spotkania** w sidebarze
- Lista spotkań z numerami stolików, godzinami, kupcami
- Zaloguj jako kupiec → **Spotkania FM 2026**
- Lista swoich spotkań

### E.8. Test SQL — sprawdź dane FM
```sql
select 'fm_settings' as t, count(*)::text c from fm_settings
union all
select 'fm_prefs (dostawcy)', count(*)::text from fm_prefs
union all
select 'fm_resps (matching)', count(*)::text from fm_resps;
```

---

## F. Co wymaga ręcznych testów (NIE ZROBIĘ AUTOMATYCZNIE)

Niektóre kroki są poza możliwościami mojej automatyki Chrome:

1. **Faktyczny upload pliku graficznego z dysku** — Chrome MCP blokuje file_upload (security)
   - Workaround: w testach używam placeholder URL (placehold.co)
   - Dla prawdziwego testu kliknij sam i wgraj
2. **Drag&drop kolumn w panelu admina** — niedostępne w MCP
3. **Multi-browser concurrency** — moja sesja to jedno okno
4. **Faktyczne wysyłanie maila** — Resend nie podpięty

---

## G. Statusy wysyłek (Status flow)

```
[draft]                    ← supplier zapisał szkic
   ↓ supplier publikuje
[queued / pending_moderation]  ← wysyłka czeka na admina
   ↓ admin: Zatwierdź
[approved]                 ← gotowa do wysłania
   ↓ admin: Wyślij
[sent]                     ← dostarczona, kupiec może zobaczyć
   ↓ kupiec otwiera
[opened / read]            ← kupiec przeczytał (auto)
   ↓ kupiec klika "Potwierdzam"
[read_manual]              ← potwierdzony odczyt
   ↓ 14 dni bez przeczytania
[unread_expired]           ← zwrot kredytów
   ↓
[refunded]
```

---

## H. Co potwierdzono w tym teście

✅ Inject oferty z 3 zdjęciami przez SQL — działa
✅ RLS izolacja kupiec ↔ kupiec (Biedronka 3 oferty, Lidl 1, Kaufland 1, Carrefour 3, Auchan 1)
✅ Rendering zdjęć: 1 główne + badge "+N" w liście, accordion w szczegółach
⚠ Pełen UI flow przez 3 role — wymaga wykonania ręcznego (zalogowani userzy + scenariusz B-D)
⚠ FM 2026 fazy — wymaga włączenia schedulingOpen w fm_settings + manualnego klikania (E)

---

## I. Pliki w tym pakiecie

- **`supabase/tests/e2e_setup.sql`** — wstrzykuje testową ofertę
- **`supabase/tests/e2e_role_switcher.sql`** — przełącza rolę testowego konta
- **`supabase/tests/independent_tests.sql`** — 16 testów weryfikacyjnych
- **`E2E_TEST_PLAN.md`** — ten plik
- **`TESTY_I_RAPORT.md`** — pełny raport audytu

Powodzenia w testach!
