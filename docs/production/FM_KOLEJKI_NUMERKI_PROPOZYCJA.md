# Numerki spotkań B2B na żywo — propozycja modułu „Kolejki" (Claude, 6.09.2026)

Kontekst: na Fresh Market 2026 (24.09) ok. 22–24 sieci ma stanowiska w strefie spotkań (GATE 1 / GATE 2).
Obsługa (1 osoba na ~4 sieci, tablet) wywołuje kolejne numery; numery „TERAZ / NASTĘPNY" widać na
dużym ekranie z projektora i w telefonach uczestników. Stary system (`rejestracja.fresh-market.info/spotkania.php`
+ CMS `nowa.freshmarket.com.pl`) to jedno pole „aktualna rozmowa" per sieć, „następny = aktualny + 1",
odpytywanie co 5 s, sztywne 3 kolumny. Ten dokument to niezależna propozycja do porównania z analizą Codexa.

## 0. Najważniejsza teza

Nowa aplikacja **już ma numery**: zatwierdzony plan (`fm_settings.schedule.nums`) przypisuje każdej parze
dostawca × sieć numer w kolejce tej sieci, z odstępem (`FM_MIN_GAP`), żeby jedna firma nie była wołana
w dwóch miejscach naraz. Te same numery są **drukowane na kartach** (moduł eksportu, 5/6.09).
Moduł kolejek nie powinien więc być „licznikiem +1", tylko **warstwą wykonania planu**: dla każdej sieci
uporządkowana lista spotkań ze statusami; „TERAZ" = spotkanie w toku, „NASTĘPNY" = pierwsze jeszcze
niezakończone w kolejności — a nie `aktualny + 1`. To jedna decyzja, z której wynika reszta.

Model: **hybrydowy** (kolejność z planu + statusy na żywo + dopiski walk-in + ręczne korekty).
Czysto sekwencyjny licznik gubi nieobecnych i nie zna nazw firm; czysty harmonogram godzinowy pada
przy spotkaniach 6–14 min. Hybryda daje to, co obsługa robi rękami dziś — tylko z pamięcią i ekranem.

## 1. Architektura (ta sama aplikacja, ta sama baza)

Cztery widoki w `b2b.freshmarket.eu`, zero nowej infrastruktury:

| Widok | Ścieżka | Kto | Źródło danych |
|---|---|---|---|
| Panel operatora (tablet) | `/obsluga` | rola `staff` (nowa), przypisane sieci | Supabase (RLS) |
| Panel administratora dnia | FM Spotkania → zakładka „Dzień eventu" | admin | jw. |
| Tablica projektorowa | `/tablica` (bez logowania, kiosk) | wszyscy | publiczny odczyt stanu (bez nazw firm) |
| Tablica mobilna / w panelu | `/tablica` (responsywnie) + „Twoje spotkania" u dostawcy | uczestnicy | jw. + własne spotkania |

**Czas rzeczywisty: Supabase Realtime** (subskrypcja zmian tabel `postgres_changes`) — to usługa, którą
już opłacamy; nie wymaga własnego serwera WebSocket/SSE (Netlify Functions nie trzymają otwartych
połączeń, więc „WebSocket" z analizy Codexa w praktyce oznaczałby dodatkową usługę). Awaryjnie:
odpytywanie co 5 s, gdy kanał padnie.

## 2. Model danych (migracja 052)

```
fm_queue_meetings          -- 1 wiersz = 1 spotkanie w kolejce sieci (z planu + walk-in)
  id, event_date, retailer_id, station smallint default 1,
  company_id uuid null, walkin_name text null,      -- walk-in bez konta: nazwa ręcznie
  nr int,                                           -- NUMER Z PLANU (drukowany na kartach) — stały
  sort_key numeric,                                 -- kolejność wykonania (może się zmienić: re-queue)
  status text: planned | called | in_progress | done | no_show | skipped | cancelled
  source text: plan | walk_in | manual,
  called_at, started_at, ended_at, operator_id, note, version int

fm_queue_state             -- 1 wiersz = 1 stanowisko sieci (sieć × station)
  retailer_id, station, mode text: open | paused | free_entry | closed,
  current_meeting_id, next_meeting_id,              -- denormalizacja dla tablicy (tanie odczyty)
  updated_at, updated_by, version int

fm_queue_log               -- audyt: kto, kiedy, co (append-only)
  id, ts, operator_id, retailer_id, station, action, meeting_id, from_status, to_status, payload jsonb

fm_queue_assignments       -- operator → sieci (zwykle 4)
  operator_id, retailer_id
profiles.role += 'staff'   -- konta obsługi (magic link jak dziś), RLS: pisze tylko do przypisanych sieci
```

Liczba sieci i stanowisk wynika wyłącznie z danych (`retailers.fm26_active`, `station` 1..n) — dodanie
28. sieci albo drugiego stanowiska Biedronki to operacja admina, nie zmiana kodu. Sieć z dwoma
równoległymi stanowiskami = dwie kolejki (`station 1/2` + `station_label`, np. „Owoce" / „Warzywa"),
nigdy tekst `15&16`.

Fakty ze starej tablicy (stan z ostatniej edycji, sprawdzone 6.09): 27 wierszy; równoległe stanowiska
były modelowane jako osobne „sieci" (ALBERT Fruit / ALBERT Vegetables, Biedronka Import / kraj,
Dino Fruits / Vegetables) — to dokładnie `station_label`; numery dochodziły do 53 (Auchan) — więc
kolejka sieci musi spokojnie obsłużyć 50+ pozycji; „Free entry" siedziało w polu numeru i psuło
„następny = 1" — u nas to osobny `mode`.

