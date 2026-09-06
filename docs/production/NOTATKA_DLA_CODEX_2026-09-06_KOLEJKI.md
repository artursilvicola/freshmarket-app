# Notatka dla Codexa — moduł kolejek / numerki spotkań na żywo: prośba o akceptację planu

Claude, 6.09.2026. Pełna propozycja + decyzje Artura: `docs/production/FM_KOLEJKI_NUMERKI_PROPOZYCJA.md`
(sekcje 12–13). Twoja analiza starego systemu była trafna — zbudowałem na niej, z kilkoma różnicami.
Artur chce, żebyśmy oboje zaakceptowali plan przed kodem. Proszę o odpowiedź punkt po punkcie.

## Decyzje Artura, które są już rozstrzygnięte (nie dyskutujemy)

- Numery **tylko do przodu**; przegapiony numer nie wraca na tablicę — obsługa wpuszcza spóźnionego po
  bieżącym i kolejnym spotkaniu, „poza tablicą".
- **Brak walk-inów** — wyjątek tylko decyzją obsługi na miejscu (numer `max+1`, źródło `exception`).
- Start **ręczny per stanowisko** (9:00 vs 11:00), zero automatów czasowych.
- Stanowiska: tryb **split** (Dino Owoce / Dino Kwiaty — osobne kolejki wg kategorii) i **parallel**
  (Auchan × 2 — wspólna kolejka, dwa numery TERAZ) → **pojemność sieci w algorytmie = 5 × stanowiska**.
- Rzutnik stary/słaby → tablica pod 1024×768, ciemna, wysoki kontrast, nazwy zamiast logo, paginacja.
- Wi-Fi obiektu; obsługa elastycznie ~4 sieci/osoba, przypisania w panelu admina przed eventem.

## Proszę o akceptację (lub kontrpropozycję) sześciu decyzji projektowych

1. **Przejścia stanów wyłącznie przez RPC `SECURITY DEFINER`** (`fm_queue_call_next`, `_start`,
   `_finish_and_call_next`, `_no_show`, `_serve_returnee`, `_add_exception`, `_set_mode`, `_undo`,
   `_open_day`), każda z `version` (409 przy konflikcie), regułą „tylko do przodu" i wpisem do
   `fm_queue_log`. Klient nigdy nie pisze bezpośrednio do tabel kolejki. Alternatywa (zapisy z klienta
   + trigger) jest prostsza, ale nie zamknie ścieżek obejścia.
2. **Realtime = Supabase Realtime (`postgres_changes`)** na `fm_queue_station_state` /
   `fm_queue_chain_state`, polling 5 s jako fallback. Bez własnego WebSocket/SSE (Netlify Functions nie
   trzymają połączeń). Do potwierdzenia: limit równoczesnych połączeń w naszym planie Supabase przy
   ~300 telefonach uczestników + tablety + tablica (jeśli za mało — tablica/telefony na pollingu, Realtime
   tylko dla tabletów).
3. **Rola `staff`** w `profiles` + RLS „pisze tylko do przypisanych sieci" (`fm_queue_assignments`),
   logowanie magic linkiem jak kupcy. Tablica publiczna czyta **wyłącznie** widok bez nazw firm
   (`fm_queue_board` view: nazwa sieci, stanowisko, tryb, TERAZ, NASTĘPNY, gate).
4. **Model stanowisk** (`fm_stations` z `mode`): split → przydział spotkań do stanowiska przy
   „Otwórz dzień" po kategoriach dostawcy (admin poprawia ręcznie); parallel → wspólna kolejka.
   Czy widzisz przypadek, którego to nie pokrywa (np. Auchan 2 stanowiska **i** podział na kategorie)?
5. **Zmiana w `buildFMData`**: `cs[cid].n >= FM_MAX_S * stations(cid)` — pojemność per sieć z liczby
   stanowisk. Musi wejść **przed 17.09** (uruchomienie algorytmu). To dotyka rdzenia dopasowania —
   proszę o osobny review tego diffu.
6. **Powracający spóźniony** = status `returned` obsługiwany na stanowisku bez zmiany
   `last_called_nr`; w tym czasie „Wywołaj następny" zablokowane, timer działa, log pisze
   `serve_returnee`. Tablica go nie pokazuje. Zgoda?

## Podział pracy (propozycja)

- Claude: migracja 052 + RPC + RLS, panel operatora, admin „Dzień eventu", tablica, integracja z panelem dostawcy, tryb testowy.
- Codex: **review bezpieczeństwa migracji 052 i RPC** (RLS staff/anon, `SECURITY DEFINER`), review diffu
  pojemności w algorytmie, test E2E na tabletach (Android/iPad, Chrome/Safari) i pomiar rozdzielczości
  rzutnika na próbie generalnej 21–22.09, test obciążeniowy Realtime (≥300 klientów).

## Harmonogram

Etap 1 do **12.09** (rdzeń: migracja, RPC, staff, konfiguracja, Otwórz dzień, operator, tablica, pojemność),
Etap 2 do **18.09** (powroty, wyjątki, tryby, cofnij, paginacja/2 ekrany, log CSV, „Twoja kolej", mobile),
próba generalna **21–22.09**, import zatwierdzonego planu **23.09**, event **24.09**.

Jeśli akceptujesz punkty 1–6 (albo część), napisz krótko „OK 1,2,3…" + uwagi — zaczynam od migracji 052
i RPC, żeby review bezpieczeństwa mógł iść równolegle z UI.
