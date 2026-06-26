/**
 * Locale-aware error message dispatcher dla Netlify functions.
 * [B2B Round prod-rollout / P2-backend-mails C3]
 *
 * Cel: user-facing błędy zwracane przez Netlify functions trafiają do EN UI
 * (admin / supplier / buyer panel) — dotychczas były hardcoded PL. Po refactor
 * UI dostaje błąd w swoim locale.
 *
 * Hierarchia locale (jak supplier-email-templates.pickLocale):
 *   1) payload.locale (z body request, frontend zna swoje UI locale)
 *   2) profile.locale (wczytane razem z innym SELECT'em jeśli backend już je ma)
 *   3) fallback 'pl'
 *
 * Klucze błędów grupujemy semantycznie — wiele funkcji używa tych samych
 * (np. "no_auth_header" → admin-create-user, admin-update-user, payu-order).
 * Reszta to klucze per-function (np. "supplier_only_packages").
 *
 * Raw Supabase / PayU error.message zostaje jako passthrough (nie tłumaczymy
 * surowych DB / payment provider błędów — admin i tak musi sięgnąć do logów).
 * Wyrażamy to przez `errCombo(locale, key, raw)` która łączy lokalny prefix
 * + raw detail.
 */

const SUPPORTED_LOCALES = ["pl", "en"];

export function pickErrLocale(input) {
  if (!input) return "pl";
  const raw = String(input).trim().toLowerCase().split(/[-_]/)[0];
  return SUPPORTED_LOCALES.includes(raw) ? raw : "pl";
}

