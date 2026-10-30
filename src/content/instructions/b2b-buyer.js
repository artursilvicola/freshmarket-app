// [feat/instructions-split] Instrukcja Spotkań B2B — kupiec (PL/EN).
// Źródła: moduł Spotkań w panelu kupca (ekran blokady, lista dostawców, decyzje,
// podgląd roboczy, zgłoszenia po terminie, plan i lista życzeń) i jego teksty.
export default {
  pl: {
    eyebrow: "Spotkania B2B Fresh Market {{year}} · instrukcja dla kupca",
    title: "Spotkania B2B {{year}} dla kupca",
    summary: "Odpowiedzi na zgłoszenia dostawców, preferencje, organizacja stanowisk Twojej sieci i korzystanie z planu spotkań w dniu wydarzenia.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "czym-sa",
        title: "Czym są Spotkania B2B dla kupca",
        intro: "Podczas Fresh Market dostawcy spotykają się z kupcami sieci handlowych w krótkich rozmowach 1:1 przy stanowisku sieci. W panelu B2B decydujesz, z kim chcesz się spotkać, a organizator układa z tego kolejkę spotkań.",
        steps: [
          "Dostawcy wybierają Twoją sieć jako główną (⭐) lub rezerwową (👍).",
          "Ty odpowiadasz na każde zgłoszenie: Chcę się spotkać, Daj szansę albo Nie chcę.",
          "Organizator uruchamia algorytm, koryguje plan i publikuje listę firm z numerami kolejki dla Twojej sieci.",
          "Terminy edycji {{year}} — otwarcie wyboru sieci, zamknięcie wyborów, publikacja planu, data i miejsce wydarzenia: informacja zostanie podana przez organizatora.",
        ],
      },
      {
        id: "dostep",
        title: "Dostęp do modułu",
        steps: [
          "Pozycja **Spotkania** jest w sekcji Fresh Market w menu. Pozycja „Instrukcja spotkań B2B” działa zawsze.",
          "Spotkania odblokowują się, gdy organizator otworzy fazę wyborów. Wcześniej pozycja ma kłódkę, a ekran pokazuje planowaną datę otwarcia.",
          "Twoja sieć widzi zgłoszenia, gdy organizator oznaczył ją jako uczestnika wydarzenia i przypisał Cię jako kupca tej edycji.",
        ],
      },
      {
        id: "odpowiedzi",
        title: "Odpowiedzi na zgłoszenia dostawców",
        intro: "Karta „Dostawcy, którzy wybrali Twoją sieć” pokazuje każdą firmę z oznaczeniem, czy wybrała Cię jako sieć główną, czy rezerwową.",
        steps: [
          "Kliknij **Podgląd**, żeby zobaczyć profil firmy, produkty, certyfikaty i propozycje asortymentowe, jeśli dostawca je wysłał.",
          "Oznacz firmę: **✅ Chcę** — spotkanie ma pierwszeństwo w przydziale; **🤝 Daj szansę** — spotkanie odbędzie się, jeśli będzie miejsce, z numerem po zaakceptowanych; **❌ Nie chcę** — firma jest wykluczona z Twojego planu.",
          "Przy „Nie chcę” aplikacja proponuje łagodniejszą opcję „Przenieś na koniec kolejki” (zalecane) i prosi o potwierdzenie odrzucenia.",
          "**Brak odpowiedzi działa jak „Daj szansę”.** Nie musisz klikać przy każdej firmie — wystarczy oznaczyć te, które chcesz na pewno, i te, których nie chcesz.",
          "Odpowiedzi zapisują się od razu; statystyki na górze pokazują liczbę zgłoszeń, „Chcę” i „Daj szansę”.",
          "Jeśli przy decyzji widzisz oznaczenie „ustawił administrator”, organizator wpisał ją w Twoim imieniu; możesz ją zmienić.",
        ],
        notes: [
          "Nadal obowiązują limity: liczba spotkań zależy od liczby stanowisk Twojej sieci i pakietów dostawców. „Chcę” zwiększa szansę na spotkanie, ale organizator układa kolejkę dla całej sieci.",
        ],
      },
      {
        id: "po-zamknieciu",
        title: "Po zamknięciu wyborów",
        steps: [
          "Po zamknięciu fazy odpowiedzi są tylko do wglądu: widzisz zapisane decyzje oraz automatyczne „Daj szansę” dla firm bez odpowiedzi. To dane do matchingu, nie lista spotkań.",
          "Jeśli organizator udostępni Ci podgląd, zobaczysz **wstępny plan roboczy** spotkań z Twoją siecią z zastrzeżeniem, że może się zmienić.",
          "Jeśli organizator odblokuje dla Twojej sieci **zgłoszenia po terminie**, możesz zaznaczyć dodatkowych dostawców — to informacja dla organizatora, nie zmienia planu automatycznie.",
          "Zmiany decyzji po zamknięciu wprowadza organizator; napisz przez czat.",
        ],
      },
      {
        id: "plan",
        title: "Plan spotkań",
        steps: [
          "Po publikacji sekcja **„Firmy, z którymi się spotykasz — plan finalny”** pokazuje dostawców w kolejności numerów kolejki Twojej sieci. Przed publikacją ta sama sekcja może pokazywać plan roboczy.",
          "W sekcji **„Firmy, z którymi chciałbyś się jeszcze spotkać”** możesz zgłosić dodatkowe firmy przyciskiem **+ Chcę** — organizator uwzględni je ręcznie, jeśli będzie to możliwe.",
          "Organizator może wysłać na adresy kupców sieci **kartę planu w PDF** z listą firm i numerami — do wydruku na stanowisko.",
        ],
      },
      {
        id: "stanowiska",
        title: "Organizacja stanowisk i dzień wydarzenia",
        intro: "Każda sieć ma w strefie spotkań swoje stanowisko (lub kilka). Liczbę stanowisk i wejście (Gate), przy którym stoi logo sieci, ustawia organizator — od tego zależy pojemność planu.",
        steps: [
          "Przed wydarzeniem potwierdź z organizatorem liczbę osób i stanowisk Twojej sieci oraz tryb udziału (na miejscu / online), jeśli dotyczy.",
          "W dniu wydarzenia dostawcy są wywoływani według numerów kolejki; aktualne numery są pokazywane na dużym ekranie i w aplikacji. Obsługa B2B przy wejściu (Gate 1 / Gate 2) doprowadza dostawcę do stanowiska.",
          "Numer stanowiska Twojej sieci poznasz w recepcji wydarzenia.",
          "Zmiany w trakcie dnia (przesunięcia, sprawy organizacyjne) ogłasza obsługa; zgłaszaj je obsłudze B2B przy stanowisku.",
        ],
      },
      {
        id: "pomoc",
        title: "Pomoc i kontakt",
        steps: [
          "Czat z organizatorem w prawym dolnym rogu panelu; dane kontaktowe organizatora są na ekranach modułu.",
        ],
      },
    ],
    archive: {
      title: "Archiwum: edycja 2026",
      intro: "Harmonogram edycji 2026. Zasady z 2026 są podstawą edycji {{year}}; terminy i szczegóły organizacyjne edycji {{year}}: informacja zostanie podana przez organizatora.",
      items: [
        "Wydarzenie: 24 września 2026, MCC Mazurkas Conference Centre, Ożarów Mazowiecki; rejestracja od 8:00.",
        "Wybory kupców do 16 września 2026; algorytm i korekty 17–21 września; publikacja planu 22 września.",
        "Decyzje kupca w 2026: Chcę się spotkać / Daj szansę / Nie chcę; brak odpowiedzi = Daj szansę.",
      ],
    },
  },
  en: {
    eyebrow: "Fresh Market {{year}} B2B Meetings · buyer guide",
    title: "B2B Meetings {{year}} for buyers",
    summary: "Answering suppliers' requests, preferences, organising your chain's stations and using the meeting plan on the event day.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "czym-sa",
        title: "What B2B Meetings are for a buyer",
        intro: "During Fresh Market, suppliers meet retail chain buyers in short 1:1 conversations at the chain's station. In the B2B panel you decide whom you want to meet, and the organiser builds the meeting queue from that.",
        steps: [
          "Suppliers choose your chain as main (⭐) or backup (👍).",
          "You answer each request: Want to meet, Give a chance or Do not want.",
          "The organiser runs the algorithm, corrects the plan and publishes the list of companies with queue numbers for your chain.",
          "Dates of the {{year}} edition — opening of chain selection, closing of selections, plan publication, event date and venue: information will be provided by the organiser.",
        ],
      },
      {
        id: "dostep",
        title: "Access to the module",
        steps: [
          "The **Meetings** item is in the Fresh Market section of the menu. The “B2B Meetings guide” item always works.",
          "Meetings unlock when the organiser opens the selection phase. Before that the item has a padlock and the screen shows the planned opening date.",
          "Your chain sees requests once the organiser has marked it as an event participant and assigned you as a buyer for this edition.",
        ],
      },
      {
        id: "odpowiedzi",
        title: "Answering suppliers' requests",
        intro: "The card “Suppliers who chose your chain” lists each company, marked as having chosen you as a main or backup chain.",
        steps: [
          "Click **Preview** to see the company profile, products, certificates and product proposals if the supplier sent any.",
          "Mark the company: **✅ Want** — the meeting has priority in allocation; **🤝 Give a chance** — the meeting takes place if there is room, numbered after the accepted ones; **❌ Do not want** — the company is excluded from your plan.",
          "For “Do not want” the app suggests the softer option “Move to the end of the queue” (recommended) and asks you to confirm the rejection.",
          "**No answer works like “Give a chance”.** You do not have to click on every company — mark the ones you definitely want and the ones you do not.",
          "Answers are saved immediately; the stats at the top show the number of requests, “Want” and “Give a chance”.",
          "If a decision shows the badge “set by the administrator”, the organiser entered it on your behalf; you can change it.",
        ],
        notes: [
          "Limits still apply: the number of meetings depends on your chain's number of stations and the suppliers' packages. “Want” raises the chance of a meeting, but the organiser builds the queue for the whole chain.",
        ],
      },
      {
        id: "po-zamknieciu",
        title: "After selections close",
        steps: [
          "After the phase closes, answers are view-only: you see the saved decisions and the automatic “Give a chance” for companies without an answer. This is matching data, not the list of meetings.",
          "If the organiser shares it with you, you see a **preliminary working plan** of meetings with your chain, marked as subject to change.",
          "If the organiser unlocks **late requests** for your chain, you can mark additional suppliers — this is information for the organiser and does not change the plan automatically.",
          "Decision changes after closing are made by the organiser; write via the chat.",
        ],
      },
      {
        id: "plan",
        title: "Meeting plan",
        steps: [
          "After publication, the section **“Companies you meet — final plan”** shows suppliers in the order of your chain's queue numbers. Before publication the same section may show the working plan.",
          "In **“Companies you would also like to meet”** you can request additional companies with **+ Want** — the organiser includes them manually if possible.",
          "The organiser may send a **plan card in PDF** with the list of companies and numbers to the chain buyers' addresses — to print for the station.",
        ],
      },
      {
        id: "stanowiska",
        title: "Stations and the event day",
        intro: "Each chain has its own station (or several) in the meeting area. The number of stations and the gate where the chain's logo stands are set by the organiser — the plan's capacity depends on them.",
        steps: [
          "Before the event confirm with the organiser the number of people and stations of your chain and the participation mode (on site / online) if applicable.",
          "On the event day suppliers are called by queue numbers; current numbers are shown on the big screen and in the app. B2B staff at the entrance (Gate 1 / Gate 2) walk the supplier to the station.",
          "You learn your chain's station number at the event reception.",
          "Changes during the day (shifts, organisational matters) are announced by the staff; report them to the B2B staff at the station.",
        ],
      },
      {
        id: "pomoc",
        title: "Help and contact",
        steps: [
          "Organiser chat in the bottom-right corner of the panel; the organiser's contact details are on the module screens.",
        ],
      },
    ],
    archive: {
      title: "Archive: 2026 edition",
      intro: "Schedule of the 2026 edition. The 2026 rules are the basis of the {{year}} edition; dates and organisational details of the {{year}} edition: information will be provided by the organiser.",
      items: [
        "Event: 24 September 2026, MCC Mazurkas Conference Centre, Ożarów Mazowiecki; registration from 8:00.",
        "Buyers' selections until 16 September 2026; algorithm and corrections 17–21 September; plan published 22 September.",
        "Buyer decisions in 2026: Want to meet / Give a chance / Do not want; no answer = Give a chance.",
      ],
    },
  },
};
