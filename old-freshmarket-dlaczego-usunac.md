# Dlaczego trzeba usunąć old.freshmarket.eu

**Data:** 2026-04-23
**TL;DR:** Stara strona już nie służy biznesowi (treści przeniesione), ale dalej generuje realne ryzyko bezpieczeństwa, koszty utrzymania i szkody SEO. Wyłączenie + zachowanie 301-ek to najlepszy stosunek korzyści do ryzyka. Każdy tydzień zwłoki = otwarte okno na atak.

---

## 1. Bezpieczeństwo — to jest pilne, nie hipotetyczne

WordPress old.freshmarket.eu jest publicznie dostępny i ma **konkretne, świeże, niezałatane podatności**:

- **Avada 7.15** (motyw aktywny) — wersja 7.15.2 z 13 kwietnia 2026 zawiera łatkę na **unauth SQL injection** w elemencie Post Cards. Stare lewe = każdy w internecie może wyciągnąć zawartość bazy danych bez logowania. CVE jest publiczne, exploit prosty.
- **Avada Builder 3.15.0** (wtyczka aktywna) — dwa CVE z 2026 roku: **CVE-2026-1541** (info disclosure) i **CVE-2026-1509** (privilege escalation przez action hooks). Łatka w wersji > 3.15.1.
- **AI Engine 2.7.4** (wtyczka nieaktywna, ale na dysku) — **CVE-2025-11749, CVSS 9.8** (privilege escalation przez wyciek bearer tokenu MCP). Dodatkowo CVE-2025-7847 (file upload) i CVE-2024-29090 (SSRF). Łatka w 3.1.4. Nieaktywna wtyczka nadal leży na dysku i jej pliki są dostępne.
- **WP Go Maps 9.0.45** (aktywna) — major version behind, gałąź ma historię unauth SQLi (siostrzana wtyczka WP Maps: CVE-2026-2580, CVE-2026-3222).
- **TranslatePress 2.9.6** (aktywna) — major version behind, zmiany w warstwie autoryzacji od wersji 3.0.

**Konsekwencja konkretnego włamania:**
- Wyciek danych z bazy WP (m.in. wszystkie zapisane formularze kontaktowe, dane uczestników).
- Defacement subdomeny — Google natychmiast oznacza freshmarket.eu jako "this site may harm your computer" (problem cały brand, nie tylko old.*).
- Wykorzystanie serwera do rozsyłania spamu / hostowania malware → blacklisty SMTP, problemy z dostarczalnością maili z całej domeny.
- Pivot na nową stronę freshmarket.eu — wspólny serwer, wspólne FTP, wspólne logi.
- Notyfikacja do UODO w 72h (RODO art. 33), jeśli wyciek dotknął danych osobowych.

**Stan obrony obecnie:**
- WordPress 6.9.4 jest aktualny (dobrze), ale to jedyna dobra wiadomość.
- Nie ma WAF.
- Nie ma rate limitingu.
- Liczba aktywnych wtyczek = 33 (każda to potencjalny wektor).
- Disk quota serwera 17.7/20 GB — nie ma już miejsca na nic, w tym na logi audytowe.

## 2. Brak wartości biznesowej — strona już nie służy

- Cała treść została przeniesiona na nową freshmarket.eu (Laravel).
- Klienci/wystawcy nie powinni trafiać na old.* — to relikty z indeksu Google.
- Nikt z zespołu nie loguje się do tego WordPressa w celach roboczych (poza administracyjnymi).
- Formularze kontaktowe na old.* nie są monitorowane → każdy lead, który tam wpadnie, ginie.
- Wszystkie "dynamiczne" funkcje (komentarze, formularze, search) są bezużyteczne, bo nikt już ich nie używa.

**Pytanie kontrolne:** "Co byśmy stracili biznesowo, gdyby old.freshmarket.eu zniknął jutro?" → **Nic**, pod warunkiem że stare URL-e dalej redirectują na nową stronę. To właśnie robi plan migracji.

## 3. SEO — old.* aktywnie szkodzi nowej stronie

Dopóki obie żyją równolegle:
- **Duplicate content** — Google widzi dwie wersje tego samego tekstu (stara WP i nowy Laravel po migracji). Algorytm musi wybrać "kanoniczną" — czasem wybiera tę gorszą.
- **Split link equity** — backlinki z czasów starej strony wskazują na old.*, nie na freshmarket.eu. Domain authority rozproszone.
- **Crawl budget waste** — Googlebot indeksuje 820 stron starej WP zamiast skupić się na nowej.
- Bez 301-ek do nowej strony, ten ranking będzie powoli wygasać sam, a nowa strona będzie zaczynać od zera.