const MESSAGES = {
  pl: {
    // ── Auth / token ──
    no_auth_header: "Brak nagłówka Authorization",
    no_auth_token: "Brak tokenu autoryzacji",
    invalid_token: "Nieprawidłowy token",
    profile_not_found: "Nie znaleziono profilu użytkownika",
    profile_no_role: "Brak profilu użytkownika",
    account_inactive: "Konto jest nieaktywne",
    account_inactive_buyer: "Konto kupca jest nieaktywne",

    // ── Role gates ──
    only_admin: "Tylko admin może wywołać tę funkcję.",
    only_admin_create_users: "Tylko admin może tworzyć konta B2B",
    only_admin_update_users: "Tylko admin może aktualizować konta B2B",
    only_admin_reset_password: "Tylko admin może resetować hasła",
    only_admin_or_supplier: "Tylko admin lub supplier może wywołać.",
    only_buyer_or_admin_mark_seen: "Tylko kupiec lub admin może oznaczyć ofertę jako zobaczoną",
    only_buyer_or_admin_mark_seen_list: "Tylko kupiec lub admin może oznaczyć oferty jako zobaczone",
    only_admin_send_batch: "Tylko admin może wysyłać zbiorcze maile do sieci.",
    only_supplier_buy_pkg: "Tylko dostawca może kupować pakiety",
    only_admin_or_supplier_ai_desc: "Ta funkcja jest dostępna tylko dla admina lub dostawcy.",
    only_admin_ai_chat: "Ta funkcja jest dostępna tylko dla administratora.",
    ai_moderation_review_failed: "Nie udało się przeanalizować propozycji przez AI.",
    no_offer_write_perm: "Brak uprawnień do zapisu propozycji",

    // ── Walidacja body ──
    invalid_json: "Niepoprawny JSON",
    missing_email: "Podaj poprawny adres email.",
    missing_email_short: "Brak email",
    missing_password: "Hasło musi mieć minimum 8 znaków.",
    missing_company_name: "Podaj nazwę firmy.",
    company_name_too_long: "Nazwa firmy jest za długa.",
    missing_nip: "Podaj NIP firmy. To pole jest wymagane do rejestracji i rozliczeń.",
    invalid_role: "Niepoprawna rola (admin/supplier/buyer)",
    supplier_needs_company: "Supplier wymaga company_id",
    buyer_needs_retailer: "Buyer wymaga retailer_id",
    buyer_needs_name: "Buyer wymaga imienia i nazwiska",
    buyer_needs_name_full: "Kupiec musi mieć imię i nazwisko.",
    buyer_needs_email: "Kupiec musi mieć adres e-mail.",
    buyer_needs_one_retailer: "Kupiec musi być przypisany do jednej sieci handlowej.",
    buyer_needs_category: "Aktywny kupiec musi mieć przynajmniej jedną kategorię.",
    retailer_not_found: "Wybrana sieć handlowa nie istnieje.",
    retailer_not_found_short: "Sieć handlowa nie znaleziona.",
    missing_user_id: "Brak user_id",
    missing_send_ids: "send_ids jest puste — nie ma czego wysłać.",
    missing_retailer_id: "Brak retailer_id",
    missing_legacy_id: "Brak / nieprawidłowy legacy_id",
    missing_template: "Brak template",
    missing_recipient: "Brak adresata maila.",
    missing_send_id: "Brak sendId",
    missing_offer_id: "Brak ID propozycji",
    missing_supplier_id: "Brak identyfikatora dostawcy",
    missing_plan_id: "Brak plan_id",
    missing_user_password_or_link: "Podaj new_password ALBO send_magic_link=true",
    missing_data_company: "Brak danych firmy do opisu.",
    missing_chat_messages: "Brak wiadomości do analizy.",

    // ── Auth state ──
    email_exists: "Konto z tym adresem email już istnieje. Spróbuj zalogować się lub odzyskać hasło.",
    buyer_email_duplicate: "Kupiec z tym adresem e-mail już istnieje.",
    user_not_found: "User nie znaleziony",
    target_profile_not_found: "Nie znaleziono profilu kupca do aktualizacji.",
    buyer_only_path: "Ta ścieżka służy tylko do zarządzania kupcami.",

    // ── Send batch ──
    no_active_buyers: "Sieć {retailerName} nie ma żadnego aktywnego kupca z e-mailem. Najpierw uzupełnij Buyer w \"Sieci\".",
    sends_read_failed: "Błąd odczytu sends: {detail}",
    no_approved_sends: "Brak propozycji gotowych do e-maila — wszystkie są odrzucone, w moderacji, odczytane albo e-mail już został wysłany.",

    // ── Send single ──
    send_not_found: "Wysyłka nie znaleziona",
    send_bad_status: "Wysyłka ma status {status} — nie wysyłam",
    resend_error: "Resend error",

    // ── PayU ──
    no_company_assigned: "Konto nie jest przypisane do firmy. Skontaktuj się z administratorem.",
    plan_not_found: "Plan {planId} nie istnieje lub jest nieaktywny",
    payu_order_register_failed: "Nie udało się zarejestrować zamówienia: {detail}",
    payu_config_error: "Konfiguracja PayU jest niepoprawna: {detail}",
    payu_currency_rate_missing:
      "Konfiguracja PayU wymaga kursu przeliczeniowego EUR na {currency}. Ustaw PAYU_EUR_TO_PAYU_RATE albo skonfiguruj POS PayU w EUR.",
    payu_currency_mismatch:
      "Waluta zamówienia nie zgadza się z walutą POS PayU. Użyta konfiguracja: {context}. Porównaj POS ID i OAuth client_id z punktem płatności REST API w PayU.",
    // ── Proforma (przelew) ──
    proforma_nip_required: "Podaj NIP firmy. To pole jest wymagane do rejestracji i rozliczeń.",
    proforma_number_failed: "Nie udało się nadać numeru proformy: {detail}",
    proforma_create_failed: "Nie udało się wygenerować proformy: {detail}",
    payu_api_error: "PayU API: {detail}",

    // ── Misc create / update failures ──
    create_user_failed: "Nie udało się utworzyć konta: {detail}",
    create_user_failed_short: "Nie udało się utworzyć usera: {detail}",
    create_company_failed: "Nie udało się utworzyć firmy: {detail}",
    create_profile_failed: "Nie udało się utworzyć profilu: {detail}",
    update_profile_after_auth_failed: "Konto utworzone, ale update profile nie powiódł się: {detail}",
    magic_link_failed: "Magic link nie wygenerowany: {detail}",
    magic_link_failed_warning: "Konto utworzone, magic link nie wygenerowany: {detail}",
    password_update_failed: "Nie udało się zaktualizować hasła: {detail}",
    auth_update_failed: "Nie udało się zaktualizować auth.users: {detail}",
    profile_after_auth_update_failed: "Auth zaktualizowany, ale profil nie: {detail}",
    duplicate_check_failed: "Nie udało się sprawdzić duplikatów kupców.",
    unknown_template: "Nieznany template: {template}",
    legacy_supplier_id_backfill_failed: "Nie udało się przygotować identyfikatora dostawcy: {detail}",
    own_company_only_ai_desc: "Dostawca może generować opis tylko dla swojej firmy.",
    method_not_allowed: "Method Not Allowed",
  },
  en: {
    // ── Auth / token ──
    no_auth_header: "Authorization header missing",
    no_auth_token: "Authorization token missing",
    invalid_token: "Invalid token",
    profile_not_found: "User profile not found",
    profile_no_role: "User profile not found",
    account_inactive: "Account is inactive",
    account_inactive_buyer: "Buyer account is inactive",

    // ── Role gates ──
    only_admin: "Only an administrator can call this function.",
    only_admin_create_users: "Only an administrator can create B2B accounts",
    only_admin_update_users: "Only an administrator can update B2B accounts",
    only_admin_reset_password: "Only an administrator can reset passwords",
    only_admin_or_supplier: "Only an administrator or supplier can call this function.",
    only_buyer_or_admin_mark_seen: "Only a buyer or administrator can mark a submission as seen",
    only_buyer_or_admin_mark_seen_list: "Only a buyer or administrator can mark submissions as seen",
    only_admin_send_batch: "Only an administrator can send batch emails to retailers.",
    only_supplier_buy_pkg: "Only a supplier can purchase packages",
    only_admin_or_supplier_ai_desc: "This function is available only to administrators or suppliers.",
    only_admin_ai_chat: "This function is available only to administrators.",
    ai_moderation_review_failed: "Could not analyse the submission with AI.",
    no_offer_write_perm: "No permission to write submission",

    // ── Walidacja body ──
    invalid_json: "Invalid JSON",
    missing_email: "Provide a valid email address.",
    missing_email_short: "Email missing",
    missing_password: "Password must be at least 8 characters.",
    missing_company_name: "Provide a company name.",
    company_name_too_long: "Company name is too long.",
    missing_nip: "Provide the company Tax ID. This field is required for registration and billing.",
    invalid_role: "Invalid role (admin/supplier/buyer)",
    supplier_needs_company: "Supplier requires company_id",
    buyer_needs_retailer: "Buyer requires retailer_id",
    buyer_needs_name: "Buyer requires a first and last name",
    buyer_needs_name_full: "Buyer must have a first and last name.",
    buyer_needs_email: "Buyer must have an email address.",
    buyer_needs_one_retailer: "Buyer must be assigned to one retailer.",
    buyer_needs_category: "An active buyer must have at least one category.",
    retailer_not_found: "Selected retailer does not exist.",
    retailer_not_found_short: "Retailer not found.",
    missing_user_id: "user_id missing",
    missing_send_ids: "send_ids is empty — nothing to send.",
    missing_retailer_id: "retailer_id missing",
    missing_legacy_id: "Missing / invalid legacy_id",
    missing_template: "template missing",
    missing_recipient: "No email recipient.",
    missing_send_id: "sendId missing",
    missing_offer_id: "Submission ID missing",
    missing_supplier_id: "Supplier identifier missing",
    missing_plan_id: "plan_id missing",
    missing_user_password_or_link: "Provide new_password OR send_magic_link=true",
    missing_data_company: "No company data to describe.",
    missing_chat_messages: "No messages to analyse.",

    // ── Auth state ──
    email_exists: "An account with this email already exists. Try signing in or recovering the password.",
    buyer_email_duplicate: "A buyer with this email already exists.",
    user_not_found: "User not found",
    target_profile_not_found: "Buyer profile to update not found.",
    buyer_only_path: "This path is only for buyer management.",

    // ── Send batch ──
    no_active_buyers: "Retailer {retailerName} has no active buyer with an email. Add a Buyer in \"Retailers\" first.",
    sends_read_failed: "Sends read error: {detail}",
    no_approved_sends: "No submissions ready for email — all are rejected, in moderation, already read, or email was already sent.",

    // ── Send single ──
    send_not_found: "Send not found",
    send_bad_status: "Send has status {status} — not sending",
    resend_error: "Resend error",

    // ── PayU ──
    no_company_assigned: "Account is not assigned to a company. Contact the administrator.",
    plan_not_found: "Plan {planId} does not exist or is inactive",
    payu_order_register_failed: "Could not register the order: {detail}",
    payu_config_error: "PayU configuration is invalid: {detail}",
    payu_currency_rate_missing:
      "PayU configuration requires an EUR to {currency} conversion rate. Set PAYU_EUR_TO_PAYU_RATE or configure the PayU POS in EUR.",
    payu_currency_mismatch:
      "The order currency does not match the PayU POS currency. Used configuration: {context}. Compare POS ID and OAuth client_id with the REST API payment point in PayU.",
    // ── Proforma (bank transfer) ──
    proforma_nip_required: "Provide the company Tax ID. This field is required for registration and billing.",
    proforma_number_failed: "Could not assign a proforma number: {detail}",
    proforma_create_failed: "Could not generate the proforma: {detail}",
    payu_api_error: "PayU API: {detail}",

    // ── Misc create / update failures ──
    create_user_failed: "Could not create the account: {detail}",
    create_user_failed_short: "Could not create the user: {detail}",
    create_company_failed: "Could not create the company: {detail}",
    create_profile_failed: "Could not create the profile: {detail}",
    update_profile_after_auth_failed: "Account created, but profile update failed: {detail}",
    magic_link_failed: "Magic link not generated: {detail}",
    magic_link_failed_warning: "Account created, magic link not generated: {detail}",
    password_update_failed: "Could not update the password: {detail}",
    auth_update_failed: "Could not update auth.users: {detail}",
    profile_after_auth_update_failed: "Auth updated, but profile did not: {detail}",
    duplicate_check_failed: "Could not check buyer duplicates.",
    unknown_template: "Unknown template: {template}",
    legacy_supplier_id_backfill_failed: "Could not prepare supplier identifier: {detail}",
    own_company_only_ai_desc: "Supplier can generate description only for their own company.",
    method_not_allowed: "Method Not Allowed",
  },
};

