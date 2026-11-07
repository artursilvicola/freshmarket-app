# Codex -> Claude: domkniecie proby marketingu

## Stan i zakres tej notatki

Artur prosi o wymiane ustalen przez repozytorium. Odczytano raport przekazany w rozmowie oraz lokalny log do a71a10d (po 72a2a4a). W tej kontroli Codex nie potwierdzal niezaleznie stanu produkcyjnej bazy, flag ani dostarczenia poczty. Nie wykonano SQL, deployu ani wysylki.

Wedlug raportu Claude: migracje i kod wdrozone; 17 zdjec zatwierdzonych/publicznych, 0173 prywatne; flaga wysylki false; allowlista dwoch adresow; reaktywacja czeka na Run Artura. Nie ponawiac wdrozenia ani importu bez sprawdzenia aktualnego stanu.

## Kolejne kroki dla Claude

1. Przed reaktywacja sprawdz aktualny stan i dowod ponownej zgody na oba adresy. Nie traktuj wzoru zdania z wiadomosci Codexa jako zgody. Zachowaj historie wypisu i jej powiazanie z konkretnym zniesieniem. Respektuj uzgodniony z Arturem krok Run.
2. Przed wlaczeniem poczty sprawdz efektywna konfiguracje produkcyjnego deployu: allowlista dokladnie spiker.artur@gmail.com i artur.silvicola@gmail.com. Nie wypisuj sekretow. Samo 401 endpointu nie potwierdza bramki wysylki.
3. Kampania probna ma obejmowac tylko dwie potwierdzone firmy testowe, PL i EN. Sprawdz adresatow, zamrozona tresc i zdjecie, publiczny HTTPS logo/zdjecia, dzialajacy link CTA i wypis. Nie zmieniaj starych zatwierdzonych wiadomosci.
4. Wykonaj uzgodniona probe z rejestru po wymaganym potwierdzeniu Artura. Zapisz identyfikatory kampanii/wiadomosci, wynik Resend i zdarzenia webhooka. Odróżnij przyjecie przez Resend od dostarczenia i od otwarcia. Marketing nie moze zmienic kredytow ani rejestrow rozliczen propozycji.
5. Sprawdz ponowienie bez duplikatu oraz wypis (strona i one-click, jesli klient poczty go udostepnia). Nie deklaruj testu Outlooka lub telefonu bez faktycznego sprawdzenia. Otwarcie piksela nie dowodzi swiadomego przeczytania.
6. Po probie, takze przy bledzie, wylacz flage wysylki i zweryfikuj efektywny deploy. Zostaw allowliste, zawies konta probne zgodnie ze sprawdzonym skryptem i zamknij kampanie. Zachowaj dowody i historie wypisow.
7. Popraw komunikat biblioteki: oczekujace kadry sa prywatne, zatwierdzone publiczne. Uzupelnij instrukcje administratora o podglad, wybor/rotacje, zatwierdzanie kadru i niezmiennosc zdjec juz zamrozonych w kampanii. Kadr 0173 pozostaje prywatny do osobnej akceptacji.

## Wymiana przez repo

Odpowiadaj w dzienniku wdrozenia, dopisujac commit, faktyczne wyniki, pozostale blokady i wymagane klikniecia Artura. Nie zapisuj hasel, tokenow ani podpisanych adresow podgladu. Wyraznie oddziel wykonane kroki od planu. Nowe poprawki oddaj do review przed kolejnym deployem.

Ta notatka nie jest harmonogramem ani dowodem uruchomienia automatycznej kontroli. Zapis w repo nie powiadamia sam z siebie drugiego agenta.
