// [feat/instructions-split] Instrukcja administratora — PreConnect (PL/EN).
// Źródła: panel admina (Dashboard, Pipeline, Firmy, Sieci, Rozliczenia,
// Wiadomości, Branding, Administratorzy, przełącznik kont) i runbooki w docs/.
export default {
  pl: {
    eyebrow: "PreConnect · instrukcja administratora",
    title: "PreConnect — instrukcja administratora",
    summary: "Obsługa PreConnect z panelu administratora: firmy i dostępy, sieci i kupcy, moderacja i mailing w Pipeline, kredyty i rozliczenia, wiadomości, treści w Brandingu, podgląd kont uczestników.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "przeglad",
        title: "Przegląd modułu",
        intro: "PreConnect działa cały rok. Dostawca wysyła propozycję do sieci → administrator moderuje → propozycja trafia do panelu kupca i do mailingu → kupiec otwiera → z pakietu dostawcy pobierany jest kredyt → dostawca dostaje powiadomienie.",
        steps: [
          "**Dashboard** pokazuje, co wymaga akcji: propozycje do moderacji, firmy do aktywacji, proformy oczekujące, oraz skróty do modułów.",
          "Obowiązuje zasada: **dostawca nigdy nie widzi danych kupca** (nazwisk, adresów, telefonów). Sieć może widzieć osobę i telefon dostawcy z profilu firmy.",
          "Menu admina: Operacyjne (Pipeline, Firmy, Sieci, Wiadomości), Finanse (Rozliczenia), Fresh Market (FM Spotkania B2B), System (Branding, Administratorzy).",
        ],
      },
      {
        id: "firmy",
        figure: { src: "/instrukcje/admin-firmy.png", alt: "Firmy: rozwinięty wiersz firmy testowej — status, dostępy, kredyty, opis AI, wysyłki", caption: "Firmy → rozwinięty wiersz (firma testowa): Status & dostęp, przełączniki PreConnect / Spotkania B2B, limit i pakiet kredytów, Przyznaj bezpłatne kredyty, Opis AI, lista wysyłek." },
        title: "Firmy: aktywacja, dostępy, pakiety",
        steps: [
          "Nowa firma po rejestracji ma status **Czeka na zatwierdzenie** i jest widoczna na zakładce „Do zatwierdzenia” (licznik w menu). Rozwiń wiersz (▼) → **Zatwierdź konto** albo **Odrzuć** (z notatką dla firmy — trafia do maila).",
          "**Wstrzymaj konto / Aktywuj ponownie** — wstrzymanie blokuje wysyłki i Spotkania B2B, profil zostaje. Zmiana statusu wysyła e-mail do firmy.",
          "**Dostęp**: przełączniki PreConnect (wysyłka ofert do sieci) i Spotkania B2B (udział w wydarzeniu) — nowa firma ma PreConnect wyłączony do czasu aktywacji.",
          "**Pakiet i limit kredytów**: plan (Standard 5/10/20, Premium 10/20) i limit; limit nie może być niższy niż wykorzystane wysyłki. Zapisz pakiet.",
          "**Przyznaj bezpłatne kredyty**: liczba na firmę, powód (promocja, rekompensata, prezent, prezent za rejestrację, inny), ważność (domyślnie 3 miesiące), wiadomość dla odbiorcy i notatka wewnętrzna. Dostawca widzi je jako osobną pulę; e-mail nie jest wysyłany. Przy błędzie połączenia użyj „Ponów” w tym samym formularzu — nowy formularz to nowa partia.",
          "**Opis AI**: Generuj AI (z profilu i strony WWW), Edytuj, Zatwierdź, Przetłumacz na EN. Zatwierdzony opis widzi kupiec.",
          "**Data opłaty** i **pakiety Business / poziom** dotyczą Spotkań B2B (patrz instrukcja spotkań).",
          "Kontakty w wierszu: osoba, operator konta, kontakt firmy; skopiuj e-mail/telefon, „Napisz e-mail”, „Wiadomości” (czat).",
        ],
      },
      {
        id: "sieci",
        figure: { src: "/instrukcje/admin-sieci.jpg", alt: "Sieci: lista sieci z wyszukiwarką, statusem aktywności i udziałem w FM", caption: "Sieci (filtr „ZZZ TEST”): status Aktywna / Nieaktywna, udział w FM, liczba kupców, data wysyłki." },
        title: "Sieci i kupcy",
        steps: [
          "**Dodaj sieć**: nazwa, kraj, pierwsza wysyłka, opis, oraz kupiec główny (imię i nazwisko, e-mail, telefon, stanowisko, kategorie „odpowiada za”). Dodanie sieci tworzy też konto kupca.",
          "Rozwiń kartę sieci: logo, nazwa, kraj, **następna wysyłka** (domyślnie pierwszy wtorek miesiąca), notatka admina, **wymagania handlowe sieci** (dostawca musi je potwierdzić przed wysyłką), **informacje organizacyjne FM**, lista kupców (aktywny, kategorie, oznaczenie kupca tej edycji FM), **Wejście (GATE)**.",
          "Przełącznik **Aktywna / Nieaktywna** przy sieci: aktywna sieć jest widoczna dla wszystkich dostawców na liście wysyłek i w module spotkań. Sieci testowe trzymaj nieaktywne poza próbami.",
          "Aktywna sieć musi mieć co najmniej jednego aktywnego kupca z e-mailem i kategoriami; e-mail kupca jest unikalny w całym systemie.",
          "Udział sieci w wydarzeniu i identyfikator FM — patrz instrukcja administratora spotkań B2B.",
        ],
      },
      {
        id: "pipeline",
        figure: { src: "/instrukcje/admin-pipeline-historia.png", alt: "Pipeline → Sieci / mailing: historia wysyłek z odbiorcami i otwarciami", caption: "Historia wysyłek sieci testowej: stan odczytu przy propozycji, tabela Odbiorcy z pierwszym i ostatnim otwarciem, Wejścia do aplikacji." },
        title: "Pipeline: moderacja, panel kupca, mailing",
        intro: "Pipeline prowadzi propozycję przez trzy kroki. Każdy krok jest osobną decyzją administratora.",
        steps: [
          "**Do moderacji**: lista propozycji ze statusem „Do moderacji”. Przy każdej: ChatGPT (analiza), Wiadomość (do dostawcy), **Zatwierdź** / **Odrzuć**. Odrzucenie zwalnia rezerwację kredytu dostawcy.",
          "**Krok 2 — Wyślij zatwierdzone do panelu kupca (N)**: zatwierdzone propozycje zmieniają status na „wysłane” i od razu są widoczne w panelu kupca. To nie wysyła e-maila.",
          "**Sieci / mailing**: przy każdej sieci widzisz „w panelu · w koszyku · wysłane”, datę ostatniego mailingu i **Historię wysyłek**. Zaznacz propozycje do koszyka e-mail (checkbox „Dodaj do koszyka e-mail”) i kliknij **Wyślij e-mail do tej sieci**.",
          "Okno wysyłki pokazuje odbiorców (aktywni kupcy sieci), temat, podgląd maila i listę propozycji do wyboru. **Wyślij (N)** jest nieodwracalne — każdy kupiec dostaje osobną wiadomość z linkami logowania na swój adres.",
          "Mailing organizator wykonuje ręcznie, zwykle w pierwszy wtorek miesiąca (pasek u góry pokazuje najbliższą datę). System nie wysyła automatycznie.",
          "**Historia wysyłek** przy sieci: każdy mailing z listą propozycji i stanem odczytu każdej („odczytana w aplikacji”, „e-mail otwarty”, „nieodczytana, wygasła”), a od mailingów po 22.10.2026 także tabela **Odbiorcy** (kupiec, adres, wysłano, dostarczono, pierwsze i ostatnie otwarcie) oraz **Wejścia do aplikacji** per kupiec.",
          "**Dostawcy / tracking**: per dostawca liczba ofert w panelu kupców, sieci, ostatni e-mail, termin odczytu (14 dni od e-maila), odczytane, czekające na rozliczenie lub zwrot.",
        ],
        notes: [
          "Otwarcie e-maila przez kupca (piksel) liczy się jak odczyt i pobiera kredyt dostawcy — to decyzja organizatora; nie zmieniaj jej bez uzgodnienia.",
          "Próby wysyłki rób tylko na sieci testowej i aliasach testowych; po próbie wyłącz sieć testową i wstrzymaj firmę testową.",
        ],
      },
      {
        id: "kredyty",
        title: "Kredyty, proformy, rozliczenia",
        steps: [
          "Cykl kredytu: **rezerwacja** przy wysłaniu propozycji → **pobranie** przy pierwszym odczycie (otwarcie e-maila lub wejście kupca w propozycję) → **zwolnienie rezerwacji** po 14 dniach od mailingu bez odczytu (status „wygasła”) albo po odrzuceniu w moderacji.",
          "Kolejność pul: bezpłatne od organizatora → kupione (najbliższy termin ważności) → historyczne. Kupione kredyty są ważne 12 miesięcy.",
          "**Proformy** (Dashboard / Rozliczenia): dostawca generuje proformę przy wyborze przelewu; po zaksięgowaniu wpłaty kliknij **Oznacz opłaconą → aktywuj pakiet**.",
          "**PayU**: płatności online aktywują pakiet automatycznie; status widzisz w Rozliczeniach (opłacone / oczekujące / błędy).",
          "**Rozliczenia**: przegląd proform, płatności PayU i pakietów kredytów per dostawca (kupiono, wykorzystane, pozostałe, ważne do).",
          "Wygaszanie po 14 dniach i zwolnienie rezerwacji działa automatycznie; powiadomienie e-mail do dostawcy po pierwszym odczycie — jedno na propozycję.",
        ],
      },
      {
        id: "wiadomosci",
        title: "Wiadomości",
        steps: [
          "Zakładka **Wiadomości** to czat z dostawcami i kupcami; nieprzeczytane oznacza licznik w menu.",
          "Z wiersza firmy w Firmy przejdziesz do rozmowy przyciskiem „Wiadomości”; z moderacji — przyciskiem „Wiadomość” przy propozycji.",
          "Przycisk sugestii odpowiedzi korzysta z asystenta AI; sprawdź treść przed wysłaniem.",
        ],
      },
      {
        id: "branding",
        figure: { src: "/instrukcje/admin-branding-instrukcje.jpg", alt: "Branding: pola Instrukcje (link w menu) i Komunikaty", caption: "Branding → Instrukcje (link w menu): dotychczasowa treść HTML per rola i język; poniżej Komunikaty." },
        title: "Branding: logo, komunikaty, sponsorzy, archiwum instrukcji 2026",
        steps: [
          "**Logo** aplikacji: PNG/JPG/SVG/WEBP do 1 MB; widoczne w menu, nagłówkach i na stronach logowania.",
          "**Archiwum instrukcji 2026 (treść HTML)** — dawna, połączona instrukcja PreConnect i spotkań z edycji 2026, per rola i język. Widać ją wyłącznie pod osobnym odnośnikiem „Archiwum instrukcji 2026” (w stopce instrukcji PreConnect uczestnika i pod własnym adresem). Bieżące instrukcje — PreConnect i Spotkania B2B dla dostawcy, kupca i administratora — są częścią aplikacji (pliki `src/content/instructions`); ich zmiana to zmiana w kodzie i wdrożenie, nie edycja w Brandingu.",
          "**Komunikaty**: pasek na górze panelu albo okno przy wejściu (pilne), osobno dla dostawcy i kupca, z opcjonalnym zakresem dat.",
          "**Sponsorzy**: logotypy w stopce paneli; kolejność na liście = kolejność w pasku.",
          "Zapisz treści — uczestnicy zobaczą zmiany po odświeżeniu strony.",
        ],
      },
      {
        id: "podglad-kont",
        title: "Podgląd kont uczestników",
        steps: [
          "Przełącznik kont (▼ obok nazwy) → zakładka Dostawcy lub Kupcy → wybierz firmę / kupca. Panel pokazuje widok tego konta z jego danymi.",
          "W podglądzie profil („Mój profil” / „Profil firmy”) jest tylko do odczytu — zapis jest zablokowany, żeby nie nadpisać danych uczestnika.",
          "Instrukcje w podglądzie odpowiadają podglądanej roli (dostawca widzi instrukcje dostawcy, kupiec — kupca).",
          "Powrót: ▼ → Admin → własne konto.",
        ],
      },
      {
        id: "administratorzy",
        title: "Administratorzy",
        steps: [
          "Zakładkę **Administratorzy** widzi tylko super administrator. Promuj istniejące konto na administratora po adresie e-mail; nadaj lub zdejmij uprawnienia super admina; usuń uprawnienia.",
          "Nie można odebrać uprawnień samemu sobie.",
        ],
      },
    ],
    questions: [
      "Czy wejścia administratora w podglądzie konta kupca mają być zapisywane w historii odczytów jako „administrator (podgląd)”, czy pomijane?",
      "Czy zdarzenia webhooka Resend, które po ponowieniach zostaną w stanie „błąd”, mają dostać ręczny przycisk „ponów” w panelu?",
    ],
  },
  en: {
    eyebrow: "PreConnect · administrator guide",
    title: "PreConnect — administrator guide",
    summary: "Running PreConnect from the admin panel: companies and access, chains and buyers, moderation and mailing in the Pipeline, credits and settlements, messages, Branding content, participant account preview.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "przeglad",
        title: "Module overview",
        intro: "PreConnect runs all year. A supplier sends a proposal to a chain → the administrator moderates → the proposal reaches the buyer's panel and the mailing → the buyer opens it → a credit is taken from the supplier's package → the supplier is notified.",
        steps: [
          "The **Dashboard** shows what needs action: proposals to moderate, companies to activate, pending pro formas, and module shortcuts.",
          "Rule: **a supplier never sees buyer data** (names, addresses, phones). A chain may see the supplier's contact person and phone from the company profile.",
          "Admin menu: Operations (Pipeline, Companies, Chains, Messages), Finance (Settlements), Fresh Market (FM B2B Meetings), System (Branding, Administrators).",
        ],
      },
      {
        id: "firmy",
        figure: { src: "/instrukcje/admin-firmy.png", alt: "Companies: expanded test company row — status, access, credits, AI description, sendings", caption: "Companies → expanded row (test company): Status & access, PreConnect / B2B Meetings switches, credit limit and package, Grant free credits, AI description, sending list." },
        title: "Companies: activation, access, packages",
        steps: [
          "A newly registered company has the status **Awaiting approval** and is listed on the “To approve” tab (counter in the menu). Expand the row (▼) → **Approve account** or **Reject** (with a note for the company — included in the e-mail).",
          "**Suspend account / Reactivate** — suspension blocks sendings and B2B Meetings, the profile stays. A status change e-mails the company.",
          "**Access**: PreConnect (sending offers to chains) and B2B Meetings (event participation) switches — a new company has PreConnect off until activation.",
          "**Package and credit limit**: plan (Standard 5/10/20, Premium 10/20) and limit; the limit cannot be lower than sendings already used. Save the package.",
          "**Grant free credits**: quantity per company, reason (promotion, compensation, gift, registration gift, other), validity (3 months by default), message for the recipient and an internal note. The supplier sees them as a separate pool; no e-mail is sent. On a connection error use “Retry” in the same form — a new form is a new batch.",
          "**AI description**: Generate AI (from the profile and website), Edit, Approve, Translate to EN. The approved description is what buyers see.",
          "**Payment date** and **Business packages / level** concern B2B Meetings (see the meetings guide).",
          "Contacts in the row: person, account operator, company contact; copy e-mail/phone, “Write e-mail”, “Messages” (chat).",
        ],
      },
      {
        id: "sieci",
        figure: { src: "/instrukcje/admin-sieci.jpg", alt: "Chains: list with search, activity status and FM participation", caption: "Chains (filter “ZZZ TEST”): Active / Inactive status, FM participation, number of buyers, sending date." },
        title: "Chains and buyers",
        steps: [
          "**Add chain**: name, country, first sending, description, and the main buyer (name, e-mail, phone, position, “responsible for” categories). Adding a chain also creates the buyer account.",
          "Expand the chain card: logo, name, country, **next sending** (first Tuesday of the month by default), admin note, **chain trade requirements** (the supplier must confirm them before sending), **FM organisational notes**, buyer list (active, categories, marked as this edition's FM buyer), **Gate**.",
          "**Active / Inactive** switch: an active chain is visible to all suppliers on the sending list and in the meetings module. Keep test chains inactive outside tests.",
          "An active chain needs at least one active buyer with an e-mail and categories; a buyer's e-mail is unique across the system.",
          "Event participation of a chain and its FM identifier — see the B2B Meetings administrator guide.",
        ],
      },
      {
        id: "pipeline",
        figure: { src: "/instrukcje/admin-pipeline-historia.png", alt: "Pipeline → Chains / mailing: mailing history with recipients and opens", caption: "Mailing history of the test chain: read state per proposal, Recipients table with first and last open, App visits." },
        title: "Pipeline: moderation, buyer panel, mailing",
        intro: "The Pipeline takes a proposal through three steps. Each step is a separate administrator decision.",
        steps: [
          "**To moderate**: proposals with the status “To moderate”. For each: ChatGPT (analysis), Message (to the supplier), **Approve** / **Reject**. Rejecting releases the supplier's credit reservation.",
          "**Step 2 — Send approved to the buyer panel (N)**: approved proposals change status to “sent” and become visible in the buyer's panel immediately. This sends no e-mail.",
          "**Chains / mailing**: each chain shows “in panel · in basket · sent”, the date of the last mailing and the **Mailing history**. Tick proposals into the e-mail basket (“Add to e-mail basket”) and click **Send e-mail to this chain**.",
          "The sending window shows the recipients (active buyers of the chain), subject, e-mail preview and the list of proposals to include. **Send (N)** is irreversible — each buyer receives a separate message with login links for their own address.",
          "The mailing is done manually by the organiser, usually on the first Tuesday of the month (the bar at the top shows the next date). The system does not send automatically.",
          "**Mailing history** per chain: each mailing with its proposals and the read state of each (“read in the app”, “e-mail opened”, “unread, expired”), and for mailings after 22 Oct 2026 also the **Recipients** table (buyer, address, sent, delivered, first and last open) and **App visits** per buyer.",
          "**Suppliers / tracking**: per supplier the number of offers in buyer panels, chains, last e-mail, reading deadline (14 days from the e-mail), read, awaiting settlement or refund.",
        ],
        notes: [
          "A buyer opening the e-mail (tracking pixel) counts as a read and charges the supplier's credit — this is the organiser's decision; do not change it without agreement.",
          "Run sending tests only on the test chain and test aliases; after a test deactivate the test chain and suspend the test company.",
        ],
      },
      {
        id: "kredyty",
        title: "Credits, pro formas, settlements",
        steps: [
          "Credit cycle: **reservation** when the proposal is sent → **charge** on the first read (e-mail opened or buyer opens the proposal) → **reservation released** 14 days after the mailing without a read (status “expired”) or after rejection in moderation.",
          "Pool order: free from the organiser → purchased (nearest expiry) → historical. Purchased credits are valid for 12 months.",
          "**Pro formas** (Dashboard / Settlements): the supplier generates a pro forma when choosing bank transfer; once the payment is booked click **Mark as paid → activate package**.",
          "**PayU**: online payments activate the package automatically; the status is shown in Settlements (paid / pending / errors).",
          "**Settlements**: overview of pro formas, PayU payments and credit packages per supplier (bought, used, remaining, valid until).",
          "Expiry after 14 days and reservation release run automatically; the e-mail notification to the supplier after the first read is sent once per proposal.",
        ],
      },
      {
        id: "wiadomosci",
        title: "Messages",
        steps: [
          "The **Messages** tab is the chat with suppliers and buyers; unread messages are counted in the menu.",
          "From a company row in Companies you open the conversation with “Messages”; from moderation — with “Message” next to the proposal.",
          "The reply suggestion button uses the AI assistant; check the text before sending.",
        ],
      },
      {
        id: "branding",
        figure: { src: "/instrukcje/admin-branding-instrukcje.jpg", alt: "Branding: Instructions (menu link) and Announcements fields", caption: "Branding → Instructions (menu link): previous HTML content per role and language; Announcements below." },
        title: "Branding: logo, announcements, sponsors, 2026 guide archive",
        steps: [
          "App **logo**: PNG/JPG/SVG/WEBP up to 1 MB; shown in the menu, headers and login pages.",
          "**2026 guide archive (HTML content)** — the former combined PreConnect and meetings guide from the 2026 edition, per role and language. It is shown only under the separate link “2026 guide archive” (in the footer of the participant's PreConnect guide and at its own address). The current guides — PreConnect and B2B Meetings for supplier, buyer and administrator — are part of the app (files `src/content/instructions`); changing them is a code change and deployment, not an edit in Branding.",
          "**Announcements**: a bar at the top of the panel or a window on entry (urgent), separately for supplier and buyer, with an optional date range.",
          "**Sponsors**: logos in the panel footer; list order = strip order.",
          "Save content — participants see the changes after refreshing the page.",
        ],
      },
      {
        id: "podglad-kont",
        title: "Previewing participant accounts",
        steps: [
          "Account switcher (▼ next to the name) → Suppliers or Buyers tab → choose a company / buyer. The panel shows that account's view with its data.",
          "In preview, the profile (“My profile” / “Company profile”) is read-only — saving is blocked so the participant's data is not overwritten.",
          "Guides in preview match the previewed role (a supplier sees the supplier guides, a buyer — the buyer ones).",
          "Back: ▼ → Admin → your own account.",
        ],
      },
      {
        id: "administratorzy",
        title: "Administrators",
        steps: [
          "The **Administrators** tab is visible only to the super administrator. Promote an existing account to administrator by e-mail; grant or remove super admin rights; remove rights.",
          "You cannot remove your own rights.",
        ],
      },
    ],
    questions: [
      "Should administrator visits in buyer-account preview be recorded in the read history as “administrator (preview)”, or skipped?",
      "Should Resend webhook events that remain in the “error” state after retries get a manual “retry” button in the panel?",
    ],
  },
};