/**
 * Returns the localized error message.
 *
 * @param {string} locale  - 'pl' | 'en' | locale-like string. Fallback 'pl'.
 * @param {string} key     - Key from MESSAGES.<locale>.
 * @param {object} params  - Optional placeholders to interpolate ({{placeholder}}).
 * @returns {string}
 */
export function errLoc(locale, key, params = {}) {
  const lng = pickErrLocale(locale);
  const lookup = (MESSAGES[lng]?.[key]) || MESSAGES.pl[key] || key;
  let msg = lookup;
  for (const [k, v] of Object.entries(params || {})) {
    msg = msg.split(`{${k}}`).join(String(v ?? ""));
  }
  return msg;
}

/**
 * Reads locale from various sources used by Netlify functions:
 *   1) body.locale (frontend-passed)
 *   2) profile.locale (when SELECTed already)
 *   3) Accept-Language header (browser preferred)
 *   4) 'pl'
 *
 * @returns {string} normalized 'pl' | 'en'
 */
export function resolveLocale({ bodyLocale, profileLocale, acceptLanguage } = {}) {
  if (bodyLocale) return pickErrLocale(bodyLocale);
  if (profileLocale) return pickErrLocale(profileLocale);
  if (acceptLanguage) return pickErrLocale(String(acceptLanguage).split(",")[0]);
  return "pl";
}