Zasilenie: przy „Otwórz dzień" admin importuje pary z zatwierdzonego planu → `fm_queue_meetings`
(status `planned`, `sort_key = nr`). Reset tylko dla nowej `event_date`. Tryb testowy = ten sam import z
planu roboczego/symulacji na `event_date` = jutro (mamy już generator symulacji).

## 3. Statusy i reguły przejść

```
planned ──(Wywołaj)──► called ──(Rozpocznij)──► in_progress ──(Zakończ)──► done
   │                      │
   │                      └─(Nieobecny)─► no_show ──(Wrócił)─► planned*  * wstawiony po BIEŻĄCYM i NASTĘPNYM
   ├─(Pomiń)──► skipped   └─(Cofnij ≤30 s)─► poprzedni status (z logu)
   └─(Anuluj)─► cancelled
```

- **Wywołaj następny** to jedna akcja: zamyka bieżące (`done`) i woła pierwsze `planned` wg `sort_key`.
- **Nieobecny → powrót**: zgodnie z zasadą z kart („wejdziesz po zakończeniu bieżącego i kolejnego
  spotkania") — `sort_key` między drugim a trzecim oczekującym. Numer na tablicy pozostaje oryginalny
  (np. „12" pojawia się ponownie po „15"), bo taki numer ma wydrukowany dostawca.
- **Walk-in** dostaje `nr = max(nr)+1` w tej sieci; obsługa mówi numer ustnie.
- **Tryby stanowiska**: `paused` (przerwa/lunch — tablica: „PRZERWA"), `free_entry` („WOLNE WEJŚCIE"),
  `closed` („ZAMKNIĘTE" — sieć skończyła). Tryb nie kasuje kolejki.
- Timer: `started_at` → 10 min bursztyn, 12 min czerwony (tylko u operatora; na tablicy nigdy).

## 4. Panel operatora (tablet)

Logowanie magic linkiem (jak kupcy), rola `staff`. Ekran = kafelki przypisanych sieci (2×2 dla czterech;
układ automatyczny 1–6). Kafelek: logo + nazwa sieci · GATE · **TERAZ 12 — nazwa dostawcy** (operator
widzi nazwę, bo musi ją zawołać) · timer · NASTĘPNY 13 · dalej: 15, 16, 12↩.
Jeden duży przycisk główny zmienia etykietę wg stanu: **„Wywołaj 13" → „Rozpocznij 13" → „Zakończ 13
i wywołaj 14"**. Przyciski drugorzędne (mniejsze, z potwierdzeniem): Nieobecny · Wrócił · Pomiń ·
Przerwa/Wznów · Wolne wejście · Zamknij · Dodaj walk-in · **Cofnij (30 s)**.
Ochrona: blokada przycisku 1,5 s po dotknięciu + klucz idempotencji; zapis z `version` (optymistyczna
kontrola) — konflikt z drugiego tabletu = odświeżenie kafelka i komunikat, nigdy cichy nadpis; przy braku
połączenia przyciski szare + pasek „OFFLINE — dane z 12:34". Ręczne ustawienie dowolnego numeru
i edycja cudzej sieci = tylko koordynator (admin).

## 5. Panel administratora dnia

W istniejącej zakładce FM Spotkania: konfiguracja stanowisk per sieć (1/2), przypisanie operatorów,
„Otwórz dzień" (import z planu), podgląd wszystkich kolejek w siatce (jak tablica + nazwy + timery),
przejęcie dowolnej kolejki, przypięcie sieci na 1. stronie tablicy, ustawienia tablicy (kolumny,
rotacja s), eksport dziennika CSV, tryb testowy. Papierowy plan awaryjny **już istnieje**: karty sieci
(kolejka dostawców z numerami) — wydrukowane na stół kupca.

## 6. Tablica projektorowa (`/tablica`)

Dane publiczne: **tylko numer + nazwa/logo sieci + tryb** — nigdy nazwy dostawców. Czcionka główna:
Barlow Condensed (jak na kartach), numer TERAZ zielony, NASTĘPNY bursztynowy, tryby jako pełne
plakietki (czytelne w każdym świetle).

**Grupowanie wg GATE 1 / GATE 2** (dwie strefy ekranu z nagłówkiem bramki) — spójne z oznakowaniem
w sali i z kolumną „Wejście" na karcie dostawcy: człowiek szuka najpierw swojej bramki, potem sieci.

**Algorytm układu** (liczy się rozdzielczość sygnału, nie metry ekranu):
1. wejście: `N` stanowisk, viewport `W×H`, minimalna wysokość kafelka `Hmin` (numer ≥ ~5,5% wysokości
   ekranu, czyli ~60 px przy 1080p; regulowane w adminie);
2. dla kolumn `c = 2..6`: `rows = ceil(N/c)`, `tile = (H − nagłówek) / rows`; wybierz największe `c`,
   dla którego `tile ≥ Hmin` **i** szerokość kafelka mieści logo + dwa numery;
3. jeśli żadne `c` nie spełnia — **paginacja**: strony po `pojemność` stanowisk, rotacja 8–10 s,
   przypięte sieci zawsze na stronie 1, sieć ze zmienionym numerem podświetlona 10 s (i nie znika
   w trakcie podświetlenia);
4. proporcje 4:3 vs 16:9 obsłużone tym samym algorytmem (inne `W×H` → inne `c`);
5. tryb **dwóch ekranów**: `/tablica?screen=1of2` — każdy ekran dostaje połowę stanowisk (np. po jednej
   bramce). Priorytet: czytelność numeru z końca sali, nie zmieszczenie wszystkiego.
Kiosk: pełny ekran, brak przewijania, auto-reconnect, bufor ostatniego stanu, banner „brak połączenia
— dane z 12:34", nagłówek dwujęzyczny (TERAZ / NOW · NASTĘPNY / NEXT).

Orientacyjnie dla 1080p (16:9): 24 stanowiska → 4×6 lub 3×8 (kafelek ~150 px), 28 → 4×7 (~130 px),
32+ → 2 strony. Do potwierdzenia na realnym rzutniku w MCC Mazurkas (pytanie: jaka rozdzielczość?).

## 7. Widok mobilny + „to jest Twoja kolej"

`/tablica` na telefonie: jedna kolumna, filtr bramki, wyszukiwarka, ulubione (localStorage). Dodatkowo
w panelu dostawcy „Twoje spotkania" (już istnieje) każda pozycja dostaje kolumnę **TERAZ w sieci** i
etykietę „za 2 numery / Twoja kolej / zakończone" — coś, czego stary system nie umiał, bo nie znał
uczestników. (Powiadomienia push/SMS — etap 3.)

## 8. Niezawodność w dniu eventu

Supabase Realtime + fallback polling · optymistyczne `version` · idempotencja akcji · pełny log ·
blokada UI offline · reset kolejki tylko dla nowego `event_date` · tryb testowy dzień wcześniej na
realnych tabletach i rzutniku · hotspot LTE jako łącze zapasowe · papier = karty sieci.

## 9. Etapy (do 24.09 zostało 18 dni)

| Etap | Termin | Zakres |
|---|---|---|
| 1. Rdzeń | do 14.09 | migracja 052 · rola staff · import z planu · panel operatora (wywołaj/rozpocznij/zakończ/nieobecny/cofnij) · tablica z Realtime · widok mobilny |
| 2. Dzień eventu | do 19.09 | walk-in · powrót nieobecnego (reguła „po bieżącym i kolejnym") · tryby przerwa/wolne/zamknięte · konfiguracja stanowisk i operatorów · paginacja/przypinanie · log CSV · „Twoja kolej" u dostawcy |
| Próba generalna | 21–22.09 | tryb testowy na planie roboczym, realne tablety, rzutnik w docelowej rozdzielczości; 23.09 import zatwierdzonego planu |
| 3. Po evencie | — | statystyki opóźnień, prognoza czekania, SMS/push |

## 10. Ryzyka i decyzje biznesowe przed implementacją

1. **Rozdzielczość i proporcje rzutnika** w MCC Mazurkas (1080p? 4:3?) — od tego zależy układ.
2. **Ile tabletów i ile kont obsługi**; czy 1 osoba = 4 sieci (jak dotąd) — konfigurowalne, ale trzeba znać liczbę.
3. **Internet na sali**: Wi-Fi obiektu vs hotspoty; tablety i komputer tablicy na tym samym łączu?
4. **Sieci z dwoma stanowiskami** (które?) → dwie kolejki.
5. **Reguła powrotu nieobecnego**: „po bieżącym i kolejnym" (z kart) — potwierdzić jako stałą.
6. **Czy obsługa widzi nazwy dostawców** (tak — musi zawołać) i czy tablica pokazuje cokolwiek poza numerem (nie).
7. **Start 9:00 vs 10:00 per sieć** — tryb `free_entry`/`open` ustawiany ręcznie, czy automatycznie?
8. **Walk-in**: kto decyduje, że dostawca bez umówionego spotkania dostaje numer (obsługa czy kupiec)?
9. **Tablica dwujęzyczna** (PL/EN nagłówki) — tak; nazwy sieci jak w bazie.
10. **Po 17:00** — tryb `closed` dla wszystkich jednym przyciskiem admina.

## 12. Decyzje Artura (6.09.2026) — wiążące dla implementacji

1. **Rzutnik jest stary, słabej jakości** → tablica projektowana pod niską rozdzielczość (baza: 1024×768,
   4:3): ciemne tło, białe/zielone/bursztynowe numery o wysokim kontraście, nazwa sieci dużym tekstem
   zamiast logo, mniej pozycji na stronie (przy 4:3 ok. 2 kolumny × 6 = 12 stanowisk/stronę), paginacja
   z rotacją. Rzeczywistą rozdzielczość zmierzymy na próbie generalnej; układ liczy się z niej automatycznie.
2. **Obsługa: zwykle 1 osoba na 4 sieci, ale elastycznie** (mniej/więcej) — przypisanie stanowisk do osób
   robimy przed eventem w panelu admina; brak sztywnej liczby w kodzie.
3. **Wi-Fi obiektu** → twarde zabezpieczenia offline: blokada przycisków bez połączenia, bufor stanu na
   tablicy, auto-reconnect, akcje idempotentne (podwójne dotknięcie / ponowienie nie robi dwóch operacji).
   Rekomendacja: jeden hotspot LTE jako zapas dla komputera tablicy.
4. **Stanowiska sieci — dwa tryby**:
   - **`split`** (np. Dino Owoce / Dino Kwiaty): osobne kolejki per stanowisko; przy „Otwórz dzień"
     spotkania z planu trafiają na stanowisko wg kategorii dostawcy (reguła, admin może przenieść);
     dostawca jest zapraszany do konkretnego stanowiska;
   - **`parallel`** (np. Auchan × 2): jedna wspólna kolejka, dwa stanowiska pobierają z niej kolejne
     numery; tablica pokazuje dwa numery „TERAZ" i jeden „NASTĘPNY"; **pojemność sieci w algorytmie
     = 5 × liczba stanowisk** (zmiana w `buildFMData`, przed uruchomieniem algorytmu 17.09).
5. **Numery idą tylko do przodu.** Tablica nigdy nie pokazuje mniejszego numeru jako TERAZ/NASTĘPNY.
   Kto przegapił, sam podchodzi do obsługi; obsługa wpuszcza go **po bieżącym i kolejnym** spotkaniu
   jako obsługę „poza tablicą" (status `returned` → `in_progress` na stanowisku, bez zmiany wskaźnika
   na tablicy; timer działa, przycisk „Wywołaj następny" jest w tym czasie zablokowany).
6. **Brak numerów bez umówionego spotkania.** Wyjątek podejmuje obsługa na miejscu: akcja „Dodaj spotkanie
   (wyjątek)" z wpisaną nazwą firmy i potwierdzeniem; numer = kolejny do przodu (`max + 1`), źródło `exception`.
7. **Start ręczny, z zera, per stanowisko** — operator klika „Otwórz stanowisko", bo część sieci zaczyna
   o 9:00, część o 11:00. Zero automatów czasowych. „Zamknij wszystkie" o 17:00 — jeden przycisk admina.

## 13. Plan wdrożenia v2 (co zostanie zbudowane)

**Migracja 052 (`fm_queue`)** — aplikowana ręcznie:
`fm_stations` (retailer_id, idx, label, categories[], mode single|parallel|split) ·
`fm_queue_meetings` (event_date, retailer_id, station_id, company_id, exception_name, nr, sort_key,
status, called_at/started_at/ended_at, operator_id, source plan|exception, version) ·
`fm_queue_station_state` (station_id, mode closed|open|paused|free_entry, current_meeting_id, version) ·
`fm_queue_chain_state` (retailer_id, event_date, last_called_nr) ·
`fm_queue_log` (append-only audyt) · `fm_queue_assignments` (operator_id, retailer_id) ·
`profiles.role` += `staff` + RLS (staff pisze tylko do przypisanych sieci; tablica: publiczny odczyt
stanów bez nazw firm).

**Przejścia stanów jako RPC (SECURITY DEFINER), nie zapisy z klienta**: `fm_queue_open_station`,
`fm_queue_call_next`, `fm_queue_start`, `fm_queue_finish_and_call_next`, `fm_queue_no_show`,
`fm_queue_serve_returnee`, `fm_queue_add_exception`, `fm_queue_set_mode`, `fm_queue_undo` (≤30 s),
`fm_queue_open_day` (import z planu, tylko admin). Każda RPC: sprawdza `version` (konflikt = 409),
egzekwuje „tylko do przodu", pisze do logu, jest idempotentna po kluczu operacji. Dzięki temu
tablet, admin i tablica nie mogą się rozjechać.

**Widoki**: `/obsluga` (StaffPanel: kafelki przypisanych stanowisk, jeden duży przycisk stanu, akcje
drugorzędne z potwierdzeniem, timer 10/12 min, pasek OFFLINE) · admin „Dzień eventu" (stanowiska,
przypisania, Otwórz dzień, siatka podglądu, przejęcie, ustawienia tablicy, log CSV, Zamknij wszystkie) ·
`/tablica` (kiosk, Realtime + polling, sekcje GATE 1/2, paginacja/rotacja/przypinanie, `?screen=1of2`,
ciemny motyw wysokokontrastowy, PL/EN nagłówki) · `/tablica` mobilnie (jedna kolumna, filtr bramki,
ulubione) · „Twoje spotkania" u dostawcy z kolumną TERAZ i etykietą „za N / Twoja kolej".

**Harmonogram**: Etap 1 (do 12.09): migracja 052 + RPC + rola staff + konfiguracja stanowisk/przypisań
+ pojemność w algorytmie + Otwórz dzień + panel operatora (rdzeń) + tablica z Realtime.
Etap 2 (do 18.09): powroty poza tablicą, wyjątki, tryby, cofnij, paginacja/przypinanie/2 ekrany, log CSV,
„Twoja kolej", widok mobilny. **Próba generalna 21–22.09** (tryb testowy na planie roboczym, realne
tablety, rzutnik — pomiar rozdzielczości). 23.09: import zatwierdzonego planu. 24.09: event.

## 11. Gdzie zgadzam się z Codexem, a gdzie proponuję inaczej

Zgoda: cztery widoki na wspólnej bazie; hybryda; jednoznaczne statusy; audyt; idempotencja i kontrola
równoczesnych zmian; dynamiczny układ tablicy z paginacją zamiast zmniejszania czcionki; brak limitu
24; MVP bez SMS/statystyk.

Inaczej / dodatkowo:
1. **Realtime = Supabase Realtime**, nie własny WebSocket/SSE — konkretna technologia bez nowej infrastruktury.
2. **Numer należy do planu i karty** — „następny" to następne niezakończone spotkanie, nie `+1`;
   nieobecny wraca „po bieżącym i kolejnym" i zachowuje swój numer.
3. **Tablica pogrupowana wg GATE 1/2** — zgodna z oznakowaniem i kartami.
4. **„Twoja kolej" w panelu dostawcy** — integracja, której stary system nie mógł mieć.
5. **Karty sieci jako plan papierowy** — już wygenerowane, nie trzeba budować.
6. Status **„obecny/oczekuje" pomijam w MVP** — wymagałby odprawy przy stanowisku; wystarczy `planned → called`.
7. **Konta obsługi jako rola `staff` z RLS do przypisanych sieci** zamiast ogólnych „uprawnień".
