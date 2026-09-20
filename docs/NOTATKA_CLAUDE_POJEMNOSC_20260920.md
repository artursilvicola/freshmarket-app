# Zapis pojemnosci stanowisk

Uzytkownik zglasza, ze zmiana 60 na 50 w Dzien wydarzenia / Stanowiska nie zapisuje sie po opuszczeniu pola.

## Przyczyna w kodzie main f9234f9

FmEventDay.patchGroup wysyla tylko id i zmienione pole. upsertFmQueueGroup stosowal upsert, czyli INSERT ON CONFLICT. Tabela fm_queue_groups ma event_date i retailer_id NOT NULL bez wartosci domyslnych. Czesciowy payload nie spelnia wymagan INSERT, zanim rozstrzygniety zostanie konflikt id. To dotyczy takze innych czesciowych edycji grupy.

Nie przechwycono odpowiedzi z sesji Artura: dostepna przegladarka wbudowana byla na /login. Diagnoza wynika z kodu wywolania i schematu migracji 053; nie wykonano proby zapisu na produkcji.

## Poprawka

- Istniejace id: UPDATE tylko przekazanych dozwolonych pol, filtr id, select().single().
- Bez id: INSERT nowej grupy z danymi utworzenia.
- Brak zmiany RLS, RPC lub schematu. Bledy zapisu nadal sa rzucane, zero zaktualizowanych wierszy nie jest sukcesem.
- Po poprawnym zapisie grupy panel pokazuje potwierdzenie. Zapis nadal wyzwalany przez onBlur.
- Testy obejmuja czesciowy zapis pojemnosci, tworzenie grupy oraz bledy uprawnien, braku wiersza i constraintu. Testy JS stosuja atrape klienta; nie sa testem integracyjnym Postgresa.

## Wdrozenie i kontrola

Poprawka przygotowana na osobnej galezi fix/fm-queue-capacity-save, bez deployu. Po review i zatwierdzeniu wdrozenia sprawdzic zmiane pojemnosci na grupie testowej: 60 -> 50, odswiezenie strony, odczyt 50, przywrocenie wartosci testowej. Nie przeliczac ani publikowac planu w ramach tej poprawki.

Osobna obserwacja: upsertFmStation ma podobny wzorzec; nie zmieniano go w tym zadaniu dotyczacym pojemnosci grupy.
