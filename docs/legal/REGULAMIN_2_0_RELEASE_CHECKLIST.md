# Regulamin 2.0 — checklista publikacji

Data przygotowania: 9 czerwca 2026  
Planowana data wejścia w życie: 23 czerwca 2026

## Zakres zmiany

Regulamin 2.0 dodaje §16: archiwizacja, anonimizacja i usunięcie kont nieaktywnych przez 24 miesiące, z ostrzeżeniami 30 i 7 dni przed planowanym terminem.

Zmiana dotyczy obowiązków i praw Użytkownika, więc jest traktowana jako major change według `src/lib/legal-versions.js`.

## Co zmienia branch

- `TERMS_VERSION = "2.0"`
- `PRIVACY_VERSION` bez zmian (`1.0`)
- `public/regulamin.html` — wersja 2.0, §16, wejście 23 czerwca 2026
- `public/regulations.html` — EN draft z §16, wejście 23 czerwca 2026
- `docs/legal/REGULAMIN.md` — wersja 2.0

## Warunki przed merge/publikacją

1. Operator zatwierdza treść §16.
2. Operator wysyła Użytkownikom powiadomienie o zmianie regulaminu z 14-dniowym wyprzedzeniem.
3. Treść maila zawiera:
   - informację o wersji 2.0,
   - link do `https://b2b.freshmarket.eu/regulamin`,
   - datę wejścia w życie: 23 czerwca 2026,
   - opis §16: konta nieaktywne 24 miesiące, ostrzeżenia 30/7 dni, anonimizacja/usunięcie, retencja dokumentów rozliczeniowych,
   - informację, że brak akceptacji zmian umożliwia rozwiązanie umowy zgodnie z §15.
4. Operator decyduje, czy na tym etapie wystarcza powiadomienie e-mail zgodnie z §15, czy osobno budujemy ekran re-akceptacji w aplikacji.

## Ważne ograniczenia

- `ACCOUNT_HARD_DELETE` musi pozostać `false`.
- Publikacja regulaminu 2.0 nie uruchamia twardego usuwania kont.
- `ACCOUNT_LIFECYCLE=true` tylko aktualizuje `last_active_at` i przygotowuje ostrzeżenia; z ostatniego DRY-RUN wynikało 0 ostrzeżeń 30/7 dni.
- Twarde usuwanie albo anonimizacja kont wymaga osobnego sandboxu, sign-offu i osobnej flagi.

## Proponowana treść maila

Temat: Zmiana Regulaminu Fresh Market B2B — wersja 2.0

Szanowni Państwo,

informujemy o zmianie Regulaminu korzystania z platformy Fresh Market B2B PreConnect.

Nowa wersja Regulaminu 2.0 została ogłoszona 9 czerwca 2026 i wejdzie w życie 23 czerwca 2026.

Najważniejsza zmiana to dodanie §16, który opisuje zasady archiwizacji, anonimizacji i usunięcia kont nieaktywnych przez 24 miesiące. Przed planowanym usunięciem albo anonimizacją konta system wyśle ostrzeżenia na 30 dni i 7 dni przed terminem. Zalogowanie się do panelu zeruje licznik nieaktywności.

Historia rozliczeń, faktury, płatności i dokumenty księgowe mogą być zachowywane w zakresie wymaganym przepisami prawa.

Aktualna treść Regulaminu jest dostępna tutaj:
https://b2b.freshmarket.eu/regulamin

Jeżeli nie akceptują Państwo zmian, przysługuje Państwu prawo rozwiązania umowy zgodnie z §15 Regulaminu.

Pozdrawiamy,  
Fresh Market B2B
