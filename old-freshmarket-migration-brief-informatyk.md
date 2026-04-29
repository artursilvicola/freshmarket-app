# old.freshmarket.eu — brief dla informatyka

**Data:** 2026-04-23
**Zadanie:** wyłączyć WordPress na old.freshmarket.eu, zachować SEO starych URL-i przez przekierowania 301/410.
**Szacowany czas:** 2 dni robocze (backup + mapowanie + wdrożenie).

---

## Kontekst

Stara strona freshmarket.eu była w WordPress. Jej treści zostały zmigrowane na nową stronę freshmarket.eu (Laravel), a stara instalacja WP została przeniesiona pod subdomenę `old.freshmarket.eu`. Google nadal indeksuje tam ~820 URL-i (strony i posty), i chcemy nie stracić z tego ruchu ani rankingu.

Problem jest też bezpieczeństwa: WordPress siedzi z kilkoma świeżymi CVE (Avada 7.15 ma unauth SQL injection — łatka 7.15.2 z 13 kwietnia 2026; Avada Builder 3.15.0 ma CVE-2026-1541 i CVE-2026-1509; AI Engine 2.7.4 nieaktywna, ale na dysku, CVSS 9.8). Każdy dzień z działającym PHP na old.* to otwarty wektor ataku.

Stan na teraz:
- Baza danych **już wyeksportowana** — pliki `.sql.gz` w `Fresh Market 2026\old-freshmarket-backupdb\` (3 bazy, ~65 MB łącznie).
- Inwentarz URL-i **już przygotowany** — `old-freshmarket-inventory-2026-04-22.xlsx` (820 rekordów z gotowymi kolumnami do uzupełnienia: "URL (nowy / proponowany)" i "Akcja").
- Raport CVE wtyczek — `old-freshmarket-plugins-CVE-2026-04-22.md`.

---

## Cel końcowy

Subdomena `old.freshmarket.eu` po zakończeniu prac:
- **Zero PHP.** Żaden skrypt ani wtyczka nie odpala się.
- **301** dla URL-i mających odpowiednik na nowej stronie → konkretny adres na `freshmarket.eu`.
- **410 Gone** dla świadomie wycofanego contentu (Google szybko wyindeksuje bez obniżki rankingu).
- **301 → `https://freshmarket.eu/`** jako fallback dla wszystkiego, czego nie zmapowaliśmy jawnie.
- Apache serwuje wyłącznie plik `.htaccess`. Katalog WP przeniesiony do `.BACKUP` na ~tydzień, potem usuwany.

---

## Kroki do wykonania

### 1. Pełny backup (pre-flight)

**Baza danych:** już mamy (`Fresh Market 2026\old-freshmarket-backupdb\`). Nic nie robić.

**Pliki WP:** SFTP/FTP do `s56.cyber-folks.pl`, użytkownik `rxdpelhpvh` (hasło = panel admin cyber-folks). Pobrać:
- `/domains/old.freshmarket.eu/public_html/` (cały katalog — ~15-17 GB, kilka godzin downloadu)
- `/domains/old.freshmarket.eu/public_html/wp-config.php` (zawiera klucze bazy — traktować jak sekret, nie commitować)
- `/domains/old.freshmarket.eu/public_html/.htaccess` (obecny, dla referencji)

Narzędzia: WinSCP, FileZilla, lub `lftp mirror`. Pobieranie robimy równolegle do dalszych kroków.

**Uwaga dot. quota:** disk usage serwera to 17.7 GB z 20 GB przydziału. Nie tworzymy na serwerze żadnego ZIP-a, pobieramy pliki 1:1 — inaczej Simply Static/Duplicator padną na disk quota (test z lutego to potwierdza).

**Safety net po stronie hostingu:** cyber-folks ma automatyczne daily backupy (panel → "Kopie zapasowe/backup"), dostępne ~10 dni wstecz + tygodniowe + miesięczne. To nie zastępuje naszej kopii lokalnej, ale jest dodatkowym zabezpieczeniem.

### 2. Mapowanie URL-i (kluczowy krok manualny)

Źródło prawdy: `old-freshmarket-inventory-2026-04-22.xlsx`, arkusz "Inventory", 820 wierszy.

Każdy wiersz dostaje decyzję w kolumnie **"Akcja (301 / 410 / keep)"**:

| Akcja | Kiedy stosować | Co wpisać w kolumnie "URL (nowy / proponowany)" |
|---|---|---|
| `301` | URL ma odpowiednik na nowej freshmarket.eu | Pełny URL docelowy, np. `https://freshmarket.eu/o-targach` |
| `410` | Content świadomie wycofany (np. posty blogowe z 2019, stare newsy) | (puste) |
| `301→home` | Brak dokładnego odpowiednika, ale nie chcemy 404 | `https://freshmarket.eu/` |
| `keep` | URL ma dalej żyć pod old.* (raczej nie wystąpi) | (ten sam URL) |

**Kolejność pracy:**

a) **Auto-match po slugu** (skrypt): dla każdego starego URL sprawdzić czy na `freshmarket.eu` istnieje strona o tym samym ostatnim segmencie. Jeśli tak — pre-fill w XLSX. Przykład: `/o-targach` → sprawdzić `HTTP GET https://freshmarket.eu/o-targach`, jeśli 200, uzupełnić.

