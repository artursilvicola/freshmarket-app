# Fresh Market 2026 — Poranna checklista uruchomienia kampanii

**Cel:** Uruchomić kampanie Google Ads (Search PL) w ciągu ~15-20 minut.

---

## KRYTYCZNE (bez tego NIC nie ruszy) ⛔

### 1. Karta płatnicza — **5 min**

Zaloguj się do Google Ads → konto `freshmarket@freshmarket.eu` / 895-780-5133

**Kroki:**
1. Na górze panelu czerwona belka **„Wymagana nowa forma płatności — Napraw to"** → **kliknij „Napraw to"**
2. Otworzy się sekcja Płatności → Metody płatności
3. **„+ Dodaj metodę płatności"** → Karta kredytowa/debetowa
4. Wprowadź dane firmowej karty:
   - Numer karty
   - Data ważności
   - CVC
   - Nazwa na karcie
5. Dane rozliczeniowe:
   - Nazwa firmy: **KJOW Sp. z o.o.** (lub Fresh Market zgodnie z poprzednimi fakturami)
   - NIP firmowy
   - Adres: ul. Marii 17/25, 05-803 Pruszków
6. **Zapisz**

Google pobierze ~1 zł weryfikacyjnie (zwrotne).

---

## POWINIENEŚ URUCHOMIĆ (główne kampanie) 🚀

### 2. Sprawdź stan reklam i zdjęć — **3 min**

Dla każdej z 3 kampanii (Stands - Search PL, EN, Brand):
1. Kampanie → kliknij kampanię → Komponenty → Plik graficzny
2. Stan zdjęć powinien być **„Odpowiednia"** (nie „W trakcie sprawdzania")
3. Jeśli któreś wciąż w weryfikacji — i tak możesz włączyć kampanię, Google dopuści zdjęcia jak je zatwierdzi

### 3. Włącz kampanie — **1 min**

**UWAGA: Uruchamiaj pojedynczo, nie wszystkie naraz!**

**Dziś rano:**
- Kampanie → zaznacz **„Stands - Search PL"** → Przycisk „Włącz" lub edytuj status z „Wstrzymana" na „Aktywna"

**Za 3-5 dni (po przeanalizowaniu wyników PL):**
- Włącz **„Stands - Search EN"**

**Za tydzień (po stabilizacji Search):**
- Włącz **„Stands - Brand"**

---

## DODATKI (opcjonalne dziś, można jutro) ➕

### 4. Dokończ remarketing w GA4 — **5 min**

GA4 → usługa `_GA4_Fresh-market.pl` (lub inna powiązana z freshmarket.eu):

**Audience 1 — wszyscy odwiedzający:**
1. Administracja → Usługa → Odbiorcy
2. „Nowa grupa odbiorców" → „Utwórz niestandardową grupę"
3. Warunki:
   - Zdarzenie: `page_view`
   - page_location **zawiera** `fresh-market.pl`
   - **LUB** page_location **zawiera** `freshmarket.eu`
4. Okres ważności: **30 dni**
5. Zaznacz: „Uwzględnij użytkowników z ostatnich 30 dni" (jeśli opcja jest)
6. Nazwa: `FM All Visitors 30d`
7. Zapisz

**Audience 2 — wysokie zainteresowanie stoiskami:**
Powtórz krok 1-6, ale warunki:
- page_location **zawiera** `/exhibitors`
- **LUB** page_location **zawiera** `/venue`
- **LUB** page_location **zawiera** `/book-a-stand`
- Nazwa: `FM Stands Visitors 30d`

**Audience 3 — wykluczenia (konwertujący):**
- page_location **zawiera** `thank-you` LUB `confirmation`
- Nazwa: `FM Stand Converters (exclude)`
- Użyć jako wykluczenia w kampanii Remarketing

### 5. Wgraj Display Remarketing CSV — **3 min**

⚠️ **Dopiero PO utworzeniu audience w GA4 i zebraniu min. 100 użytkowników** (Google wymóg).

