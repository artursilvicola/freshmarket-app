// [feat/instructions-split] Instrukcja administratora — Spotkania B2B (PL/EN).
// Źródła: panel FM Spotkania B2B (Zarządzanie, Dane wejściowe, Plan spotkań,
// Korekty, Dzień wydarzenia), Firmy (pakiety, data opłaty), Sieci (udział FM,
// kupcy FM, GATE), karty PDF, moduł kolejek i runbooki w docs/.
export default {
  pl: {
    eyebrow: "Spotkania B2B Fresh Market {{year}} · instrukcja administratora",
    title: "Spotkania B2B {{year}} — instrukcja administratora",
    summary: "Przygotowanie edycji, otwarcie wyborów, nadzór nad danymi wejściowymi, algorytm i korekty, publikacja planu, karty PDF i dzień wydarzenia.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "przeglad",
        figure: { src: "/instrukcje/admin-fm-zarzadzanie.jpg", alt: "FM Spotkania B2B → Zarządzanie: dostęp uczestników, publikacja planu, fazy", caption: "FM Spotkania B2B → Zarządzanie: dostęp uczestników (zamknięty, data otwarcia), publikacja planu, fazy organizacyjne." },
        title: "Przegląd: fazy i zakładki",
        intro: "Moduł prowadzi edycję przez cztery fazy: **Rejestracja** (sieci potwierdzają udział) → **Preferencje** (dostawcy i kupcy wybierają) → **Algorytm + Korekty** (administrator) → **Publikacja i wydarzenie**. Aktywną fazę ustawiasz w zakładce Zarządzanie.",
        steps: [
          "Panel **FM Spotkania B2B** ma zakładki: Zarządzanie, Dane wejściowe, Plan spotkań, Korekty, Dzień wydarzenia. Status modułu (Zamknięta / Aktywna / Opublikowany) widać przy pozycji w menu.",
          "Dostęp uczestników: w Zarządzaniu **Otwórz dostęp / Zamknij** oraz **Data planowanego otwarcia** (pokazywana na ekranie blokady).",
          "Instrukcje spotkań dla uczestników są dostępne także przy zamkniętym module — nie odblokowują samych spotkań.",
        ],
      },
      {
        id: "przygotowanie",
        title: "Przygotowanie edycji",
        steps: [
          "**Sieci**: dla każdej sieci biorącej udział włącz „Sieć uczestniczy w Fresh Market”, wpisz unikalny **identyfikator sieci FM** (np. ch28) — bez niego sieć nie pojawi się u dostawców — i oznacz co najmniej jednego aktywnego kupca jako kupca tej edycji. Ustaw **Wejście (GATE)** i informacje organizacyjne FM (tryb online, godziny).",
          "**Firmy**: włącz Spotkania B2B dla firm z opłaconym udziałem, ustaw liczbę **pakietów Business** (1 pakiet = pula 5 sieci głównych) i **poziom** (Business / Premium — Premium ma pierwszeństwo przy remisie), wpisz **datę opłaty** (pierwszeństwo w kolejce; zmiana działa przy kolejnym przeliczeniu).",
          "**Ustawienia wydarzenia**: data wydarzenia, data otwarcia wyborów i termin zamknięcia są w konfiguracji FM i sterują aktywnym modułem. Rok edycji w **instrukcjach** jest osobną stałą w treści aplikacji — zmiana konfiguracji wydarzenia go nie zmienia i odwrotnie.",
          "**Dzień wydarzenia → Stanowiska**: liczba stanowisk na sieć i liczba spotkań na stanowisko wyznaczają pojemność planu; po zmianie uruchom algorytm ponownie.",
        ],
        notes: [
          "Nie zmieniaj dat, fazy ani planów bieżącej edycji „przy okazji” — każda z tych zmian jest osobną decyzją organizatora.",
        ],
      },
      {
        id: "wybory",
        title: "Faza preferencji: otwarcie i nadzór",
        steps: [
          "Kliknij **Otwórz dostęp** — dostawcy z włączonymi Spotkaniami B2B i kupcy sieci uczestniczących widzą moduł; aktywuj fazę 2 na liście faz.",
          "Zakładka **Dane wejściowe**: liczba dostawców gotowych (min. 5 głównych sieci), potwierdzonych (kliknęli „Potwierdź wybór”), bez wyborów, sieci bez odpowiedzi oraz gotowość w procentach. Ramki z nazwami firm do kontaktu.",
          "Podgląd preferencji: **Preferencje dostawców** (⭐ główne, 👍 rezerwowe, data potwierdzenia) i **Odpowiedzi sieci** (Chcę / Daj szansę / Nie chcę / brak).",
          "Wybór lub odpowiedź możesz ustawić w imieniu uczestnika (np. po rozmowie telefonicznej) — uczestnik zobaczy oznaczenie „Wybrane przez administratora” i może je zmienić.",
          "Brak odpowiedzi kupca jest traktowany jak „Daj szansę”; odmowy są wykluczone; akceptacje mają pierwszeństwo.",
        ],
      },
      {
        id: "algorytm",
        title: "Algorytm i korekty (faza 3)",
        steps: [
          "Zamknij wybory (**Zamknij** dostęp lub przejście do fazy 3). Uczestnicy widzą komunikat o zamknięciu; ich listy są tylko do odczytu.",
          "**Plan spotkań → Uruchom algorytm matchingu** — dostępny, gdy wystarczająca liczba dostawców wypełniła preferencje. Algorytm uwzględnia: wybory dostawców (główne przed rezerwowymi), odpowiedzi kupców (Chcę przed Daj szansę; Nie chcę wyklucza), pojemność stanowisk, datę opłaty i poziom pakietu.",
          "Po przeliczeniu sprawdź ostrzeżenia: firmy bez spotkań, sugestie zamian ⭐/👍, pojemność sieci. **Przebuduj plan** przelicza od nowa z preferencji.",
          "**Korekty**: kliknij firmę → kliknij inną = zamiana numerów; kliknij firmę → puste pole = przesunięcie. Dodanie pary odrzuconej przez kupca wymaga potwierdzenia i jest oznaczone ⚠️ w planie. Log zmian admina jest zapisywany.",
          "**Podgląd roboczy**: włącz dla wybranych dostawców lub sieci — zobaczą wstępny plan z dopiskiem „wersja robocza”.",
          "**Zgłoszenia po terminie**: przełącznik „Po terminie” przy sieci odblokowuje kupcowi zaznaczanie dodatkowych dostawców; zgłoszenia nie wchodzą do algorytmu — służą do ręcznych korekt.",
          "Kiedy plan jest gotowy, kliknij **Zatwierdź plan** w Korektach — edycja zostaje zablokowana (Odblokuj edycję, jeśli trzeba).",
        ],
      },
      {
        id: "publikacja",
        title: "Publikacja planu i karty PDF",
        steps: [
          "W Zarządzaniu kliknij **Opublikuj plan finalny**. Dostawcy i kupcy natychmiast widzą zakładkę Twoje spotkania z finalnymi numerami. „Cofnij publikację” istnieje, ale uczestnicy mogli już zobaczyć numery — używaj tylko w sytuacji awaryjnej.",
          "**Karty kolejności spotkań**: moduł planu generuje arkusz Excel oraz PDF per firma i per sieć (z numerami i wejściem GATE) i wysyła je e-mailem — najpierw **Wyślij test** na adres testowy, potem do dostawców i do sieci. Wysyłka wymaga zalogowanego administratora i jest rejestrowana (status per odbiorca).",
          "Na kartach i w panelu uczestników numer oznacza kolejność wywołania, nie godzinę; komunikat o zasadach wywoływania jest wyświetlany pod numerami.",
        ],
      },
      {
        id: "dzien",
        title: "Dzień wydarzenia: kolejki i obsługa",
        steps: [
          "Zakładka **Dzień wydarzenia**: stanowiska i GATE per sieć, **konta obsługi** (kod + PIN; PIN-y nadaje super administrator), **import planu** do kolejek, **próba** przed wydarzeniem.",
          "Obsługa B2B loguje się w aplikacji pod adresem /obsluga (kod + PIN) i wywołuje kolejne numery przy stanowiskach; publiczna tablica kolejek bez nazw firm jest pod /tablice.",
          "Uczestnicy widzą wywołania na dużym ekranie i w aplikacji („Moja kolejka” w Twoich spotkaniach).",
          "Po wydarzeniu zamknij moduł (faza wraca do Rejestracji) i zachowaj dane edycji jako archiwum — nie usuwaj planów ani historii spotkań.",
        ],
      },
      {
        id: "materialy",
        title: "Materiały i archiwum",
        steps: [
          "Raport spotkań edycji 2026 i runbooki są w repozytorium w katalogu docs/production; kompendium wydarzenia 2026 — w docs/.",
          "Instrukcje uczestników (dostawca, kupiec) dla tej edycji przeczytasz w tym samym miejscu, przełączając rolę u góry strony.",
        ],
      },
    ],
    questions: [
      "Data i miejsce wydarzenia {{year}} — do wpisania w konfiguracji FM, gdy edycja będzie otwierana (nie zmienia roku w instrukcjach — ten jest stałą treści).",
      "Daty otwarcia i zamknięcia wyborów oraz publikacji planu {{year}} — dziś w aplikacji są wpisane na sztywno daty 2026 (ekran blokady, bloki na Dashboardzie, teksty faz); wymagają zmiany przy otwarciu edycji.",
      "Czy zasada pakietów (5 sieci głównych na pakiet Business, rezerwowe bez limitu) i pierwszeństwo wg daty opłaty obowiązują bez zmian w {{year}}?",
      "Czy rejestracja udziału firm na {{year}} (freshmarket.eu) ma automatycznie włączać Spotkania B2B i liczbę pakietów w panelu, czy nadal ręcznie?",
      "Lista sieci uczestniczących w {{year}} i ich kupców — do oznaczenia w Sieciach przed otwarciem wyborów.",
      "Czy ręczny wybór sieci dla firm powracających (gałąź przygotowana w 2026, niewdrożona) ma być użyty w {{year}}?",
    ],
    archive: {
      title: "Archiwum: edycja 2026",
      intro: "Przebieg edycji 2026 w module.",
      items: [
        "Wydarzenie 24 września 2026, MCC Mazurkas, Ożarów Mazowiecki. Fazy: Preferencje 1–16.09, Algorytm i korekty 17–21.09, Publikacja 22.09.",
        "Moduł kolejek i numerków (wdrożony 7–9.09.2026): stanowiska/GATE, konta obsługi, import planu, tablice.",
        "Raport spotkań 24.09.2026: 780 zaplanowanych spotkań, 531 odbytych, mediana 7,8 min (docs/production).",
        "Po wydarzeniu moduł zamknięty, faza cofnięta na Rejestrację; nazwa pozycji w menu admina: „FM Spotkania B2B”.",
      ],
    },
  },
  en: {
    eyebrow: "Fresh Market {{year}} B2B Meetings · administrator guide",
    title: "B2B Meetings {{year}} — administrator guide",
    summary: "Preparing the edition, opening selections, supervising input data, algorithm and corrections, plan publication, PDF cards and the event day.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "przeglad",
        figure: { src: "/instrukcje/admin-fm-zarzadzanie.jpg", alt: "FM B2B Meetings → Management: participant access, plan publication, phases", caption: "FM B2B Meetings → Management: participant access (closed, opening date), plan publication, organisational phases." },
        title: "Overview: phases and tabs",
        intro: "The module runs an edition through four phases: **Registration** (chains confirm participation) → **Preferences** (suppliers and buyers choose) → **Algorithm + Corrections** (administrator) → **Publication and event**. You set the active phase in the Management tab.",
        steps: [
          "The **FM B2B Meetings** panel has tabs: Management, Input data, Meeting plan, Corrections, Event day. The module status (Closed / Active / Published) is shown next to the menu item.",
          "Participant access: in Management **Open access / Close** and the **Planned opening date** (shown on the lock screen).",
          "Meeting guides for participants are available even while the module is closed — they do not unlock the meetings themselves.",
        ],
      },
      {
        id: "przygotowanie",
        title: "Preparing the edition",
        steps: [
          "**Chains**: for each participating chain enable “Chain takes part in Fresh Market”, enter a unique **FM chain identifier** (e.g. ch28) — without it the chain does not appear for suppliers — and mark at least one active buyer as this edition's buyer. Set the **Gate** and FM organisational notes (online mode, hours).",
          "**Companies**: enable B2B Meetings for companies with paid participation, set the number of **Business packages** (1 package = pool of 5 main chains) and the **level** (Business / Premium — Premium has priority in a tie), enter the **payment date** (queue priority; a change applies at the next recalculation).",
          "**Event settings**: the event date, selection opening date and closing deadline are in the FM configuration and drive the active module. The edition year in the **guides** is a separate constant in the app content — changing the event configuration does not change it, and vice versa.",
          "**Event day → Stations**: stations per chain and meetings per station define the plan's capacity; after a change run the algorithm again.",
        ],
        notes: [
          "Do not change dates, the phase or plans of the current edition “along the way” — each of these is a separate organiser decision.",
        ],
      },
      {
        id: "wybory",
        title: "Preference phase: opening and supervision",
        steps: [
          "Click **Open access** — suppliers with B2B Meetings enabled and buyers of participating chains see the module; activate phase 2 in the phase list.",
          "**Input data** tab: suppliers ready (min. 5 main chains), confirmed (clicked “Confirm selection”), without selections, chains without answers, and readiness in percent. Boxes list company names to contact.",
          "Preference views: **Supplier preferences** (⭐ main, 👍 backup, confirmation date) and **Chain answers** (Want / Give a chance / Do not want / none).",
          "You can set a selection or answer on a participant's behalf (e.g. after a phone call) — the participant sees the badge “Set by the administrator” and can change it.",
          "No answer from a buyer is treated as “Give a chance”; refusals are excluded; acceptances have priority.",
        ],
      },
      {
        id: "algorytm",
        title: "Algorithm and corrections (phase 3)",
        steps: [
          "Close selections (**Close** access or move to phase 3). Participants see a closing message; their lists become read-only.",
          "**Meeting plan → Run matching algorithm** — available once enough suppliers have filled in preferences. The algorithm considers: supplier selections (main before backup), buyer answers (Want before Give a chance; Do not want excludes), station capacity, payment date and package level.",
          "After recalculation check the warnings: companies without meetings, ⭐/👍 swap suggestions, chain capacity. **Rebuild plan** recalculates from preferences.",
          "**Corrections**: click a company → click another = swap numbers; click a company → empty cell = move. Adding a pair rejected by the buyer requires confirmation and is marked ⚠️ in the plan. The admin change log is kept.",
          "**Working preview**: enable for selected suppliers or chains — they see the preliminary plan marked “working version”.",
          "**Late requests**: the “Late” switch next to a chain lets the buyer mark additional suppliers; the requests do not enter the algorithm — they serve manual corrections.",
          "When the plan is ready click **Approve plan** in Corrections — editing is locked (Unlock editing if needed).",
        ],
      },
      {
        id: "publikacja",
        title: "Plan publication and PDF cards",
        steps: [
          "In Management click **Publish final plan**. Suppliers and buyers immediately see the Your meetings tab with final numbers. “Revert publication” exists, but participants may already have seen the numbers — use it only in an emergency.",
          "**Meeting order cards**: the plan module generates an Excel sheet and PDFs per company and per chain (with numbers and gate) and e-mails them — first **Send test** to a test address, then to suppliers and to chains. Sending requires a logged-in administrator and is logged (status per recipient).",
          "On the cards and in participant panels the number means the order of calling, not a time; the calling rules notice is shown under the numbers.",
        ],
      },
      {
        id: "dzien",
        title: "Event day: queues and staff",
        steps: [
          "**Event day** tab: stations and gate per chain, **staff accounts** (code + PIN; PINs are set by the super administrator), **plan import** into queues, **rehearsal** before the event.",
          "B2B staff log in to the app at /obsluga (code + PIN) and call the next numbers at the stations; the public queue board without company names is at /tablice.",
          "Participants see calls on the big screen and in the app (“My queue” in Your meetings).",
          "After the event close the module (the phase returns to Registration) and keep the edition data as an archive — do not delete plans or meeting history.",
        ],
      },
      {
        id: "materialy",
        title: "Materials and archive",
        steps: [
          "The 2026 meetings report and runbooks are in the repository under docs/production; the 2026 event compendium — in docs/.",
          "You can read the participant guides (supplier, buyer) for this edition in the same place by switching the role at the top of the page.",
        ],
      },
    ],
    questions: [
      "Date and venue of the {{year}} event — to be entered in the FM configuration when the edition opens (it does not change the year in the guides — that is a content constant).",
      "Opening and closing dates of selections and plan publication for {{year}} — today the app has 2026 dates hard-coded (lock screen, Dashboard blocks, phase texts); they need changing when the edition opens.",
      "Do the package rule (5 main chains per Business package, unlimited backups) and priority by payment date apply unchanged in {{year}}?",
      "Should company registration for {{year}} (freshmarket.eu) automatically enable B2B Meetings and the number of packages in the panel, or stay manual?",
      "List of chains taking part in {{year}} and their buyers — to be marked in Chains before selections open.",
      "Should the manual chain selection for returning companies (branch prepared in 2026, not deployed) be used in {{year}}?",
    ],
    archive: {
      title: "Archive: 2026 edition",
      intro: "How the 2026 edition ran in the module.",
      items: [
        "Event 24 September 2026, MCC Mazurkas, Ożarów Mazowiecki. Phases: Preferences 1–16 Sept, Algorithm and corrections 17–21 Sept, Publication 22 Sept.",
        "Queue and numbers module (deployed 7–9 Sept 2026): stations/gates, staff accounts, plan import, boards.",
        "Meetings report 24 Sept 2026: 780 scheduled meetings, 531 held, median 7.8 min (docs/production).",
        "After the event the module was closed and the phase reset to Registration; admin menu item name: “FM B2B Meetings”.",
      ],
    },
  },
};
