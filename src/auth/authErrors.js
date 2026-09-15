// [fix/auth-magic-link-existing-only] Czytelne komunikaty błędów logowania.
// Magic link jest wysyłany wyłącznie do istniejących kont (shouldCreateUser: false);
// dla nieznanego adresu Supabase zwraca "Signups not allowed for otp" — mapujemy to
// na tekst „Nie ma konta z tym adresem…” zamiast surowego komunikatu po angielsku.
// (Wcześniej nieznany adres tworzył nowe konto bez roli i firmy — użytkownik lądował
// na ekranie „Konto bez przypisanej firmy”; tak powstały osierocone profile.)

export function isMagicLinkNoAccountError(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return /signups? not allowed/.test(msg) || /otp_disabled/.test(String(error?.code || ""));
}

// Zwraca klucz i18n (namespace "auth") albo null, gdy błąd ma zostać pokazany jak dotąd.
export function loginErrorKey(error, mode) {
  if (mode === "magic" && isMagicLinkNoAccountError(error)) return "login.magic_link_no_account";
  return null;
}
