# Wdrożenie kredytów PreConnect — 28.09.2026

Status: migracja i kontrola ukończone; deploy kodu oraz odnotowanie historii w toku. Zgoda Artura: „robimy?” oraz „spróbuj jeszcze raz”. Bez zgody na maile; żadnych nie wysłano.

## Kontrola i kopia

Świeży odczyt 08:11 CEST: 240 pakietów; manifest 75 rejestracyjnych / 123 rekompensaty / 38 neutralnych. A1–A4 bez braków i różnic. Salda 681 przyznanych, 73 zużyte, 608 pozostałych. Kopia wszystkich pakietów, wallet_tx, katalogu, pełnych 223 legacy_sends, ustawień pakietów firm i definicji widoku: `C:/Users/Artur/FreshMarket-Backups/FM-KREDYTY-20260928/przed/`. Odciski wszystkich pięciu tabel po migracji identyczne.

## Migracja i uzupełnienie ACL

SQL Editor produkcji sklyfuvzjikkqerxtulo, migracja 20260927120000_free_credit_grants.sql wykonana 08:13 CEST; oryginalny SHA256 29eb68f8007e4bd991d458e274b6989aee8d3a1587b8371c2c6275ec1a4960a5. Kontrola ujawniła domyślne bezpośrednie EXECUTE dla anon na dwóch nowych funkcjach; REVOKE FROM PUBLIC ich nie usuwał. Guardy auth.uid/is_admin już odrzucały niezalogowanych. Uzupełnienie 20260928061542_free_credit_grants_acl.sql odbiera anon EXECUTE admin_grant_free_credits i mark_credit_grant_seen oraz ustala search_path=pg_catalog dla business_today. Wszystkie trzy instrukcje wykonane i potwierdzone na produkcji przed kodem.

Runner odtwarza produkcyjne ALTER DEFAULT PRIVILEGES przed pierwszą migracją, potwierdza problem przed poprawką i poprawne ACL po niej. Migracje od zera, powtórzenia, test SQL, współbieżność i A/B na fixture 240 pakietów: PASS. Nie zmieniono pierwotnej migracji ani aplikacji względem zatwierdzonego 8ad9c3c.

role_table_grants przez rolę odczytu konektora nie pokazuje grantów innych ról; sprawdzono je przez has_table_privilege: anon bez praw, authenticated wyłącznie SELECT z RLS is_admin. Trzy funkcje rozliczeń tylko service_role, RPC admina/oznaczenia przeczytania dostępne authenticated i zabezpieczone w środku. company_capacity security_invoker=true, 7 nowych kolumn, dzień warszawski.

Supabase Security Advisor zgłasza także wcześniejsze problemy spoza tej zmiany (m.in. articles_with_facts jako security definer, domyślne uprawnienia innych RPC). Nie zmieniano ich przy tym wdrożeniu. Nowe business_today naprawione; pozostałe nowe definer RPC mają ustawiony search_path i zamierzone uprawnienia.

## Dalsze kroki

Fast-forward main, potwierdzenie opublikowanej wersji; dopiero potem zapis B z blokadą i 75/123/38. Test bez e-maili na firmie testowej. Rekompenstat nowych: zero. Po oznaczeniu historii nie cofać backendu do 37e90c7 (brak grant-first i atomowości).
