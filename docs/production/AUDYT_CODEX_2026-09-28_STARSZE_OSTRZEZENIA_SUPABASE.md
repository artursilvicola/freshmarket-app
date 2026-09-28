# Starsze ostrzeżenia Supabase — priorytety i potwierdzone uprawnienia

Kontrola tylko katalogów, definicji i polityk, 28.09.2026. Nie wykonywano operacji mogących wysłać mail, dodać pakiet lub zmienić artykuł. To przegląd punktowy, nie pełny audyt penetracyjny ani dowód wykorzystania luk.

## Naprawione przy kontynuacji PreConnect

`purchase_package`, `allocate_proforma_number`, `claim_due_expiry_reminders`, `claim_due_inactivity_warnings`: EXECUTE dostępne wcześniej dla anon i authenticated; SECURITY DEFINER; brak sprawdzenia użytkownika. Pierwsza funkcja mogła dopisać pakiet i wpis portfela, druga zmienić licznik proform, pozostałe oznaczyć powiadomienia jako zarezerwowane i zwrócić adresy odbiorców. Samo REVOKE FROM PUBLIC nie zabrało bezpośrednich grantów projektu.

Migracja `20260928070055_restrict_service_credit_functions.sql` ogranicza je do service_role i ustala search_path zakupu. Kod serwerowy używa tego uprawnienia; proforma admina wywołuje zakup z kontekstu właściciela funkcji. W bazie produkcyjnej zweryfikowano: anon=false, authenticated=false, service_role=true dla wszystkich czterech. Nie zmieniono danych pakietów ani propozycji.

## Pilne, osobne tematy

**P1 — moduł artykułów: rzeczywiście otwarty zapis.** `articles` i `article_facts` mają RLS włączone, lecz polityki o nazwach „Service full access articles” / `service_full_facts` są `TO public`, `FOR ALL`, `USING true`; role anon mają także INSERT, UPDATE, DELETE na tabelach. Nazwa „service” nie ogranicza roli. Dodatkowo widok `articles_with_facts` ma SELECT dla anon/authenticated i wykonuje się z prawami właściciela. Zmiana samego widoku nie zamknie bazowych polityk. Te tabele dotyczą osobnego modułu redakcyjnego, nie są używane przez repo PreConnect. Trzeba ustalić klientów publicznego odczytu i przenieść zapis do service_role, pozostawiając jedynie świadomie publiczny SELECT. Nie zmieniałem ich automatycznie w ramach poprawki kredytów. [Wyjaśnienie problemu widoku](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).

**P1 — stary cron `fm_14d_reminder_job`.** SECURITY DEFINER z EXECUTE dla anon/authenticated, bez kontroli roli w treści. Potrafi uruchomić zewnętrzną funkcję poczty i zmienić `reminder_sent`; nie wolno wywoływać go w ramach testu bez zgody na wiadomości. Brak definicji tego joba w migracjach repo. Zalecenie: ustalić istniejący harmonogram i odebrać anon/authenticated prawo uruchamiania, zachować rolę wykonawcy crona; skontrolować uwierzytelnienie starego endpointu poczty. [EXECUTE dla anonimowego użytkownika](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable).

**P2 — nieaktywne konta adminów.** `is_admin()` sprawdza id i rolę, bez `active`. Nowy endpoint wysyłki sam odrzuca `active=false`, ale globalny model RLS/RPC wymaga osobnego przeglądu przed zmianą funkcji używanej przez cały system.

## Pozostałe grupy

| Grupa | Przed | Po | Ocena |
|---|---:|---:|---|
| SECURITY DEFINER RPC dostępne anon | 33 | 29 | Nie każda pozycja jest luką. Publiczna tablica musi działać bez logowania; funkcje triggerowe nie są zwykłymi RPC; część ma kontrolę sesji. Przejrzeć pozostałe pojedynczo. |
| SECURITY DEFINER RPC dostępne authenticated | 62 | 58 | RPC admina, operatora i kupca wymagają kontroli uprawnień wewnątrz; nie odbierać hurtowo. |
| Zmienny search_path funkcji | 19 | 18 | Naprawiony zakup. Pozostałe dobrać per zależności i kwalifikować nazwy; najpierw SECURITY DEFINER. |
| SECURITY DEFINER view | 1 | 1 | `articles_with_facts`, opis wyżej. |
| RLS bez polityk | 12 | 12 | Domyślna odmowa klientom, często pożądana dla tabel serwerowych. Nie dodawać „allow all”, żeby uciszyć ostrzeżenie. |
| Kontrola ujawnionych haseł wyłączona | 1 | 1 | Osobna konfiguracja Auth. |

Tabele bez polityk: ai_usage_logs, chain_langs, chain_runs, draft_sources, fm_login_attempts, market_uploads, plan_runs, price_results, proforma_counters, publication_log, translated_news, trend_topics.

Pozostałe funkcje bez stałego search_path: fm_is_privileged_session, profiles_guard_protected, companies_guard_protected, fm_is_server_session, fm_inputs_phase_lock, set_updated_at, tg_set_updated_at, calculate_package_price, is_early_bird, gen_registration_reference, tg_set_reference_number, safe_to_timestamptz, set_company_approved_at, fm_notify_send_email, fm_14d_reminder_job, enforce_super_admin_on_role_change, first_tuesday_on_or_after, company_has_admin_profile.

Źródła instrukcji naprawczych: [search_path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable), [RLS bez polityk](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [funkcje dla authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [ochrona haseł](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Nie ustalono, czy ktoś wcześniej wykorzystywał wymienione uprawnienia. Do takiej oceny potrzebne są logi z właściwego okresu i osobna analiza; same definicje nie są dowodem incydentu.