301 z wszystkich starych URL-i na nowe = **przekazanie ~85-95% link juice** (potwierdzone przez Mueller/Google). To jest jednorazowa, odwracalna operacja, która natychmiast konsoliduje SEO.

## 4. Koszt utrzymania — stała pożyczka czasu

Nawet jeśli zignorujemy bezpieczeństwo, utrzymywanie WordPressa na poziomie minimum to:
- Aktualizacja core WordPressa co ~2 tygodnie (auto-update bywa zawodny dla custom themes).
- Aktualizacja motywu Avada co ~1-2 miesiące.
- Aktualizacja 33 wtyczek przeciętnie co tydzień (suma).
- Każda większa aktualizacja = ryzyko, że coś przestanie działać → trzeba sprawdzić wszystkie strony.
- Monitoring CVE feedów (WPScan, Patchstack) — ktoś musi to robić, inaczej znajdziemy się w sytuacji jak teraz.

**Czas roczny realistycznie:** 20-40h pracy administratora rocznie tylko na utrzymanie statusu "nie zhakowane".

Po wyłączeniu WP i zostawieniu samego `.htaccess`: **0h utrzymania, 0 wektorów ataku, 0 niespodzianek**.

## 5. Compliance / RODO

- Stary WP może mieć formularze, które kiedyś zbierały dane osobowe **bez aktualnych zgód marketingowych** (przed wprowadzeniem nowego cookie bannera Complianz GDPR).
- Każdy zapisany rekord = potencjalne naruszenie zasady minimalizacji danych.
- Trzymanie danych osobowych "na zapas, bo może się przyda" jest sprzeczne z art. 5 RODO (limitacja celu i czasu).
- Po wyłączeniu old.* wszystkie zapisane dane są albo (a) eksportowane do nowej strony świadomie, z aktualnymi zgodami, albo (b) usuwane razem z bazą.

## 6. Disk quota i transfer

- Serwer: **17.7 GB / 20 GB** (86% zajęte). Nowe wpisy w log files lub upload uploads już mogą zacząć padać.
- Old WP zajmuje większość — uploads/ ma większość plików multimedialnych z lat działalności.
- Po wyłączeniu old.* można zwolnić ~15 GB → odetchnięcie dla nowej strony, miejsca na inne projekty.

## 7. "Co tracimy, jeśli wyłączymy?"

| Element | Co się stanie | Czy to problem? |
|---|---|---|
| Stare URL-e w Google | 301 → nowa strona | Nie — SEO przeniesione |
| Treści | Już są na nowej stronie | Nie |
| Stare formularze kontaktowe | Nie istnieją (były nieobsługiwane) | Nie |
| Logi historyczne WP | Mamy backup bazy lokalnie | Nie |
| Możliwość "wrócenia do starej strony" | Mamy backup plików + bazy | Nie |
| Estetyka starej szaty graficznej | Można odtworzyć z backupu w Local WP | Nie |
| Coś, czego jeszcze nie wiemy | Szczerze: ryzyko niskie, ale jest backup | Akceptowalne |

## 8. Rekomendacja decyzyjna

**Działać.** Plan jest gotowy (dokument: `old-freshmarket-migration-brief-informatyk.md`):
1. Backup plików przez FTP (już mamy bazę).
2. Mapa 301/410 z gotowego XLSX-a (820 URL-i).
3. `.htaccess` zamiast WordPressa.
4. Monitoring 90 dni w GSC.

**Czas realizacji:** 2 dni robocze.
**Inwestycja:** kilka godzin pracy informatyka + osoby weryfikującej mapę URL-i.
**Zwrot:** wyeliminowane ryzyko incydentu bezpieczeństwa, konsolidacja SEO, koniec długu utrzymaniowego, zwolnienie 15 GB miejsca na serwerze.

**Koszt zaniechania (rocznie):**
- 20-40h pracy admina na utrzymanie WP.
- Otwarte CVE → realne ryzyko incydentu z konsekwencjami od kilku tysięcy do kilkuset tysięcy zł (RODO + reputacja).
- Powolna utrata SEO na rzecz duplicate content.

**Asymetria jest oczywista.** Jedyny rozsądny argument za zostawieniem starego WP byłby: "mamy aktywnych użytkowników, którzy korzystają z dynamicznych funkcji" — co tu nie zachodzi.
