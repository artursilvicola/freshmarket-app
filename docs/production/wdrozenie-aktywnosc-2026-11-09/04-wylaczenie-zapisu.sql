-- ============================================================================
-- Aktywność — WYŁĄCZENIE zapisu wejść (wycofanie albo krok 0 przy ponowieniu wdrożenia).
-- Jedno polecenie, bez odwołań do pg_cron — działa także wtedy, gdy harmonogram jeszcze
-- nie istnieje. Sprawdź adres SQL Editora (produkcja: sklyfuvzjikkqerxtulo).
-- Oczekiwany wynik: jeden wiersz, enabled = false.
-- Zebrane dane zostają i nadal podlegają retencji 12 miesięcy.
-- ============================================================================
update public.app_activity_settings
   set enabled = false, enabled_changed_at = now()
 where id
returning enabled, enabled_changed_at, collecting_since;
