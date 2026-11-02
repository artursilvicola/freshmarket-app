# Korekta języka instrukcji PreConnect — uwagi Oksany (02.11.2026)

Gałąź `fix/instructions-wording-oksana` od `main` 0e4dbef. Wyłącznie treść instrukcji PreConnect (dostawca, kupiec, administrator, PL i EN)
oraz stopka strony instrukcji PreConnect. Instrukcje Spotkań B2B, archiwum 2026, działanie aplikacji, rozliczenia, uprawnienia i konfiguracja — bez zmian.
**Bez wdrożenia** do osobnej zgody Artura.

## Zasada

- PreConnect = obsługa platformy → **„administrator”** (z odmianą). Spotkania B2B = organizacja wydarzenia → **„organizator”** (bez zmian).
- Cytaty etykiet z interfejsu zachowane dosłownie, nawet gdy zawierają „organizator” (np. pula „Bezpłatne od organizatora” w Finansach) — rozbieżności interfejsu wypisane niżej, do osobnej decyzji.
- EN: „administrator” zamiast „organiser” w tych samych miejscach.

## Najważniejsze zmiany „przed → po”

| Gdzie | Przed | Po |
|---|---|---|
| Kupiec → Kategorie (intro) | Każdy kupiec ma w systemie przypisane kategorie, za które odpowiada (np. owoce, warzywa, kwiaty). Ustawia je organizator przy koncie kupca. | Każdy kupiec ma przypisane kategorie, za które odpowiada, np. owoce, warzywa lub kwiaty. Kategorie ustawia administrator w koncie kupca. |
| Kupiec → Kontakt z dostawcą | Jeśli dostawca nie podał kontaktu handlowego z e-mailem, zobaczysz komunikat o braku danych; pozostałe dane kontaktowe, jeśli są, znajdziesz w karcie **Kontakt z dostawcą**. | Brak e-maila do kontaktu handlowego? Zobaczysz komunikat o braku danych. Pozostałe dane kontaktowe, jeśli zostały podane, znajdziesz w karcie **Kontakt z dostawcą**. |
| Kupiec → Czym jest PreConnect | Dostawca wysyła propozycję do Twojej sieci, organizator ją zatwierdza. | Dostawca wysyła propozycję do Twojej sieci, administrator ją zatwierdza. |
| Kupiec → Pomoc | Pytania i błędne dane zgłaszasz organizatorowi przez czat… | Pytania i błędne dane zgłaszasz administratorowi przez czat… |
| Dostawca → Czym jest PreConnect | Organizator ją moderuje… / Mailing PreConnect do kupców jest wysyłany przez organizatora… | Administrator ją moderuje… / Mailing PreConnect do kupców wysyła administrator… |
| Dostawca → Pierwsze kroki | wysyłki odblokowuje organizator… / czat z organizatorem / jeśli organizator je przyznał | wysyłki odblokowuje administrator… / czat z administratorem / jeśli administrator je przyznał |
| Dostawca → Kredyty | najpierw kredyty **bezpłatne od organizatora**, potem **kupione**… | najpierw kredyty **bezpłatne** przyznane przez administratora (w panelu pula „Bezpłatne od organizatora”), potem **kupione**… |
| Dostawca → Kredyty (uwaga) | Bezpłatne kredyty od organizatora pojawiają się jako osobny baner nad panelem z wiadomością od organizatora i terminem ważności. | Bezpłatne kredyty przyznane przez administratora pojawiają się jako osobny baner nad panelem, z wiadomością administratora i terminem ważności. |
| Dostawca → Wysyłka / moderacja | kolejki moderacji organizatora / Organizator może odrzucić propozycję… / wiadomość organizatora na czacie | kolejki moderacji administratora / Administrator może odrzucić propozycję… / wiadomość administratora na czacie |
| Dostawca → Kontakt z kupcem | Pytania do organizatora zadajesz przez **czat**… Odpowiedzi organizatora… | Pytania do administratora zadajesz przez **czat**… Odpowiedzi administratora… |
| Dostawca → Profil firmy (opis) | …po polsku; osobne pola na wersję angielską, którą widzi kupiec używający aplikacji po angielsku. Przycisk „Generuj AI” proponuje opisy… — możesz je poprawić ręcznie. | …po polsku. Wersję angielską wpisujesz w osobnych polach — widzi ją kupiec używający aplikacji po angielsku. Przycisk „Generuj AI” proponuje opisy…; możesz je poprawić ręcznie. |
| Dostawca → Wysyłki (lista sieci) | Przy każdej sieci widzisz kraj, kategorie, za które odpowiada kupiec, datę najbliższego mailingu i liczbę Twoich propozycji już wysłanych oraz przeczytanych. | Przy każdej sieci widzisz kraj i kategorie, za które odpowiada kupiec. Jest tam też data najbliższego mailingu oraz liczba Twoich propozycji już wysłanych i przeczytanych. |
| Dostawca → Odczyty (intro) | …wejdzie na listę propozycji w swoim panelu (wtedy jako zobaczone oznaczane są wszystkie jego nowe propozycje, także bez otwierania szczegółów). Oba zdarzenia… | …wejdzie na listę propozycji w swoim panelu. Wejście na listę oznacza wszystkie jego nowe propozycje naraz, także bez otwierania szczegółów. Oba zdarzenia… |
| Dostawca → Najczęstsze sytuacje | …pobranie następuje przy otwarciu e-maila albo przy wejściu kupca na listę propozycji w aplikacji, nie przy odpowiedzi kupca ani dopiero przy otwarciu szczegółów. | …kredyt jest pobierany przy otwarciu e-maila albo przy wejściu kupca na listę propozycji w aplikacji. Nie zależy to od odpowiedzi kupca ani od otwarcia szczegółów. |
| Administrator → Pipeline | Mailing organizator wykonuje ręcznie, zwykle w pierwszy wtorek miesiąca… | Mailing wykonujesz ręcznie, zwykle w pierwszy wtorek miesiąca… |
| Administrator → Kredyty | Kolejność pul: bezpłatne od organizatora → kupione… | Kolejność pul: bezpłatne przyznane przez administratora (u dostawcy pula „Bezpłatne od organizatora”) → kupione… |
| Administrator → Branding | …są częścią aplikacji (pliki …); ich zmiana to zmiana w kodzie i wdrożenie, nie edycja w Brandingu. | …są częścią aplikacji (pliki …). Ich zmiana to zmiana w kodzie i wdrożenie, nie edycja w Brandingu. |
| Stopka strony instrukcji PreConnect (PL/EN) | Pytania? Napisz do organizatora przez czat… | Pytania? Napisz do administratora przez czat… (nowy klucz `instructions.page.footer_help_preconnect`; stopka Spotkań B2B bez zmian) |

