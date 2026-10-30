// [feat/instructions-split] Instrukcja Spotkań B2B — dostawca (PL/EN).
// Źródła: moduł Spotkań w panelu dostawcy (ekran blokady, Wybór sieci, Algorytm,
// Twoje spotkania, Moja kolejka w dniu wydarzenia) i jego teksty. Terminy edycji
// {{year}} ustala organizator — instrukcja ich nie podaje; w module widać daty
// wpisane przez organizatora. Zasady (pakiety, wybór sieci, odpowiedzi kupców, pierwszeństwo,
// przydział, plan) = zasady z 2026 przyjęte jako podstawa edycji {{year}} (decyzja Artura 30.10.2026);
// dane konkretnej edycji (terminy, sieci, osoby) tylko gdy ustalone. Edycja 2026 = osobne archiwum.
export default {
  pl: {
    eyebrow: "Spotkania B2B Fresh Market {{year}} · instrukcja dla dostawcy",
    title: "Spotkania B2B {{year}} dla dostawcy",
    summary: "Pakiety spotkań, wybór sieci handlowych, co dzieje się po zamknięciu wyborów, plan z numerami spotkań i udział w dniu wydarzenia.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "czym-sa",
        title: "Czym są Spotkania B2B",
        intro: "Spotkania B2B to umawiane rozmowy 1:1 z kupcami sieci handlowych podczas wydarzenia Fresh Market. Panel B2B służy do wyboru sieci, zebrania odpowiedzi kupców, ułożenia planu przez organizatora i obsługi kolejki spotkań w dniu wydarzenia.",
        steps: [
          "Spotkania są umawiane dla firm z pakietem spotkań (Business lub Premium). Pakiet i jego poziom przypisuje organizator w Twojej firmie.",
          "Ty wskazujesz sieci, z którymi chcesz się spotkać. Kupcy odpowiadają na zgłoszenia. Organizator układa plan.",
          "Po publikacji planu widzisz listę sieci z **numerami spotkań**. W dniu wydarzenia numer oznacza kolejność wywołania do rozmowy.",
          "Terminy edycji {{year}} — otwarcie wyboru sieci, zamknięcie wyborów, publikacja planu, data i miejsce wydarzenia: informacja zostanie podana przez organizatora.",
        ],
        notes: [
          "Wybór sieci jest zgłoszeniem, nie gwarancją spotkania. Akceptacja kupca daje pierwszeństwo. „Daj szansę” oraz brak odpowiedzi pozwalają na przydział w miarę dostępnych miejsc; odmowa wyklucza automatyczny przydział.",
        ],
      },
      {
        id: "dostep",
        title: "Dostęp do modułu",
        intro: "Zakładka Spotkań jest w sekcji Fresh Market w menu. Pozycja „Instrukcja spotkań B2B” działa zawsze; same spotkania odblokowują się, gdy spełnione są dwa warunki.",
        steps: [
          "Organizator **otworzył fazę wyborów** dla wszystkich uczestników. Dopóki jest zamknięta, pozycja w menu ma kłódkę, a po wejściu widzisz ekran z planowaną datą otwarcia.",
          "Organizator **włączył Spotkania B2B dla Twojej firmy** (po opłaceniu udziału). Bez tego pozycja ma kłódkę z opisem „aktywowane indywidualnie przez administratora”.",
          "Najedź na zablokowaną pozycję — podpowiedź mówi, którego warunku brakuje. W razie wątpliwości napisz do organizatora przez czat.",
        ],
      },
      {
        id: "pakiety",
        title: "Pakiety spotkań",
        steps: [
          "Każdy wykupiony pakiet Business daje pulę **5 sieci głównych** (⭐). Firma z dwoma pakietami może wskazać 10 głównych sieci, z trzema — 15. Minimum to 5 niezależnie od liczby pakietów.",
          "Sieci **rezerwowe** (👍) wskazujesz bez limitu. Rezerwowe wchodzą do planu, gdy jest na nie miejsce po sieciach głównych.",
          "Poziom pakietu (Business / Premium) i liczbę pakietów widzisz w podsumowaniu na górze modułu. Zmiany pakietu robi organizator.",
          "**Data opłaty** udziału jest używana przez organizatora jako pierwszeństwo przy układaniu kolejności spotkań. Przy remisie pierwszeństwo ma pakiet Premium.",
        ],
      },
      {
        id: "wybor-sieci",
        title: "Wybór sieci (zakładka Wybór sieci)",
        intro: "Na liście są sieci, które potwierdziły udział w wydarzeniu. Przy sieci mogą być informacje organizacyjne od organizatora (np. tryb online, godziny dostępności).",
        steps: [
          "Kliknij sieć raz → **⭐ GŁÓWNA**. Kliknij drugi raz → **👍 REZERWOWA**. Kliknij trzeci raz → usunięcie wyboru.",
          "Pasek statystyk pokazuje: wybrane główne (np. 3/5), rezerwowe i status: „Wybierz 5 sieci” → „Minimum ✓” → „Gotowe ✓”.",
          "Zaznaczenia zapisują się na bieżąco. Gdy osiągniesz minimum, kliknij **Potwierdź wybór** — dopiero to oznacza dla organizatora, że Twój wybór jest finalny.",
          "Po każdej późniejszej zmianie kliknij **Potwierdź ponownie**, żeby organizator widział aktualną decyzję. Data ostatniego potwierdzenia jest wyświetlana nad listą.",
          "Jeśli zobaczysz oznaczenie **„Wybrane przez administratora”**, organizator ustawił ten wybór w Twoim imieniu (np. po rozmowie). Możesz go zmienić — oznaczenie wtedy zniknie.",
          "Wybory można zmieniać do zamknięcia fazy przez organizatora. Po zamknięciu lista jest tylko do odczytu, a zmiany zgłaszasz przez czat.",
        ],
        notes: [
          "Dobieraj sieci do swojego profilu: kupiec decyduje na podstawie profilu firmy i propozycji, więc kompletny profil (opis, produkty, certyfikaty, logistyka) zwiększa szansę na akceptację.",
          "Jeśli zapis zaznaczenia się nie powiedzie, zobaczysz komunikat z prośbą o odświeżenie strony — sprawdź listę przed potwierdzeniem.",
        ],
      },
      {
        id: "po-zamknieciu",
        title: "Po zamknięciu wyborów: odpowiedzi kupców i plan roboczy",
        steps: [
          "Kupiec każdej wybranej sieci oznacza Twoją firmę: **Chcę się spotkać**, **Daj szansę** albo **Nie chcę**. Brak odpowiedzi kupca jest traktowany jak „Daj szansę”.",
          "Zaakceptowane spotkania mają pierwszeństwo w przydziale i numeracji; „Daj szansę” trafia po nich; „Nie chcę” wyklucza spotkanie (organizator może je dodać ręcznie tylko wyjątkowo, po ostrzeżeniu).",
          "Organizator uruchamia algorytm i koryguje plan. W zakładce **Algorytm** widzisz komunikat o zamkniętych wyborach, a jeśli organizator udostępni Ci podgląd — **wstępny plan roboczy** z zastrzeżeniem, że może się zmienić.",
          "Uwagi do planu roboczego zgłaszasz przez czat; sam nie edytujesz planu.",
        ],
      },
      {
        id: "plan",
        title: "Plan i numery spotkań (Twoje spotkania)",
        steps: [
          "Po publikacji planu przez organizatora zakładka **Twoje spotkania** pokazuje finalną listę sieci z **numerem spotkania** przy każdej.",
          "Numer oznacza **kolejność wywołania** w strefie spotkań danej sieci, nie godzinę.",
          "Przy sieci masz przycisk **Podgląd** z informacjami organizacyjnymi (np. tryb online, wejście).",
          "Organizator może wysłać Ci e-mailem **kartę spotkań w PDF** z tą samą listą — do wydruku na dzień wydarzenia.",
        ],
        notes: [
          "Plan opublikowany to plan finalny. Zmiany po publikacji robi wyłącznie organizator; zgłoś je przez czat albo kontakt podany na ekranie.",
        ],
      },
      {
        id: "dzien-wydarzenia",
        title: "Dzień wydarzenia",
        steps: [
          "Przyjdź na rejestrację w godzinach podanych przez organizatora. Miej przy sobie listę spotkań z aplikacji albo kartę PDF.",
          "Aktualnie wywoływane numery są widoczne na **dużym ekranie** w sali i w aplikacji w zakładce Twoje spotkania (widok na żywo „Moja kolejka”). Publiczna tablica kolejek jest też dostępna w aplikacji pod adresem /tablice.",
          "Gdy zobaczysz swój numer przy danej sieci, podejdź do obsługi B2B przy wejściu do strefy spotkań (Gate 1 lub Gate 2 — numer wejścia jest przy sieci). Pomocnik Fresh Market odprowadzi Cię do stolika sieci.",
          "Po spotkaniu wróć do obserwowania kolejki — kolejny numer może być wywołany wkrótce.",
          "Przygotuj materiały i próbki dla wszystkich sieci z listy przed startem — wywołania następują szybko.",
        ],
      },
      {
        id: "pomoc",
        title: "Pomoc i kontakt",
        steps: [
          "Pytania o pakiet, wybory i plan: czat z organizatorem w prawym dolnym rogu panelu.",
          "Dane kontaktowe organizatora są wyświetlane na ekranach modułu (blokada, plan).",
        ],
      },
    ],
    archive: {
      title: "Archiwum: edycja 2026",
      intro: "Tak wyglądał harmonogram edycji 2026. Zasady z 2026 są podstawą edycji {{year}}; terminy i szczegóły organizacyjne edycji {{year}}: informacja zostanie podana przez organizatora.",
      items: [
        "Wydarzenie: 24 września 2026, MCC Mazurkas Conference Centre, Ożarów Mazowiecki.",
        "Fazy modułu w 2026: Rejestracja (sieci potwierdzają udział) → Preferencje 1–16 września (dostawcy i kupcy wybierają partnerów) → Algorytm i korekty 17–21 września (organizator) → Publikacja planu 22 września i wydarzenie 24 września.",
        "Zasada pakietów w 2026: 5 sieci głównych na każdy pakiet Business (min. 5), rezerwowe bez limitu.",
        "Numery spotkań w 2026 oznaczały kolejność wywołania przy Gate 1 / Gate 2; aktualne wywołania na dużym ekranie i w aplikacji.",
      ],
    },
  },
  en: {
    eyebrow: "Fresh Market {{year}} B2B Meetings · supplier guide",
    title: "B2B Meetings {{year}} for suppliers",
    summary: "Meeting packages, choosing retail chains, what happens after selections close, the plan with meeting numbers and taking part on the event day.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "czym-sa",
        title: "What B2B Meetings are",
        intro: "B2B Meetings are scheduled 1:1 conversations with retail chain buyers during the Fresh Market event. The B2B panel is used to choose chains, collect buyers' answers, let the organiser build the plan and run the meeting queue on the event day.",
        steps: [
          "Meetings are scheduled for companies with a meeting package (Business or Premium). The package and its level are assigned to your company by the organiser.",
          "You indicate the chains you want to meet. Buyers answer the requests. The organiser builds the plan.",
          "After the plan is published you see the list of chains with **meeting numbers**. On the event day the number is the order in which you are called to the conversation.",
          "Dates of the {{year}} edition — opening of chain selection, closing of selections, plan publication, event date and venue: information will be provided by the organiser.",
        ],
        notes: [
          "Choosing a chain is a request, not a guarantee of a meeting. The buyer's acceptance gives priority. “Give a chance” and no answer allow allocation as places permit; a refusal excludes automatic allocation.",
        ],
      },
      {
        id: "dostep",
        title: "Access to the module",
        intro: "The Meetings tab is in the Fresh Market section of the menu. The “B2B Meetings guide” item always works; the meetings themselves unlock when two conditions are met.",
        steps: [
          "The organiser has **opened the selection phase** for all participants. While it is closed, the menu item has a padlock and the screen shows the planned opening date.",
          "The organiser has **enabled B2B Meetings for your company** (after the participation fee is paid). Without it the item shows a padlock described as “activated individually by the administrator”.",
          "Hover over the locked item — the tooltip says which condition is missing. If in doubt, write to the organiser via the chat.",
        ],
      },
      {
        id: "pakiety",
        title: "Meeting packages",
        steps: [
          "Each purchased Business package gives a pool of **5 main chains** (⭐). A company with two packages can mark 10 main chains, with three — 15. The minimum is 5 regardless of the number of packages.",
          "**Backup** chains (👍) are unlimited. Backups enter the plan when there is room after the main chains.",
          "The package level (Business / Premium) and number of packages are shown in the summary at the top of the module. Package changes are made by the organiser.",
          "The **payment date** of your participation is used by the organiser as priority when ordering meetings. In a tie, the Premium package has priority.",
        ],
      },
      {
        id: "wybor-sieci",
        title: "Choosing chains (Retailer selection tab)",
        intro: "The list contains chains that confirmed participation in the event. A chain may carry organisational notes from the organiser (e.g. online mode, availability hours).",
        steps: [
          "Click a chain once → **⭐ MAIN**. Click again → **👍 BACKUP**. Click a third time → selection removed.",
          "The stats bar shows: main chains chosen (e.g. 3/5), backups and the status: “Choose 5 chains” → “Minimum ✓” → “Ready ✓”.",
          "Selections are saved as you go. Once you reach the minimum, click **Confirm selection** — only this tells the organiser your choice is final.",
          "After any later change click **Confirm again** so the organiser sees your current decision. The date of the last confirmation is shown above the list.",
          "If you see the badge **“Set by the administrator”**, the organiser made this selection on your behalf (e.g. after a call). You can change it — the badge then disappears.",
          "Selections can be changed until the organiser closes the phase. After closing, the list is read-only and changes are requested via the chat.",
        ],
        notes: [
          "Match chains to your profile: buyers decide based on the company profile and proposals, so a complete profile (description, products, certificates, logistics) increases the chance of acceptance.",
          "If saving a selection fails, you see a message asking you to refresh the page — check the list before confirming.",
        ],
      },
      {
        id: "po-zamknieciu",
        title: "After selections close: buyers' answers and the working plan",
        steps: [
          "The buyer of each chosen chain marks your company: **Want to meet**, **Give a chance** or **Do not want**. No answer from the buyer is treated as “Give a chance”.",
          "Accepted meetings have priority in allocation and numbering; “Give a chance” comes after them; “Do not want” excludes the meeting (the organiser can add it manually only exceptionally, after a warning).",
          "The organiser runs the algorithm and corrects the plan. In the **Algorithm** tab you see a message that selections are closed and, if the organiser shares it with you, a **preliminary working plan** marked as subject to change.",
          "Comments on the working plan go through the chat; you do not edit the plan yourself.",
        ],
      },
      {
        id: "plan",
        title: "Plan and meeting numbers (Your meetings)",
        steps: [
          "After the organiser publishes the plan, the **Your meetings** tab shows the final list of chains with a **meeting number** next to each.",
          "The number is the **order of calling** in that chain's meeting area, not a time.",
          "Next to a chain there is a **Preview** button with organisational information (e.g. online mode, gate).",
          "The organiser may e-mail you a **meeting card in PDF** with the same list — to print for the event day.",
        ],
        notes: [
          "A published plan is the final plan. Changes after publication are made only by the organiser; request them via the chat or the contact shown on the screen.",
        ],
      },
      {
        id: "dzien-wydarzenia",
        title: "Event day",
        steps: [
          "Come to registration at the hours given by the organiser. Have your meeting list from the app or the PDF card with you.",
          "The numbers currently being called are shown on the **big screen** in the hall and in the app in the Your meetings tab (live view “My queue”). A public queue board is also available in the app at /tablice.",
          "When you see your number for a chain, go to the B2B staff at the entrance to the meeting area (Gate 1 or Gate 2 — the gate number is shown next to the chain). A Fresh Market assistant walks you to the chain's table.",
          "After the meeting go back to watching the queue — your next number may be called soon.",
          "Prepare materials and samples for all chains on your list before the start — calls come quickly.",
        ],
      },
      {
        id: "pomoc",
        title: "Help and contact",
        steps: [
          "Questions about the package, selections and plan: the organiser chat in the bottom-right corner of the panel.",
          "The organiser's contact details are shown on the module screens (lock screen, plan).",
        ],
      },
    ],
    archive: {
      title: "Archive: 2026 edition",
      intro: "This is how the 2026 schedule looked. The 2026 rules are the basis of the {{year}} edition; dates and organisational details of the {{year}} edition: information will be provided by the organiser.",
      items: [
        "Event: 24 September 2026, MCC Mazurkas Conference Centre, Ożarów Mazowiecki.",
        "Module phases in 2026: Registration (chains confirm participation) → Preferences 1–16 September (suppliers and buyers choose partners) → Algorithm and corrections 17–21 September (organiser) → Plan published 22 September, event 24 September.",
        "Package rule in 2026: 5 main chains per Business package (min. 5), unlimited backups.",
        "Meeting numbers in 2026 meant the order of calling at Gate 1 / Gate 2; current calls on the big screen and in the app.",
      ],
    },
  },
};
