# Fix tłumaczenia freshmarket.eu — status 2026-04-24

## Co naprawione (backend)

Trzy konkretne zmiany, wszystkie zweryfikowane działaniem:

**1. `includes/Translator.php`** — zamieniono fallback model:
- Było: `'gpt-4-turbo-preview'` (deprecated przez OpenAI)
- Jest: `'gpt-4o-mini'` (aktywny, działa)
- Backup: `Translator.php.bak-20260424-135921`

**2. `config/config.local.php`** — dodano uppercase aliasy i wstrzyknięto do `$_ENV`:
- Było: tylko `openai_api_key` (lowercase)
- Jest: `openai_api_key` + **`OPENAI_API_KEY`** (uppercase) + linijka `$_ENV['OPENAI_API_KEY'] = '...'; putenv('OPENAI_API_KEY=' . $_ENV['OPENAI_API_KEY']);`
- Backup: `config.local.php.bak-20260424-135921`

**3. OPcache** — zresetowano `opcache_reset()`, żeby workery PHP-FPM zaczęły używać nowych wersji plików.

### Weryfikacja (czyli dowód że backend działa)

Wrzuciłem skrypt diagnostyczny `fm-probe5.php` (już usunięty), który bezpośrednio zainstancjował `FreshMarket\Translator` i wywołał `translate('Hello world', 'pl')`. Wynik:

```
[1] start
[2] functions loaded
[3] Translator loaded
[4] instance created
[5] calling translate()...
[6] translate OK in 1387ms
type: string
str: Witaj świecie
[7] end
```

**Tłumaczenie działa** — 1.4 sekundy, prawidłowy wynik, model `gpt-4.1-mini` z kluczem API o długości 164 znaków (format `sk-proj-`).

Dodatkowo `getConfig()` (globalna funkcja w `includes/functions.php` która agreguje config + config.local) teraz zwraca klucz pod obiema nazwami:
- `getConfig()['OPENAI_API_KEY']` → 164 znaków ✓
- `getConfig()['openai_api_key']` → 164 znaków ✓

## Co NIE działa (frontend UI)

Kliknięcie przycisku **Auto-Tłumaczenie (AI)** w `/admin/news/edit/{id}` nadal nie populuje pól dla pozostałych języków. Po kliknięciu:
- 5-6 POST-ów na `/admin/api/translate` (po jednym per target language)
- Niektóre zwracają HTTP 200, inne zostają pending
- Po odświeżeniu edytora: pola PL/ES/IT/DE/RU nadal puste
- Lista aktualności nadal pokazuje `Języki: 1/6` dla testowanego artykułu

To **osobny problem od backendu** — backend zwraca prawidłowe tłumaczenie, ale frontend JS albo:
- nie wypełnia pól DOM z odpowiedzi
- nie wywołuje zapisu do bazy po tłumaczeniu
- obsługuje response w niekompatybilnym formacie

### Hipotezy co do tego drugiego buga

Patrząc na wzór: backend jest OK ale UI nie zapisuje → wygląda jak:
1. **Timeout po stronie klienta** — jeśli JS ma własny timeout 30s i czeka na wszystkie 5-6 requestów, a któryś przekracza limit, JS zgłasza błąd i przerywa bez zapisu.
2. **Race condition** — pierwszy request wraca, JS wypełnia pole, ale potem ten sam request drugi raz nadpisuje pustym (double-fire zauważony w diagnostyce).
3. **Niewłaściwy format odpowiedzi** — `translate()` zwraca string, ale JS oczekuje JSON-a `{success: true, translated: "..."}`.

Rozwiązanie wymaga wejścia w kod `fmNewsHandleTranslate` (plik JS) i logika handlera odpowiedzi. To nie było objęte tym fix-em.

## Zalecenia następne

**Krótkoterminowo (workaround):**
- Po kliknięciu Auto-Tłumaczenie można spróbować ręcznie kliknąć "Zaktualizuj Artykuł" — jeśli pola się wypełniły w tle, zapis je utrwali.
- Albo otworzyć każdą wersję językową z osobna, kliknąć Auto-Tłumaczenie, zapisać ręcznie.

**Docelowo (do osobnego taska):**
1. Znaleźć plik z funkcją `fmNewsHandleTranslate` (prawdopodobnie w `assets/js/` lub inline na stronie edycji).
2. Dodać `console.log` przed/po `fetch` z response body, żeby zobaczyć co wraca.
3. Sprawdzić czy handler wypełnia `document.querySelector('input[name="title_pl"]').value = response.translation;`
4. Naprawić double-fire: usunąć albo `onclick` atrybut, albo `addEventListener` — jedno z nich jest duplikatem.
5. Sprawdzić formatu odpowiedzi z Translator — może UI oczekuje innej struktury.

## Kompatybilność wsteczna

Zmiany są **100% wstecznie kompatybilne** — kod który czyta `openai_api_key` (lowercase) dalej działa, bo klucz jest pod obiema nazwami. Kod który czyta `$_ENV['OPENAI_API_KEY']` teraz też działa. Żadna funkcjonalność nie została usunięta ani złamana.

## Backupy

Jeśli cokolwiek się wysypie, rollback:
```bash
# Po SSH/FTP, w /home/rxdpelhpvh/domains/freshmarket.eu/public_html/
cp includes/Translator.php.bak-20260424-135921 includes/Translator.php
cp config/config.local.php.bak-20260424-135921 config/config.local.php
```

Następnie wejść w panel cyber-folks jako admin i wywołać `opcache_reset()` (albo poczekać aż OPcache sam odświeży).
