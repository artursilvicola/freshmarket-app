# Usunięcie zbędnego komunikatu kupca po publikacji

Artur 22.09.2026 polecił usunąć zbędny komunikat u kupca, zauważony podczas kontroli opublikowanego planu. Produkcja i origin/main w chwili rozpoczęcia: aaf293d6511f (wdrożenie wysyłki kart Claude’a). Wcześniejsza zaakceptowana poprawka aplikacji kupca pozostała na gałęzi review/fm-cards-combined-20260922.

## Zakres

- Z aktualnego main utworzono fix/fm-buyer-notice-production i przeniesiono wyłącznie zmianę MeetingDisclaimer JSX/CSS oraz istniejące testy paneli.
- Kupiec i podgląd admina: bez sekcji „Ważne informacje dotyczące spotkań B2B”, stanowisk, zmian/braku gwarancji oraz śledzenia kolejki. PL i EN.
- Pozostaje samodzielna sekcja pomocy Oksany/Jagody, nadal tylko po publikacji. Komunikat dostawcy zachowuje dotychczasową treść.
- Bez migracji, zmian planu, numerów, importu kolejek, zmian renderera PDF, funkcji wysyłki i maili. Wcześniejsze zmiany wydruku kupca z df5a7d6/8c366c4 pozostają poza tym wąskim wdrożeniem.

## Kontrola publikacji przed poprawką

- 13:05 Warszawa: published, finalny plan = cały zatwierdzony szkic rev. 182, 775 par. Hash planu 012240fb339fa40fedb7b018cfe5bd7b, numerów 69669bd2912fc5fc2c0aa0098197d117. Ten sam układ co rev. 181 przed zatwierdzeniem.
- Podgląd AMPLUS: Albert #5, PROMO #12, Fantastico #17, AIBĖ #49; zgodność z bazą. Podgląd Dino: 58 finalnych spotkań. Sprawdzono przełączanie PL/EN.
- To podglądy admina; próba uruchomienia fm_my_schedule z tożsamością uczestnika przez MCP nie była możliwa z powodu uprawnień konektora. Odczytano definicję funkcji, nie zmieniano uprawnień.
- Rejestr wysyłek i znaczniki fm_plan_sent_at: 0. Nie uruchamiano wysyłki.
- Kolejki na 24.09: 0 spotkań. Wymagany osobny „Dzień wydarzenia → Otwórz dzień (import planu)” oraz test tabletów na dacie testowej. Snapshot publiczny: 22 stanowiska, Gate 1=13, Gate 2=9, bez pustych Gate, Biedronki i Mega Image. Dino jedno stanowisko, Auchan dwa.
- Widok admina nadal pokazuje 737 z bieżącego obliczenia algorytmu obok 775 w zapisanym planie. Nie używać „Przebuduj plan” w celu synchronizacji kolejek.
- W konsoli sesji Chrome pomocnicze funkcje PreConnect i przypomnienia zwróciły „Nieprawidłowy token”. Odczyt kart nie zakończył się przygotowaniem kart. Pełna ścieżka wysyłki wymaga osobnego sprawdzenia sesji i jawnie zleconego maila testowego.

Weryfikacja przed wdrożeniem: Vitest 457/457 (59 plików), w tym 8 testów publikacji/wariantów PL-EN; build OK (dotychczasowe ostrzeżenie rozmiaru chunków); git diff --check OK. Testy potwierdzają zachowanie numerów/przekazanych danych i brak wywołań zapisu.

Punkt powrotu tego małego wdrożenia: tag prod-rollback-2026-09-22-buyer-notice = aaf293d. Wynik wdrożenia i kontroli przeglądarkowej w kopii notatki w outputs głównego workspace.
