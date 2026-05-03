// Tłumaczenia statycznych elementów UI (header, footer, formularze, CTA)
// Treści stron są w src/content/pages/{en,pl}/*.md
export const translations = {
  en: {
    nav: {
      how_it_works: 'How does it work?',
      reviews: 'Reviews',
      agenda: 'Agenda',
      distributors_hub: 'Distributors Hub',
      retail_chains_hub: 'Retail Chains Hub',
      participants: 'Participants',
      exhibitors_hub: 'Exhibitors Hub',
      venue: 'Venue & Plan',
      important_dates: 'Important Dates',
      gallery: 'Gallery',
      regulation: 'Regulation Fresh Market 2026',
      exhibition: 'Exhibition',
      registration: 'Registration',
      award: 'Fresh Market Award',
      contact: 'Contact',
    },
    cta: {
      register: 'Register now',
      learn_more: 'Learn more',
      contact_us: 'Contact us',
      reserve_booth: 'Reserve a booth',
    },
    footer: {
      organizer: 'Organizer',
      menu: 'Menu',
      services: 'Our services',
      copyright: '© 2008-{year} Fresh Market powered by KJOW',
      developed_by: 'Developed by',
    },
    contact_form: {
      name: 'First & last name (not required)',
      phone: 'Phone (not required)',
      email: 'Email (required)',
      message: 'Your message (required)',
      terms: 'By sending this form I accept',
      terms_link: 'Terms and Conditions',
      submit: 'Submit',
    },
    cookies: {
      message: 'This site uses cookies to ensure best experience.',
      accept: 'Accept',
      reject: 'Reject',
    },
  },
  pl: {
    nav: {
      how_it_works: 'Jak to działa?',
      reviews: 'Opinie',
      agenda: 'Program',
      distributors_hub: 'Strefa Dystrybutorów',
      retail_chains_hub: 'Strefa Sieci Handlowych',
      participants: 'Uczestnicy',
      exhibitors_hub: 'Strefa Wystawców',
      venue: 'Miejsce i plan',
      important_dates: 'Ważne daty',
      gallery: 'Galeria',
      regulation: 'Regulamin Fresh Market 2026',
      exhibition: 'Wystawa',
      registration: 'Rejestracja',
      award: 'Fresh Market Award',
      contact: 'Kontakt',
    },
    cta: {
      register: 'Zarejestruj się',
      learn_more: 'Dowiedz się więcej',
      contact_us: 'Skontaktuj się',
      reserve_booth: 'Zarezerwuj stoisko',
    },
    footer: {
      organizer: 'Organizator',
      menu: 'Menu',
      services: 'Nasze serwisy',
      copyright: '© 2008-{year} Fresh Market powered by KJOW',
      developed_by: 'Wykonanie',
    },
    contact_form: {
      name: 'Imię i nazwisko (opcjonalne)',
      phone: 'Telefon (opcjonalne)',
      email: 'Email (wymagane)',
      message: 'Twoja wiadomość (wymagane)',
      terms: 'Wysyłając formularz akceptuję',
      terms_link: 'Regulamin',
      submit: 'Wyślij',
    },
    cookies: {
      message: 'Ta strona używa plików cookies dla zapewnienia najlepszego doświadczenia.',
      accept: 'Akceptuję',
      reject: 'Odrzuć',
    },
  },
} as const;

export type Locale = keyof typeof translations;

export function t(locale: Locale) {
  return translations[locale];
}
