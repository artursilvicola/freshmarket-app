// [feat/instructions-split] Instrukcja PreConnect — kupiec (PL/EN).
// Źródła: panel kupca (Propozycje asortymentowe, Szczegóły, Zapisane, Dostawcy,
// Mój profil) i treść mailingu PreConnect.
export default {
  pl: {
    eyebrow: "PreConnect · instrukcja dla kupca",
    title: "PreConnect dla kupca",
    summary: "Jak przeglądać propozycje asortymentowe dostawców, korzystać z kategorii i zapisanych propozycji, rozumieć powiadomienia e-mail i kontaktować się z dostawcą.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "czym-jest",
        title: "Czym jest PreConnect dla kupca",
        intro: "PreConnect to część panelu Fresh Market B2B, w której dostawcy kierują do Twojej sieci **propozycje asortymentowe**: konkretne produkty z opisem, zdjęciami, specyfikacją, logistyką i certyfikatami. Propozycje są wcześniej sprawdzane przez organizatora.",
        steps: [
          "Dostawca wysyła propozycję do Twojej sieci, organizator ją zatwierdza.",
          "Propozycja pojawia się w Twoim panelu w zakładce **Propozycje asortymentowe** i jest dołączana do najbliższego mailingu PreConnect (raz w miesiącu, w pierwszy wtorek).",
          "Przeglądasz, zapisujesz interesujące propozycje i kontaktujesz się z dostawcą bezpośrednio z aplikacji.",
        ],
      },
      {
        id: "logowanie",
        title: "Logowanie",
        steps: [
          "W mailingu PreConnect przy każdej propozycji jest przycisk, który **bezpiecznie loguje Cię linkiem** i otwiera tę propozycję w aplikacji. Link jest przypisany do Twojego adresu e-mail — nie przekazuj go dalej.",
          "Możesz też wejść na stronę logowania panelu i poprosić o nowy link na swój adres.",
          "Jeśli wolisz hasło, ustaw je w **Mój profil → Zmiana hasła**. Jeśli nie znasz obecnego hasła, użyj opcji „Ustaw nowe” — działa, gdy jesteś zalogowany linkiem z e-maila.",
        ],
      },
      {
        id: "propozycje",
        title: "Przeglądanie propozycji (Propozycje asortymentowe)",
        intro: "Lista pokazuje propozycje skierowane do Twojej sieci. Każda karta mówi, kto za nią stoi: typ firmy, kraj, certyfikaty, zdjęcia, minimalne zamówienie i czas realizacji.",
        steps: [
          "Na **Dashboardzie** widzisz liczbę nowych propozycji czekających na przeczytanie i skrót do listy.",
          "Na liście użyj filtrów: **Z certyfikatami**, **Ze zdjęciami**, **Zapisane**, **Typ firmy** oraz filtrów kategorii (owoce, warzywa, kwiaty).",
          "Oznaczenia na kartach: **Nowa** (jeszcze nieotwarta), **Premium** (pozycja wyróżniona przez dostawcę), **Bio**, ostrzeżenia o braku certyfikatów lub zdjęć.",
          "Kliknij **Szczegóły**, aby otworzyć pełną propozycję.",
        ],
      },
      {
        id: "szczegoly",
        title: "Szczegóły propozycji",
        steps: [
          "Sekcje: identyfikacja produktu, co wyróżnia dostawcę, zdjęcia, specyfikacja jakościowa (lub parametry kwiatowe), dostępność i wolumen, opakowanie i paletyzacja, logistyka i reklamacje, certyfikaty i identyfikowalność, cena orientacyjna i warunki handlowe, bezpieczeństwo współpracy.",
          "Cena, jeśli jest podana, ma charakter **orientacyjny** i wymaga potwierdzenia z dostawcą.",
          "Karta **Dostawca** pokazuje skrót profilu firmy; przycisk **Pełny profil dostawcy** otwiera cały profil z materiałami i certyfikatami.",
          "Przycisk **Zapisz propozycję** dodaje ją do zakładki Zapisane; „Zapisana ✓” — usuwa z zapisanych.",
        ],
      },
      {
        id: "kategorie",
        title: "Kategorie",
        intro: "Każdy kupiec ma w systemie przypisane kategorie, za które odpowiada (np. owoce, warzywa, kwiaty). Ustawia je organizator przy koncie kupca.",
        steps: [
          "Dostawcy widzą Twoje kategorie przy wyborze sieci — to dla nich wskazówka, do kogo kierować propozycję.",
          "W panelu widzisz propozycje skierowane do Twojej sieci; do zawężenia listy użyj filtrów kategorii.",
          "Jeśli Twoje kategorie są nieaktualne albo w sieci powinien odbierać propozycje inny kupiec, napisz do organizatora (czat lub kontakt w panelu).",
        ],
      },
      {
        id: "powiadomienia",
        title: "Powiadomienia e-mail i status odczytu",
        steps: [
          "Mailing PreConnect przychodzi z adresu newsletter@freshmarket.eu i zawiera propozycje dołączone od ostatniego mailingu. W **Mój profil → Subskrypcja mailingowa** widzisz datę następnego mailingu i możesz wycofać zgodę.",
          "**Otwarcie e-maila z mailingu albo wejście na listę propozycji w aplikacji (Propozycje asortymentowe lub Zapisane) oznacza propozycje jako odczytane** — wszystkie nowe propozycje na liście naraz, bez otwierania szczegółów. Dostawca widzi w swoim panelu tylko ten fakt — bez Twoich danych.",
          "Propozycje nieotwarte w ciągu 14 dni od mailingu wygasają po stronie dostawcy; w Twoim panelu nadal możesz je obejrzeć w historii listy.",
        ],
      },
      {
        id: "kontakt",
        title: "Kontakt z dostawcą",
        intro: "Kontakt odbywa się poza aplikacją — e-mailem na kontakt handlowy dostawcy. Aplikacja tylko przygotowuje wiadomość.",
        steps: [
          "W szczegółach propozycji w sekcji **Możliwe działania** wybierz: Poproś o próbkę, Poproś o specyfikację, Zapytaj o cenę i wolumen, Umów rozmowę, Program sezonowy lub Spotkanie na Fresh Market.",
          "Otworzy się Twój program pocztowy z gotowym tematem i treścią; uzupełnij ją i wyślij.",
          "Jeśli dostawca nie podał kontaktu handlowego z e-mailem, zobaczysz komunikat o braku danych; pozostałe dane kontaktowe, jeśli są, znajdziesz w karcie **Kontakt z dostawcą**.",
        ],
      },
      {
        id: "dostawcy",
        title: "Baza dostawców (Dostawcy)",
        steps: [
          "Zakładka **Dostawcy** to pomocnicza baza wszystkich zweryfikowanych firm: certyfikaty, kraje, produkty, liczba aktywnych propozycji.",
          "Szukaj po nazwie, filtruj po kraju i kategorii, kliknij **Zobacz profil**.",
          "Po główne propozycje produktowe wróć do zakładki Propozycje asortymentowe.",
        ],
      },
      {
        id: "profil",
        figure: { src: "/instrukcje/preconnect-kupiec-profil.jpg", alt: "Mój profil kupca: dane, subskrypcja mailingowa, zmiana hasła", caption: "Mój profil (konto testowe): dane, zgoda na mailing z datą następnej wysyłki, zmiana hasła." },
        title: "Mój profil",
        steps: [
          "Zmieniasz imię i nazwisko, stanowisko i telefon. Sieć handlowa i adres e-mail są przypisane przez organizatora.",
          "**Subskrypcja mailingowa**: zgoda na mailing PreConnect i data następnej wysyłki.",
          "**Zmiana hasła**: nowe hasło musi mieć co najmniej 8 znaków.",
        ],
      },
      {
        id: "pomoc",
        title: "Pomoc",
        steps: [
          "Pytania i błędne dane zgłaszasz organizatorowi przez czat w prawym dolnym rogu panelu albo na dane kontaktowe podane w panelu.",
        ],
      },
    ],
  },
  en: {
    eyebrow: "PreConnect · buyer guide",
    title: "PreConnect for buyers",
    summary: "How to browse suppliers' product proposals, use categories and saved proposals, understand e-mail notifications and contact a supplier.",
    updated: "2026-10-30",
    chapters: [
      {
        id: "czym-jest",
        title: "What PreConnect is for a buyer",
        intro: "PreConnect is the part of the Fresh Market B2B panel where suppliers address **product proposals** to your chain: specific products with a description, photos, specification, logistics and certificates. Proposals are checked by the organiser first.",
        steps: [
          "A supplier sends a proposal to your chain; the organiser approves it.",
          "The proposal appears in your panel under **Product proposals** and is included in the next PreConnect mailing (once a month, first Tuesday).",
          "You browse, save interesting proposals and contact the supplier directly from the app.",
        ],
      },
      {
        id: "logowanie",
        title: "Logging in",
        steps: [
          "In the PreConnect mailing each proposal has a button that **logs you in securely with a link** and opens that proposal in the app. The link is tied to your e-mail address — do not forward it.",
          "You can also go to the panel login page and request a new link to your address.",
          "If you prefer a password, set one in **My profile → Change password**. If you do not know the current password, use “Set a new one” — it works while you are logged in via the e-mail link.",
        ],
      },
      {
        id: "propozycje",
        title: "Browsing proposals (Product proposals)",
        intro: "The list shows proposals addressed to your chain. Each card tells you who is behind it: company type, country, certificates, photos, minimum order and lead time.",
        steps: [
          "On the **Dashboard** you see how many new proposals are waiting to be read and a shortcut to the list.",
          "Use the filters: **With certificates**, **With photos**, **Saved**, **Company type** and the category filters (fruit, vegetables, flowers).",
          "Card badges: **New** (not opened yet), **Premium** (position highlighted by the supplier), **Bio**, warnings about missing certificates or photos.",
          "Click **Details** to open the full proposal.",
        ],
      },
      {
        id: "szczegoly",
        title: "Proposal details",
        steps: [
          "Sections: product identification, what sets the supplier apart, photos, quality specification (or flower parameters), availability and volume, packaging and palletisation, logistics and complaints, certificates and traceability, indicative price and trade terms, cooperation safety.",
          "The price, if given, is **indicative** and must be confirmed with the supplier.",
          "The **Supplier** card shows a profile summary; **Full supplier profile** opens the whole profile with materials and certificates.",
          "**Save proposal** adds it to the Saved tab; “Saved ✓” removes it from saved.",
        ],
      },
      {
        id: "kategorie",
        title: "Categories",
        intro: "Every buyer has categories assigned in the system (e.g. fruit, vegetables, flowers). The organiser sets them on the buyer account.",
        steps: [
          "Suppliers see your categories when choosing a chain — a hint for them about whom to address.",
          "In the panel you see proposals addressed to your chain; use the category filters to narrow the list.",
          "If your categories are out of date, or another buyer in your chain should receive the proposals, write to the organiser (chat or the contact details in the panel).",
        ],
      },
      {
        id: "powiadomienia",
        title: "E-mail notifications and read status",
        steps: [
          "The PreConnect mailing comes from newsletter@freshmarket.eu and contains the proposals added since the last mailing. In **My profile → Mailing subscription** you see the date of the next mailing and can withdraw consent.",
          "**Opening the mailing e-mail or entering the proposal list in the app (Proposals or Saved) marks proposals as read** — all new proposals on the list at once, without opening the details. The supplier sees only that fact in their panel — none of your data.",
          "Proposals not opened within 14 days of the mailing expire on the supplier's side; you can still view them in your list history.",
        ],
      },
      {
        id: "kontakt",
        title: "Contacting a supplier",
        intro: "Contact takes place outside the app — by e-mail to the supplier's sales contact. The app only prepares the message.",
        steps: [
          "In the proposal details, under **Possible actions**, choose: Request a sample, Request specification, Ask for price and volume, Arrange a call, Seasonal programme or Meeting at Fresh Market.",
          "Your e-mail program opens with a ready subject and body; complete it and send.",
          "If the supplier has not provided a sales contact with an e-mail, you see a “no contact data” message; other contact details, if any, are in the **Contact with supplier** card.",
        ],
      },
      {
        id: "dostawcy",
        title: "Supplier directory (Suppliers)",
        steps: [
          "The **Suppliers** tab is an auxiliary directory of all verified companies: certificates, countries, products, number of active proposals.",
          "Search by name, filter by country and category, click **See profile**.",
          "For the main product proposals go back to the Product proposals tab.",
        ],
      },
      {
        id: "profil",
        figure: { src: "/instrukcje/preconnect-kupiec-profil.jpg", alt: "Buyer profile: data, mailing subscription, password change", caption: "My profile (test account): data, mailing consent with the next sending date, password change." },
        title: "My profile",
        steps: [
          "You change your name, position and phone. The retail chain and e-mail address are assigned by the organiser.",
          "**Mailing subscription**: consent to the PreConnect mailing and the date of the next sending.",
          "**Change password**: the new password must have at least 8 characters.",
        ],
      },
      {
        id: "pomoc",
        title: "Help",
        steps: [
          "Report questions and incorrect data to the organiser via the chat in the bottom-right corner of the panel or the contact details shown in the panel.",
        ],
      },
    ],
  },
};