b) **Ręczna weryfikacja** przez osobę znającą nową strukturę strony — przejrzeć pre-fill i poprawić błędne, uzupełnić niezmapowane.

c) **Quality check**: dla każdego zmapowanego 301 otworzyć target URL w przeglądarce, potwierdzić że rzeczywiście to odpowiednik tematyczny.

Stopień manualności: ~30-40% URL-i da się zautomatyzować, reszta ręcznie. Przy 820 URL-i liczymy 4-8h pracy człowieka.

### 3. Wygenerowanie pliku `.htaccess`

Skrypt (Python/Bash) czytający XLSX i produkujący plik w formacie:

```apache
# old.freshmarket.eu — redirect-only, no WordPress
# Generated from inventory XLSX on YYYY-MM-DD
RewriteEngine On
RewriteBase /

# --- Konkretne 301 ---
RewriteRule ^o-targach/?$              https://freshmarket.eu/o-targach              [R=301,L]
RewriteRule ^exhibitors/?$             https://freshmarket.eu/wystawcy              [R=301,L]
RewriteRule ^kontakt/?$                https://freshmarket.eu/kontakt               [R=301,L]
# ... reszta mapy

# --- 410 dla wycofanych ---
RewriteRule ^blog/post-z-2019-roku/?$  - [R=410,L]
# ... reszta

# --- Fallback: wszystko inne → homepage ---
RewriteRule .* https://freshmarket.eu/ [R=301,L]
```

Kilka reguł pomocniczych na górze pliku:
- wymuś HTTPS (jeśli jeszcze nie jest w globalnej konfiguracji)
- obsłuż końcowe `/` (regexy z `/?$`)
- opcjonalnie: zachowaj query string przez `[QSA]` (np. gdy stare linki miały `?lang=en`)

### 4. Środowisko testowe (przed produkcją)

Dwa warianty:

**Lokalnie** — XAMPP/Docker Apache, w `htdocs/old.freshmarket.eu/` wrzucić wygenerowany `.htaccess`. Następnie:

```bash
# Testuj wszystkie 820 URL-i
while IFS=$'\t' read -r old_url expected_code expected_target; do
  actual=$(curl -s -I -o /dev/null -w "%{http_code}|%{redirect_url}" "$old_url")
  echo "$old_url → $actual (expected: $expected_code → $expected_target)"
done < test-cases.tsv > results.txt
```

**Na stagingu** — wykorzystać darmowy alias cyber-folks `rxdpelhpvh.cfolks.pl`, ustawić tam `.htaccess` i przetestować.

Wymagany wynik: 0 przypadków 404, 0 przypadków 500, wszystkie 301 trafiają w zaplanowane targety.

### 5. Wdrożenie na produkcji

**Wariant preferowany — usunięcie WP:**

```bash
cd /home/rxdpelhpvh/domains/old.freshmarket.eu
mv public_html public_html.BACKUP-2026-MM-DD
mkdir public_html
# Upload przygotowanego .htaccess do public_html/
chown rxdpelhpvh:rxdpelhpvh public_html/.htaccess
chmod 644 public_html/.htaccess
```

