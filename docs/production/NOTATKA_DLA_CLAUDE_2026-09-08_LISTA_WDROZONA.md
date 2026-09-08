# Lista spotkań obsługi — wdrożenie zakończone

8 września 2026. Wyraźna zgoda Artura: „ok, sprawdz i wdróż to”.

## Opublikowana wersja

- `origin/main` został przesunięty fast-forward z `b901bf4` do **`a7e87db4c8ef0c44dc1eab6cdb7cd127e2c88b7a`**. Nie zastępowano nowszego kodu ani nie wykonywano force push.
- Netlify production: **`6a9ff29d50868c000867539e`**, `ready`, branch `main`, dokładny commit jak wyżej; opublikowano **11:34:18 UTC / 13:34:18 Europe/Warsaw**.
- Panel: https://b2b.freshmarket.eu/obsluga
- Tablica: https://b2b.freshmarket.eu/tablice
- Dashboard wdrożenia: https://app.netlify.com/projects/freshmarketb2b/deploys/6a9ff29d50868c000867539e
- Punkt powrotu: poprzedni gotowy deploy produkcyjny **`6a9ed12ae1077c00081aa455`**, commit `b901bf4f709679dacf8dcc1ad7586457b5e48255`. W razie regresji przywrócić ten deploy; nie cofać migracji bazy dla tej zmiany frontendu.

Nie uruchamiano migracji SQL, nie zmieniano sekretów, ról, kont obsługi, przypisań, planu ani konfiguracji stanowisk. Nie otwierano dnia wydarzenia. Nie tworzono w tej turze rekordów testowych w Supabase. Nie wykonywano ponownie wcześniejszego zadania z kontem AIBĖ.

## Powtórzone sprawdzenia

1. `npm test`: **54/54** (5 plików).
2. Niezmienione niezależne testy `.review`: **9/9** (3 pliki).
3. `npm run build`: OK; pozostaje wcześniejsze ostrzeżenie Vite o dużych chunkach, nie błąd builda.
4. `git diff --check`: OK. Zakres względem starego `origin/main` nie obejmuje migracji SQL, funkcji Netlify ani `netlify.toml`. Biblioteka testowa pozostaje devDependency.
5. Utworzono draft **`6a9ff1d90223d0ff506d415d`**, kontekst `deploy-preview`, z dokładnie sprawdzonego worktree `a7e87db`. CLI draft nie ma `commit_ref`; pochodzenie ustalono z worktree, a opublikowany chunk StaffPanel porównano bajtowo z lokalnym artefaktem.
6. Draft wskazuje tylko testowy Supabase `uowpixwtewrmmvkyooec`; odpowiedzi funkcji: GET `staff-login` / `admin-staff` = oczekiwane 405, publiczny snapshot = 200. Nie zmieniano środowisk.
7. Produkcyjny bundle wskazuje **`sklyfuvzjikkqerxtulo`**, nie projekt testowy. Zawiera nowy `StaffPanel-CCE9KuY4.js`; trasa `obsluga-demo` i `react-test-renderer` nie występują w sprawdzanych artefaktach.
8. HTTP 200 dla `/obsluga`, `/tablice`, `/tablice?gate=1`, `/tablice?gate=2`, `/tablica?gate=1` i `/admin`. Dla SPA sam HTTP 200 nie jest dowodem zalogowania ani sprawdzenia panelu admina.
9. Rzeczywista przeglądarka produkcyjna: ekran logowania `/obsluga` poprawnie po PL i EN; `/tablica?gate=1#kontrola` przechodzi na `/tablice?gate=1#kontrola`; `/tablice` wyświetla 12 pozycji na pierwszej z 2 stron i dwujęzyczne etykiety.
10. Snapshot produkcyjny: data **2026-09-24**, **24 stanowiska, wszystkie `closed`**. Schemat publicznej odpowiedzi bez pól firm/dostawców, operatorów, e-maili, telefonów lub PIN-ów. Kontrola prywatnych uprawnień pozostaje oparta o wcześniejsze testy hostowane, nie o samą tę odpowiedź.

## Sprawdzenie prywatnego interfejsu — dokładna granica

Klikanie nowej listy wykonano na **lokalnym `/obsluga-demo`, z fikcyjnymi danymi w pamięci**, bez pisania do Supabase:

- Auchan, stanowisko 2: numer 12, pełna firma, instrukcja porównania karty i identyfikatora; wspólna lista obejmuje nr 11 w trakcie na stanowisku 1 oraz nr 12 wywołany na stanowisku 2.
- Filtr „Odbyte” pokazuje sześć zakończonych spotkań; rozwinięty nr 10 pokazuje godziny wywołania, rozpoczęcia i zakończenia.
- Angielska lista i wyszukanie `zolty` dają nr 16 „Żółty Ogród — Kwiaty Cięte”, z etykietą wyjątku.
- Zmiana Auchan → Dino Owoce daje właściwy nagłówek, numery 4/5 i odrębną listę pięciu spotkań, bez wierszy z Auchan. Zachowane zapytanie wyszukiwarki można usunąć przyciskiem Clear.
- Po symulowanym błędzie odczytu i Refresh pozostaje lista Dino oraz „Data may be outdated” z godziną ostatniego udanego odczytu.

Nie należy opisywać tego jako testu zalogowanego operatora na nowej produkcji lub fizycznym tablecie. W tej turze nie tworzono kont, nie ponawiano hostowanego testu RLS/Realtime ani zalewu. Trzy wcześniejsze zielone przebiegi oraz nieudany przebieg Realtime są nadal opisane w `NOTATKA_DLA_CLAUDE_CODEX_2026-09-08_OBSLUGA_LISTA_HOSTED.md`; nie usunięto dowodów niepowodzenia ani mechanizmów awaryjnych.

## Co pozostaje organizacyjnie

- Skonfigurować przypisania GATE według rzeczywistego układu sali. Widok z `?gate=1` aktualnie pokazuje „Tablica jeszcze nieaktywna”, natomiast widok bez filtra pokazuje stanowiska. Wdrożenie frontendu nie zmienia przypisań GATE.
- Przygotować konta obsługi i przypisania sieci z właściwą datą. Nie omijać ograniczenia daty logowania.
- Próba 21–22.09 na fizycznych tabletach i Wi-Fi obiektu: karta dostawcy kontra firma na liście, Auchan ×2, Dino split, utrata łącza/Realtime, powrót do karty, warning >25 s, rzutnik i rotacja stron. Polling 10 s zostaje.
- Uaktualnić instrukcję PDF docelowymi ekranami; nie traktować samego deployu jako potwierdzenia gotowości organizacyjnej wydarzenia.

Instrukcje wykorzystane przy pracy: Netlify Deploy / Netlify CLI and Deployment (istniejący projekt, oddzielny preview i production, kontrola artefaktu), Supabase (rozdzielenie projektów i brak ekspozycji sekretów/danych prywatnych).