Pozostawione celowo: „to decyzja organizatora” przy naliczaniu kredytu za otwarcie e-maila (instrukcja administratora — decyzja organizatora wydarzenia, nie czynność obsługi) oraz ramka „Do ustalenia przez organizatora” (decyzje Artura).
Pełna lista wszystkich 69 zamian (PL i EN) w załączniku poniżej.

## Rozbieżności interfejsu do osobnej decyzji (nie zmieniane w tej korekcie)

Teksty aplikacji, które nadal mówią „organizator” w kontekście obsługi platformy (klucze w `src/i18n/*/legacy.json`):
- Finanse dostawcy: `free_label` „Bezpłatne od organizatora”, `legacy_label`, `order_hint`, `reason_other`, `history_grant_label`, `history_legacy_label`, `history_prior_other_*`, `legacy_note_format` — instrukcje cytują etykietę „Bezpłatne od organizatora” dosłownie.
- Baner dostawcy o bezpłatnych kredytach: `banner_title_*` „Otrzymujesz … bezpłatnych kredytów PreConnect od organizatora”.
- Panel administratora, okno przyznawania: `grant_modal_title` „Bezpłatne kredyty PreConnect od organizatora”, `grant_intro`.
- Dawna treść pomocy (klucze `help_text`, `fm_li_4_text`) — dotyczy spotkań, zostaje.
Zmiana tych etykiet to zmiana interfejsu (i historii wyświetlanej dostawcom), poza zakresem korekty instrukcji.