Potem:
- W panelu cyber-folks potwierdzić, że subdomena `old.freshmarket.eu` dalej ma DocumentRoot ustawiony na `/public_html/`.
- Smoke test: curl 20 losowych URL-i, sprawdź kody.
- Monitoring logów Apache pierwsze 24h.

Katalog `public_html.BACKUP-*` trzymamy minimum 7 dni jako natychmiastowy rollback.

**Wariant rezerwowy** (gdy z jakiegoś powodu nie można usunąć WP) — uruchomić wtyczkę Redirection (już zainstalowana, nieaktywna), zaimportować mapę jako CSV, i w `wp-config.php` ustawić `DISALLOW_FILE_EDIT=true`, odciąć wszystkie wtyczki oprócz Redirection. **Mniej bezpieczny**, bo PHP dalej się odpala.

### 6. DNS i SSL

Bez zmian:
- Rekord A/AAAA `old.freshmarket.eu` → IP serwera cyber-folks (obecny).
- Certyfikat Let's Encrypt → auto-renew dalej działa (cyber-folks obsługuje).
- Force HTTPS — zostaje.

### 7. Monitoring (pierwsze 90 dni)

- **Google Search Console**, property `old.freshmarket.eu`:
  - Coverage report → śledzić wzrost "Redirected" i "Excluded by 'noindex' or 410"
  - Performance → spadek impresji (oczekiwany, nie panikować)
- **Google Search Console**, property `freshmarket.eu`:
  - Coverage → nowe URL-e wchodzą do indeksu
  - Performance → wzrost impresji starych zapytań
- **Logi Apache**:
  - `grep ' 404 ' access_log | awk '{print $7}' | sort | uniq -c | sort -rn | head -50` — top missing URL-e → dopisać do mapy
- **GA4** — source analysis: czy ruch Organic Search na freshmarket.eu rośnie (zjadanie tego z old.*)

### 8. Finalny cleanup (po ~12 miesiącach)

Kiedy GSC pokazuje 0 stron zaindeksowanych pod old.freshmarket.eu:
- Usunąć katalog `public_html.BACKUP-*` (lokalna kopia dalej zostaje u nas)
- Decyzja: zostawić subdomenę z samym `.htaccess` na zawsze, czy wyłączyć
- Rekomendacja: **zostawić na zawsze** — koszt minimalny, a chroni przed regresją SEO, jeśli ktoś odświeży stary link

---

## Bezpieczeństwo i rollback

**Przed krokiem 5 wymagane:**
- Backup bazy (jest).
- Backup plików przez FTP (zadanie #31, do zrobienia przed wdrożeniem).
- Snapshot cyber-folks (jest automatyczny).

**Plan rollback (60 sekund):**
```bash
cd /home/rxdpelhpvh/domains/old.freshmarket.eu
mv public_html public_html.NEW
mv public_html.BACKUP-2026-MM-DD public_html
```

**Smoke test po wdrożeniu:**
```bash
for url in /o-targach /exhibitors /kontakt /random-slug-ktorego-nie-ma; do
  curl -I -s "https://old.freshmarket.eu$url" | head -5
  echo "---"
done
```
Oczekiwany output: `HTTP/2 301` + `location: https://freshmarket.eu/...`

---

## Dostępy

- **Panel cyber-folks:** `https://s56.cyber-folks.pl:2223/`, login `rxdpelhpvh`
- **FTP:** `s56.cyber-folks.pl`, login `rxdpelhpvh` (hasło to samo)
- **WP admin:** `https://old.freshmarket.eu/wp-admin/` — do końca wdrożenia, potem wyłączane
- **Google Search Console:** Arthur doda dostęp dla informatyka

---

## Czego **NIE** robić

- **Nie** kasować `public_html` od razu — przez tydzień trzymamy jako `.BACKUP-*`.
- **Nie** używać wildcard `RedirectMatch ^(.*)$ https://freshmarket.eu/$1` — łapie nowe URL-e, które nie istnieją na freshmarket.eu i prowadzi do pętli.
- **Nie** robić mapy URL "na oko" bez weryfikacji — każdy 301 ma iść w prawidłowy target, inaczej tracimy SEO.
- **Nie** aktualizować WP przed wdrożeniem — nie ma sensu, i tak ją kasujemy.
- **Nie** wyłączać subdomeny `old.freshmarket.eu` na poziomie DNS — redirecty muszą dalej żyć.
