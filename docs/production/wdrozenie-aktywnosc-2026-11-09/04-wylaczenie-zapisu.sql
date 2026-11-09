-- ============================================================================
-- Aktywność — WYŁĄCZENIE zapisu wejść (wycofanie albo krok 0 przy ponowieniu wdrożenia).
-- Jedno polecenie, bez odwołań do pg_cron — działa także wtedy, gdy harmonogram jeszcze
-- nie istnieje. Sprawdź adres SQL Editora (produkcja: sklyfuvzjikkqerxtulo).
-- Oczekiwany wynik: jeden wiersz, enabled = false.
-- Zebrane dane zostają i nadal podlegają retencji 12 miesięcy.
-- ============================================================================
-- Bariera: wyłączna blokada modułu czeka na zakończenie trwających zapisów (które trzymają
-- blokadę współdzieloną). Po COMMIT żadne wywołanie nie dopisze już wizyty ani wejścia.
begin;
select pg_advisory_xact_lock(hashtextextended('app_activity:switch', 0));
update public.app_activity_settings
   set enabled = false, enabled_changed_at = now()
 where id
returning enabled, enabled_changed_at, collecting_since;
commit;