## Kontrola

- Testy instrukcji 29/29 (nowy test: PreConnect mówi o administratorze, Spotkania B2B o organizatorze; treść PreConnect uczestników bez „organizator” poza cytatem etykiety), `git diff --check` czysty, build OK.
- Wydruk: patrz sekcja „PDF” poniżej.

## PDF

Wydruk zmienionych instrukcji z dev (localhost:5173, gałąź korekty) tym samym skryptem co wcześniej (`scripts/instructions-pdf.mjs`, Chrome CDP), sesje kont testowych przez magic link:
- PreConnect dostawcy PL i EN (9 stron każdy), PreConnect kupca PL i EN (4 strony każdy) — liczby stron bez zmian względem kompletu z 30.10; kontrola skryptem: brak ucięć, bez menu panelu, 0 wystąpień „organizator/organiser” poza cytatem etykiety „Bezpłatne od organizatora”, 18 (dostawca) i 6 (kupiec) wystąpień „administrator”, nowy opis kontaktu u kupca obecny; arkusze miniatur obejrzane.
- Pliki: `C:\Users\Artur\AppData\Local\Temp\pdf-oksana\`.
- **Nie wydrukowano** wersji administratora (PreConnect — instrukcja administratora, PL/EN): wymaga sesji administratora na localhost, której nie ma po zamknięciu przeglądarki; treść admina pokrywa test 29/29 i render. Do zrobienia po Twoim zalogowaniu na dev albo po wdrożeniu z produkcji.

## Załącznik — pełna lista zamian

### src/content/instructions/preconnect-supplier.js
- przed: Wysyłasz propozycję do wybranej sieci. Organizator ją moderuje, a po zatwierdzeniu trafia do panelu kupca i do najbliższego mailingu PreConnect.
- po: Wysyłasz propozycję do wybranej sieci. Administrator ją moderuje, a po zatwierdzeniu trafia do panelu kupca i do najbliższego mailingu PreConnect.

### src/content/instructions/preconnect-supplier.js
- przed: Mailing PreConnect do kupców jest wysyłany przez organizatora w pierwszy wtorek miesiąca. Dokładną datę
- po: Mailing PreConnect do kupców wysyła administrator w pierwszy wtorek miesiąca. Dokładną datę

### src/content/instructions/preconnect-supplier.js
- przed: wysyłki odblokowuje organizator po aktywacji konta.
- po: wysyłki odblokowuje administrator po aktywacji konta.

### src/content/instructions/preconnect-supplier.js
- przed: „Napisz do admina” w pasku nad panelem — wiadomość trafi na czat z organizatorem.
- po: „Napisz do admina” w pasku nad panelem — wiadomość trafi na czat z administratorem.

### src/content/instructions/preconnect-supplier.js
- przed: wykorzystaj kredyty bezpłatne, jeśli organizator je przyznał (rozdział 7).
- po: wykorzystaj kredyty bezpłatne, jeśli administrator je przyznał (rozdział 7).

### src/content/instructions/preconnect-supplier.js
- przed: **Opis firmy**: krótki (2–3 zdania) i standardowy (4–6 zdań), po polsku; osobne pola na wersję angielską, którą widzi kupiec używający aplikacji po angielsku. Przycisk „Generuj AI” proponuje opisy na podstawie Twoich danych i strony WWW — możesz je poprawić ręcznie.
- po: **Opis firmy**: krótki (2–3 zdania) i standardowy (4–6 zdań), po polsku. Wersję angielską wpisujesz w osobnych polach — widzi ją kupiec używający aplikacji po angielsku. Przycisk „Generuj AI” proponuje opisy na podstawie Twoich danych i strony WWW; możesz je poprawić ręcznie.

### src/content/instructions/preconnect-supplier.js
- przed: Nie wpisuj angielskiego tekstu w pola polskie — kupiec z polskim interfejsem widzi pola polskie, kupiec z angielskim — angielskie (a gdy są puste, polskie).
- po: Nie wpisuj angielskiego tekstu w pola polskie. Kupiec z polskim interfejsem widzi pola polskie, a kupiec z angielskim — angielskie (gdy są puste, polskie).

### src/content/instructions/preconnect-supplier.js
- przed: Adres e-mail konta i dane firmy przypisane do konta zmienia organizator — napisz na czacie, jeśli trzeba je poprawić.
- po: Adres e-mail konta i dane firmy przypisane do konta zmienia administrator — napisz na czacie, jeśli trzeba je poprawić.

### src/content/instructions/preconnect-supplier.js
- przed: Po wysyłce propozycja jest w pipeline organizatora i nie można jej usunąć.
- po: Po wysyłce propozycja jest w pipeline administratora i nie można jej usunąć.

### src/content/instructions/preconnect-supplier.js
- przed: Otwórz **Wysyłki → Sieci handlowe**. Przy każdej sieci widzisz kraj, kategorie, za które odpowiada kupiec, datę najbliższego mailingu i liczbę Twoich propozycji już wysłanych oraz przeczytanych.
- po: Otwórz **Wysyłki → Sieci handlowe**. Przy każdej sieci widzisz kraj i kategorie, za które odpowiada kupiec. Jest tam też data najbliższego mailingu oraz liczba Twoich propozycji już wysłanych i przeczytanych.

### src/content/instructions/preconnect-supplier.js
- przed: Propozycja trafia do **kolejki moderacji** organizatora (zakładka Historia → Kolejka).
- po: Propozycja trafia do **kolejki moderacji** administratora (zakładka Historia → Kolejka).

### src/content/instructions/preconnect-supplier.js
- przed: Organizator może odrzucić propozycję w moderacji — dostaniesz wiadomość na czacie z powodem.
- po: Administrator może odrzucić propozycję w moderacji — dostaniesz wiadomość na czacie z powodem.

### src/content/instructions/preconnect-supplier.js
- przed: caption: "Finanse → Saldo i pakiet: kredyty bezpłatne od organizatora i kupione, zwolnione rezerwacje, open rate."
- po: caption: "Finanse → Saldo i pakiet: kredyty bezpłatne przyznane przez administratora i kupione, zwolnione rezerwacje, open rate."

### src/content/instructions/preconnect-supplier.js
- przed: Kolejność pobierania: najpierw kredyty **bezpłatne od organizatora**, potem **kupione** (według najbliższego terminu ważności), na końcu pakiety historyczne.
- po: Kolejność pobierania: najpierw kredyty **bezpłatne** przyznane przez administratora (w panelu pula „Bezpłatne od organizatora”), potem **kupione** (według najbliższego terminu ważności), na końcu pakiety historyczne.

### src/content/instructions/preconnect-supplier.js
- przed: Pakiet z proformy aktywuje organizator po zaksięgowaniu wpłaty.
- po: Pakiet z proformy aktywuje administrator po zaksięgowaniu wpłaty.

### src/content/instructions/preconnect-supplier.js
- przed: Bezpłatne kredyty od organizatora pojawiają się jako osobny baner nad panelem z wiadomością od organizatora i terminem ważności.
- po: Bezpłatne kredyty przyznane przez administratora pojawiają się jako osobny baner nad panelem, z wiadomością administratora i terminem ważności.

### src/content/instructions/preconnect-supplier.js
- przed: intro: "Propozycja jest „zobaczona”, gdy kupiec otworzy e-mail z mailingu albo wejdzie na listę propozycji w swoim panelu (wtedy jako zobaczone oznaczane są wszystkie jego nowe propozycje, także bez otwierania szczegółów). Oba zdarzenia liczą się tak samo: pobierany jest 1 kredyt."
- po: intro: "Propozycja jest „zobaczona”, gdy kupiec otworzy e-mail z mailingu albo wejdzie na listę propozycji w swoim panelu. Wejście na listę oznacza wszystkie jego nowe propozycje naraz, także bez otwierania szczegółów. Oba zdarzenia liczą się tak samo: pobierany jest 1 kredyt."

### src/content/instructions/preconnect-supplier.js
- przed: Pytania do organizatora zadajesz przez **czat** w prawym dolnym rogu panelu. Odpowiedzi organizatora widzisz w tym samym oknie.
- po: Pytania do administratora zadajesz przez **czat** w prawym dolnym rogu panelu. Odpowiedzi administratora widzisz w tym samym oknie.

### src/content/instructions/preconnect-supplier.js
- przed: **Profil się nie zapisuje** — sprawdź komunikat pod przyciskiem: zwykle brakuje NIP albo logo; zapis działa, ale profil jest oznaczony jako niekompletny. Przy błędzie połączenia odśwież stronę i spróbuj ponownie.
- po: **Profil się nie zapisuje** — sprawdź komunikat pod przyciskiem. Zwykle brakuje NIP albo logo; zapis działa, ale profil jest oznaczony jako niekompletny. Przy błędzie połączenia odśwież stronę i spróbuj ponownie.

### src/content/instructions/preconnect-supplier.js
- przed: **Propozycja odrzucona w moderacji** — przeczytaj wiadomość organizatora na czacie,
- po: **Propozycja odrzucona w moderacji** — przeczytaj wiadomość administratora na czacie,

### src/content/instructions/preconnect-supplier.js
- przed: wysyłki i Spotkania B2B są zablokowane do wyjaśnienia; skontaktuj się z organizatorem.
- po: wysyłki i Spotkania B2B są zablokowane do wyjaśnienia; skontaktuj się z administratorem.

### src/content/instructions/preconnect-supplier.js
- przed: **Kredyt pobrany, choć kupiec „nic nie odpowiedział”** — pobranie następuje przy otwarciu e-maila albo przy wejściu kupca na listę propozycji w aplikacji, nie przy odpowiedzi kupca ani dopiero przy otwarciu szczegółów. Odpowiedź zależy od kupca.
- po: **Kredyt pobrany, choć kupiec „nic nie odpowiedział”** — kredyt jest pobierany przy otwarciu e-maila albo przy wejściu kupca na listę propozycji w aplikacji. Nie zależy to od odpowiedzi kupca ani od otwarcia szczegółów. Odpowiedź zależy od kupca.

### src/content/instructions/preconnect-supplier.js
- przed: You send a proposal to a chosen chain. The organiser moderates it; once approved
- po: You send a proposal to a chosen chain. The administrator moderates it; once approved

### src/content/instructions/preconnect-supplier.js
- przed: The organiser sends the PreConnect mailing to buyers on the first Tuesday of the month.
- po: The administrator sends the PreConnect mailing to buyers on the first Tuesday of the month.

### src/content/instructions/preconnect-supplier.js
- przed: sending is unlocked by the organiser once the account is activated.
- po: sending is unlocked by the administrator once the account is activated.

### src/content/instructions/preconnect-supplier.js
- przed: use “Write to admin” in the bar above the panel — the message goes to the chat with the organiser.
- po: use “Write to admin” in the bar above the panel — the message goes to the chat with the administrator.

### src/content/instructions/preconnect-supplier.js
- przed: or use free credits if the organiser granted them (chapter 7).
- po: or use free credits if the administrator granted them (chapter 7).

### src/content/instructions/preconnect-supplier.js
- przed: **Company description**: short (2–3 sentences) and standard (4–6 sentences) in Polish; separate fields for the English version, which a buyer using the app in English sees. “Generate AI” proposes descriptions from your data and website — you can edit them by hand.
- po: **Company description**: short (2–3 sentences) and standard (4–6 sentences) in Polish. The English version goes into separate fields — a buyer using the app in English sees it. “Generate AI” proposes descriptions from your data and website; you can edit them by hand.

### src/content/instructions/preconnect-supplier.js
- przed: Do not type English text into the Polish fields — a buyer with the Polish interface sees the Polish fields, a buyer with English sees the English ones (and the Polish ones when English is empty).
- po: Do not type English text into the Polish fields. A buyer with the Polish interface sees the Polish fields, and a buyer with English sees the English ones (the Polish ones when English is empty).

### src/content/instructions/preconnect-supplier.js
- przed: The account e-mail and the company assigned to the account are changed by the organiser — write on the chat if they need correcting.
- po: The account e-mail and the company assigned to the account are changed by the administrator — write on the chat if they need correcting.

### src/content/instructions/preconnect-supplier.js
- przed: Once sent, the proposal is in the organiser's pipeline and cannot be deleted.
- po: Once sent, the proposal is in the administrator's pipeline and cannot be deleted.

### src/content/instructions/preconnect-supplier.js
- przed: Open **Sendings → Retail chains**. Each chain shows the country, the categories its buyer is responsible for, the date of the next mailing and how many of your proposals were already sent and read.
- po: Open **Sendings → Retail chains**. Each chain shows the country and the categories its buyer is responsible for. You also see the date of the next mailing and how many of your proposals were already sent and read.

### src/content/instructions/preconnect-supplier.js
- przed: The proposal goes to the organiser's **moderation queue** (History → Queue).
- po: The proposal goes to the administrator's **moderation queue** (History → Queue).

### src/content/instructions/preconnect-supplier.js
- przed: The organiser may reject a proposal in moderation — you get a chat message with the reason.
- po: The administrator may reject a proposal in moderation — you get a chat message with the reason.

### src/content/instructions/preconnect-supplier.js
- przed: caption: "Finance → Balance and package: free credits from the organiser and purchased ones, released reservations, open rate."
- po: caption: "Finance → Balance and package: free credits granted by the administrator and purchased ones, released reservations, open rate."

### src/content/instructions/preconnect-supplier.js
- przed: Charging order: first **free credits from the organiser**, then **purchased** ones (nearest expiry first), finally historical packages.
- po: Charging order: first **free credits** granted by the administrator (the “Free from the organiser” pool in the panel), then **purchased** ones (nearest expiry first), finally historical packages.

### src/content/instructions/preconnect-supplier.js
- przed: The organiser activates the package once the payment is booked.
- po: The administrator activates the package once the payment is booked.

### src/content/instructions/preconnect-supplier.js
- przed: Free credits from the organiser appear as a separate banner above the panel with the organiser's message and expiry date.
- po: Free credits granted by the administrator appear as a separate banner above the panel, with the administrator's message and expiry date.

### src/content/instructions/preconnect-supplier.js
- przed: intro: "A proposal is “seen” when the buyer opens the mailing e-mail or enters the proposal list in their panel (all their new proposals are then marked as seen, even without opening the details). Both count the same way: 1 credit is charged."
- po: intro: "A proposal is “seen” when the buyer opens the mailing e-mail or enters the proposal list in their panel. Entering the list marks all their new proposals at once, even without opening the details. Both count the same way: 1 credit is charged."

### src/content/instructions/preconnect-supplier.js
- przed: Questions to the organiser go through the **chat** in the bottom-right corner of the panel. The organiser's replies appear in the same window.
- po: Questions to the administrator go through the **chat** in the bottom-right corner of the panel. The administrator's replies appear in the same window.

### src/content/instructions/preconnect-supplier.js
- przed: **The profile does not save** — check the message under the button: usually the VAT number or logo is missing; saving works but the profile is marked incomplete. On a connection error refresh the page and try again.
- po: **The profile does not save** — check the message under the button. Usually the VAT number or logo is missing; saving works but the profile is marked incomplete. On a connection error refresh the page and try again.

### src/content/instructions/preconnect-supplier.js
- przed: **Proposal rejected in moderation** — read the organiser's chat message,
- po: **Proposal rejected in moderation** — read the administrator's chat message,

### src/content/instructions/preconnect-supplier.js
- przed: sendings and B2B Meetings are blocked until clarified; contact the organiser.
- po: sendings and B2B Meetings are blocked until clarified; contact the administrator.

### src/content/instructions/preconnect-supplier.js
- przed: **A credit was charged although the buyer “did not reply”** — charging happens when the e-mail is opened or when the buyer enters the proposal list in the app, not when the buyer replies and not only when the details are opened. Replying is up to the buyer.
- po: **A credit was charged although the buyer “did not reply”** — the credit is charged when the e-mail is opened or when the buyer enters the proposal list in the app. It does not depend on the buyer's reply or on opening the details. Replying is up to the buyer.

### src/content/instructions/preconnect-buyer.js
- przed: Propozycje są wcześniej sprawdzane przez organizatora.
- po: Propozycje są wcześniej sprawdzane przez administratora.

### src/content/instructions/preconnect-buyer.js
- przed: Dostawca wysyła propozycję do Twojej sieci, organizator ją zatwierdza.
- po: Dostawca wysyła propozycję do Twojej sieci, administrator ją zatwierdza.

### src/content/instructions/preconnect-buyer.js
- przed: intro: "Każdy kupiec ma w systemie przypisane kategorie, za które odpowiada (np. owoce, warzywa, kwiaty). Ustawia je organizator przy koncie kupca."
- po: intro: "Każdy kupiec ma przypisane kategorie, za które odpowiada, np. owoce, warzywa lub kwiaty. Kategorie ustawia administrator w koncie kupca."

### src/content/instructions/preconnect-buyer.js
- przed: napisz do organizatora (czat lub kontakt w panelu).
- po: napisz do administratora (czat lub kontakt w panelu).

### src/content/instructions/preconnect-buyer.js
- przed: **Otwarcie e-maila z mailingu albo wejście na listę propozycji w aplikacji (Propozycje asortymentowe lub Zapisane) oznacza propozycje jako odczytane** — wszystkie nowe propozycje na liście naraz, bez otwierania szczegółów. Dostawca widzi w swoim panelu tylko ten fakt — bez Twoich danych.
- po: **Otwarcie e-maila z mailingu albo wejście na listę propozycji w aplikacji (Propozycje asortymentowe lub Zapisane) oznacza propozycje jako odczytane.** Dotyczy to wszystkich nowych propozycji na liście naraz, bez otwierania szczegółów. Dostawca widzi w swoim panelu tylko ten fakt — bez Twoich danych.

### src/content/instructions/preconnect-buyer.js
- przed: Jeśli dostawca nie podał kontaktu handlowego z e-mailem, zobaczysz komunikat o braku danych; pozostałe dane kontaktowe, jeśli są, znajdziesz w karcie **Kontakt z dostawcą**.
- po: Brak e-maila do kontaktu handlowego? Zobaczysz komunikat o braku danych. Pozostałe dane kontaktowe, jeśli zostały podane, znajdziesz w karcie **Kontakt z dostawcą**.

### src/content/instructions/preconnect-buyer.js
- przed: Sieć handlowa i adres e-mail są przypisane przez organizatora.
- po: Sieć handlowa i adres e-mail są przypisane przez administratora.

### src/content/instructions/preconnect-buyer.js
- przed: Pytania i błędne dane zgłaszasz organizatorowi przez czat
- po: Pytania i błędne dane zgłaszasz administratorowi przez czat

### src/content/instructions/preconnect-buyer.js
- przed: Proposals are checked by the organiser first.
- po: Proposals are checked by the administrator first.

### src/content/instructions/preconnect-buyer.js
- przed: A supplier sends a proposal to your chain; the organiser approves it.
- po: A supplier sends a proposal to your chain; the administrator approves it.

### src/content/instructions/preconnect-buyer.js
- przed: intro: "Every buyer has categories assigned in the system (e.g. fruit, vegetables, flowers). The organiser sets them on the buyer account."
- po: intro: "Every buyer has assigned categories they are responsible for, e.g. fruit, vegetables or flowers. The administrator sets the categories on the buyer account."

### src/content/instructions/preconnect-buyer.js
- przed: write to the organiser (chat or the contact details in the panel).
- po: write to the administrator (chat or the contact details in the panel).

### src/content/instructions/preconnect-buyer.js
- przed: **Opening the mailing e-mail or entering the proposal list in the app (Proposals or Saved) marks proposals as read** — all new proposals on the list at once, without opening the details. The supplier sees only that fact in their panel — none of your data.
- po: **Opening the mailing e-mail or entering the proposal list in the app (Proposals or Saved) marks proposals as read.** This applies to all new proposals on the list at once, without opening the details. The supplier sees only that fact in their panel — none of your data.

### src/content/instructions/preconnect-buyer.js
- przed: If the supplier has not provided a sales contact with an e-mail, you see a “no contact data” message; other contact details, if any, are in the **Contact with supplier** card.
- po: No e-mail for the sales contact? You see a “no contact data” message. Other contact details, if provided, are in the **Contact with supplier** card.

### src/content/instructions/preconnect-buyer.js
- przed: The retail chain and e-mail address are assigned by the organiser.
- po: The retail chain and e-mail address are assigned by the administrator.

### src/content/instructions/preconnect-buyer.js
- przed: Report questions and incorrect data to the organiser via the chat
- po: Report questions and incorrect data to the administrator via the chat

### src/content/instructions/preconnect-admin.js
- przed: Mailing organizator wykonuje ręcznie, zwykle w pierwszy wtorek miesiąca (pasek u góry pokazuje najbliższą datę). System nie wysyła automatycznie.
- po: Mailing wykonujesz ręcznie, zwykle w pierwszy wtorek miesiąca (pasek u góry pokazuje najbliższą datę). System nie wysyła automatycznie.

### src/content/instructions/preconnect-admin.js
- przed: Kolejność pul: bezpłatne od organizatora → kupione (najbliższy termin ważności) → historyczne.
- po: Kolejność pul: bezpłatne przyznane przez administratora (u dostawcy pula „Bezpłatne od organizatora”) → kupione (najbliższy termin ważności) → historyczne.

### src/content/instructions/preconnect-admin.js
- przed: Bieżące instrukcje — PreConnect i Spotkania B2B dla dostawcy, kupca i administratora — są częścią aplikacji (pliki `src/content/instructions`); ich zmiana to zmiana w kodzie i wdrożenie, nie edycja w Brandingu.
- po: Bieżące instrukcje PreConnect i Spotkań B2B dla dostawcy, kupca i administratora są częścią aplikacji (pliki `src/content/instructions`). Ich zmiana to zmiana w kodzie i wdrożenie, nie edycja w Brandingu.

### src/content/instructions/preconnect-admin.js
- przed: The mailing is done manually by the organiser, usually on the first Tuesday of the month (the bar at the top shows the next date). The system does not send automatically.
- po: You run the mailing manually, usually on the first Tuesday of the month (the bar at the top shows the next date). The system does not send automatically.

### src/content/instructions/preconnect-admin.js
- przed: Pool order: free from the organiser → purchased (nearest expiry) → historical.
- po: Pool order: free credits granted by the administrator (shown to the supplier as “Free from the organiser”) → purchased (nearest expiry) → historical.

### src/content/instructions/preconnect-admin.js
- przed: The current guides — PreConnect and B2B Meetings for supplier, buyer and administrator — are part of the app (files `src/content/instructions`); changing them is a code change and deployment, not an edit in Branding.
- po: The current PreConnect and B2B Meetings guides for supplier, buyer and administrator are part of the app (files `src/content/instructions`). Changing them is a code change and deployment, not an edit in Branding.

### src/i18n/pl/legacy.json
- przed: (brak klucza)
- po: footer_help_preconnect = Pytania? Napisz do administratora przez czat w prawym dolnym rogu panelu.

### src/i18n/en/legacy.json
- przed: (brak klucza)
- po: footer_help_preconnect = Questions? Write to the administrator via the chat in the bottom-right corner of the panel.

### src/components/instructions/InstructionPage.jsx
- przed:         <p>{t(p + "footer_help")}</p>
- po:         {/* PreConnect = obsługa platformy → „administrator”; Spotkania B2B = organizator wydarzenia (uwagi Oksany, 02.11.2026) */}
        <p>{t(p + (doc === "preconnect" ? "footer_help_preconnect" : "footer_help"))}</p>