Google Ads → Narzędzia → Przesłane pliki:
1. Wgraj `06_Display_Remarketing_Campaign.csv`
2. Wgraj `07_Display_Remarketing_AdGroup.csv`
3. W panelu kampanii → Odbiorcy → dodaj `FM All Visitors 30d` jako targetowanie
4. Dodaj kilka Responsive Display Ads (Reklamy → +Reklama → Elastyczna reklama displayowa)
   - Użyj zdjęć z Biblioteki (te same co w Search — Kopia 0186/0179/0173/0168/0126)
   - Headlines: te same co w RSA Search (już masz je w dokumentach)
   - Descriptions: jak wyżej

---

## NIE DZIAŁA? — Najczęstsze problemy

### „Kampania nie wyświetla reklam"
→ Sprawdź: karta podpięta? Kampania status = Aktywna? Budget > 0?

### „Zdjęcia w trakcie sprawdzania (>24h)"
→ Normalne, Google czasem weryfikuje 48h. Kampania i tak ruszy z tekstowymi reklamami.

### „Niskie CTR w pierwsze 3 dni"
→ Normalne. Google uczy się targetowania. Po tygodniu powinno być stabilnie.

### „Słowa kluczowe z niskim jakością"
→ Sprawdź zgodność: słowo kluczowe ↔ tekst reklamy ↔ landing page. Wszystkie powinny zawierać spójne frazy.

---

## Monitoring — codziennie przez 2 tygodnie (5 min)

1. **Search Terms Report** (Statystyki → Wyszukiwane hasła) — zobacz za co ludzie klikają, nieoczekiwane frazy dodaj do negatywów
2. **CPC** — powinien być ~1 zł. Jeśli wyżej, obniż Max CPC
3. **CTR** — High Intent >2%, Mid Intent >1%
4. **Konwersje** (formularz rezerwacji stoiska) — docelowo kilka/tydzień

---

## Stan konta na 21.04.2026 wieczorem

| Element | Status |
|---|---|
| Konto Google Ads 895-780-5133 | ✅ aktywne |
| Link GA4 ↔ Ads | ✅ połączone 21.04 wieczorem (Zrealizowane: 1) |
| 3 kampanie Search | ✅ utworzone, Paused |
| 5 grup reklam | ✅ Max CPC 0.80-1.50 zł |
| 29 słów kluczowych | ✅ Exact + Phrase |
| 78 wykluczeń | ✅ |
| 5 reklam RSA z pinowaniem | ✅ |
| Zdjęcia kampanii (5 plików happymoon.pl) | ✅ w weryfikacji Google |
| Polskie diakrytyki w reklamach | ✅ |
| Callouts PL/EN (18 szt.) | ✅ Odpowiednia |
| Sitelinki PL/EN (15 szt.) | ✅ Odpowiednia |
| Structured Snippets PL/EN (4-6 szt.) | ✅ |
| **Karta płatnicza** | ⛔ **TO JUTRO** |
| **Audience remarketing w GA4** | ⏳ opcjonalnie jutro |
| **Kampania Display Remarketing** | ⏳ CSV gotowe, użyć po zebraniu audience |

**Masz kompletnie skonfigurowaną strukturę 3 kampanii Search. Po podpięciu karty uruchomisz pierwszą (Search PL) jednym kliknięciem.**

---

## Pliki w tym folderze

- `Plan_kampanii_Wystawcy_FM2026.docx` — pełen plan strategiczny
- `Google Ads Editor Import/v2_GoogleFormat/` — 5 plików CSV (kampanie/grupy/kw/negatywy/RSA)
- `Google Ads Editor Import/v2_GoogleFormat/06_Display_Remarketing_Campaign.csv` — remarketing kampania
- `Google Ads Editor Import/v2_GoogleFormat/07_Display_Remarketing_AdGroup.csv` — remarketing grupa reklam
- `JUTRO_Poranna_checklista_uruchomienia.md` — ten plik

## Dokumenty mailowe przygotowane

W Gmail Drafts są szkice do Macieja (do ewentualnej wysyłki):
- „Budżet Google Ads – prośba o wyjaśnienie" — chronologia sprawy z konta 349-173-0732 i pytania o konto 476-131-4135

---

**Powodzenia jutro rano! Jeśli coś się zacina, napisz i dokańczamy.**
