/**
 * Netlify Function: register-supplier-self
 * POST /.netlify/functions/register-supplier-self
 * Body: {
 *   email, password, company_name, country, contact_name?, contact_phone?, nip?,
 *   accepted_terms_version?, accepted_privacy_version?
 * }
 *
 * [B2B Round supplier-onboarding-access-and-communication]
 *
 * Publiczny endpoint do self-registration dostawcy. Tworzy:
 *   1. auth.users (przez admin.createUser z service_role) — pomijamy
 *      wymóg emailConfirmation żeby supplier mógł od razu się zalogować,
 *   2. companies (account_status='pending_review' + preconnect_enabled=false
 *      + fm_b2b_enabled=false),
 *   3. profiles (role='supplier', company_id=new, active=true),
 *   4. wysyła mail "registration_accepted" do supplera + "admin_new_registration"
 *      do adminskiego mailboxa.
 *
 * Anti-spam (MVP):
 *   - walidacja formatu email + długości pól,
 *   - sprawdzenie, czy email już istnieje w profiles → konflikt 409.
 *
 * Bezpieczeństwo: endpoint jest publiczny (no auth), ale używa service_role
 * tylko do CRUD na companies/profiles. Nie eksponuje kluczy.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { pickTemplate } from "./_shared/supplier-email-templates.js";
import { errLoc } from "./_shared/error-messages.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export const handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: "Method Not Allowed" });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "resendApiKey"]);
  if (missing.length) return json(500, envErrorPayload("register-supplier-self", missing));

  // [P2-backend-mails C3] locale dla błędów zwracanych w body — używamy
  // body.locale, jeśli podane. Walidacja niżej. Errors są tłumaczone przez
  // errLoc(locale, key) — fallback 'pl' jeśli locale brak / inny.
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    // [P2-backend-mails C3] błąd parsowania → nie znamy locale, fallback 'pl'.
    return json(400, { error: errLoc("pl", "invalid_json") });
  }

  // [B2B Round prod-rollout / i18n MVP — Krok 3b]
  // Walidacja locale — przyjmujemy tylko obsługiwane języki (pl/en).
  // Brak / nieprawidłowa wartość → domyślnie 'pl'. Lista języków zsynchronizowana
  // z src/i18n/locale.js SUPPORTED_LOCALES — gdy dodajemy nowy język, trzeba
  // zaktualizować obie listy. Backend NIE robi automatycznej walidacji przez
  // CHECK constraint w DB (świadomie — patrz migracja 036).
  const SUPPORTED_LOCALES = ["pl", "en"];
  const rawLocale = String(body.locale || "pl").trim().toLowerCase().split(/[-_]/)[0];
  const locale = SUPPORTED_LOCALES.includes(rawLocale) ? rawLocale : "pl";

  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const companyName = String(body.company_name || "").trim();
  const country = String(body.country || "PL").trim().toUpperCase();
  const contactName = String(body.contact_name || "").trim();
  const contactPhone = String(body.contact_phone || "").trim();
  const nip = String(body.nip || "").trim();
  const acceptedTermsVersion = String(body.accepted_terms_version || "1.0").trim();
  const acceptedPrivacyVersion = String(body.accepted_privacy_version || "1.0").trim();
  const acceptedAt = new Date().toISOString();

  // ── Walidacja ──────────────────────────────────────────────────────
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(400, { error: errLoc(locale, "missing_email") });
  }
  if (!password || password.length < 8) {
    return json(400, { error: errLoc(locale, "missing_password") });
  }
  if (!companyName || companyName.length < 2) {
    return json(400, { error: errLoc(locale, "missing_company_name") });
  }
  if (companyName.length > 200) {
    return json(400, { error: errLoc(locale, "company_name_too_long") });
  }

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

  // ── Sprawdź czy email już istnieje w profiles ──────────────────────
  const { data: existing } = await supaSvc
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return json(409, { error: errLoc(locale, "email_exists") });
  }

  // ── Krok 1: utwórz auth user ────────────────────────────────────────
  // [B2B Round prod-rollout / i18n MVP — Krok 3b]
  // locale w user_metadata żeby Supabase Auth template (welcome, password reset)
  // mógł odczytać preferowany język nowego usera. Resend transactional używa
  // tego samego locale dla maili welcome/registration_accepted niżej.
  const { data: userData, error: userErr } = await supaSvc.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // pomijamy email verification dla MVP — admin i tak musi zatwierdzić
    user_metadata: {
      role: "supplier",
      company_name: companyName,
      accepted_terms_version: acceptedTermsVersion,
      accepted_privacy_version: acceptedPrivacyVersion,
      accepted_at: acceptedAt,
      locale,
    },
  });
  if (userErr || !userData?.user) {
    return json(500, { error: errLoc(locale, "create_user_failed", { detail: userErr?.message || "unknown" }) });
  }
  const userId = userData.user.id;

  // ── Krok 2: utwórz company w stanie pending_review ──────────────────
  const { data: company, error: coErr } = await supaSvc
    .from("companies")
    .insert({
      name: companyName,
      country,
      nip: nip || null,
      phone: contactPhone || null,
      account_status: "pending_review",
      preconnect_enabled: false,
      fm_b2b_enabled: false,
    })
    .select()
    .single();
  if (coErr || !company) {
    // Cleanup: usuń auth usera, żeby nie zostawić ducha
    try {
      await supaSvc.auth.admin.deleteUser(userId);
    } catch {
      // Best effort cleanup. Pierwotny błąd zwracamy niżej.
    }
    return json(500, { error: errLoc(locale, "create_company_failed", { detail: coErr?.message || "unknown" }) });
  }

  // ── Krok 3: utwórz profile (rola supplier) ─────────────────────────
  // [B2B Round prod-rollout / i18n MVP — Krok 3b]
  // locale zapisujemy tutaj — defaultem migracji 036 jest 'pl', ale jeśli user
  // przed rejestracją przełączył język na 'en', tutaj wpisujemy 'en' żeby od razu
  // mieć właściwą wartość (zamiast czekać na pierwszy login + pending sync).
  const { error: profErr } = await supaSvc
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        role: "supplier",
        name: contactName || null,
        phone: contactPhone || null,
        company_id: company.id,
        active: true,
        fm26_active: false,
        accepted_terms_version: acceptedTermsVersion,
        accepted_privacy_version: acceptedPrivacyVersion,
        accepted_at: acceptedAt,
        locale,
      },
      { onConflict: "id" }
    );
  if (profErr) {
    // Cleanup: usuń company + user
    try {
      await supaSvc.from("companies").delete().eq("id", company.id);
    } catch {
      // Best effort cleanup. Pierwotny błąd zwracamy niżej.
    }
    try {
      await supaSvc.auth.admin.deleteUser(userId);
    } catch {
      // Best effort cleanup. Pierwotny błąd zwracamy niżej.
    }
    return json(500, { error: errLoc(locale, "create_profile_failed", { detail: profErr.message }) });
  }

  // ── Krok 4: wyślij maile (fire-and-forget, nie blokujemy odpowiedzi) ──
  // Mail A do supplera + powiadomienie do admina. Każdy template
  // renderuje się w supplier-email-templates.js. Wysyłka przez Resend.
  //
  // [B2B Round prod-rollout / i18n MVP — Krok 6]
  // Welcome mail do supplera idzie w jego języku (locale z body request,
  // walidowane wyżej do 'pl'|'en' z fallback do 'pl'). Admin notification
  // ZOSTAJE PL — to mail do zespołu Fresh Market (newsletter@freshmarket.eu),
  // operacyjnie używamy polskiego niezależnie od locale supplera.
  const tpls = [
    {
      template: "registration_accepted",
      to: email,
      payload: { companyName, contactName, appUrl: env.b2bAppUrl, locale },
    },
    {
      template: "admin_new_registration",
      to: "newsletter@freshmarket.eu",
      payload: { companyName, contactEmail: email, country, appUrl: env.b2bAppUrl },
    },
  ];
  const emailResults = await Promise.all(
    tpls.map(async ({ template, to, payload }) => {
      const tpl = pickTemplate(template, payload);
      if (!tpl) return { template, ok: false, error: "no_template" };
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.resendApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Fresh Market <newsletter@freshmarket.eu>",
            to: [to],
            subject: tpl.subject,
            html: tpl.html,
          }),
        });
        if (!res.ok) {
          const detail = await res.text();
          return { template, ok: false, status: res.status, detail };
        }
        const r = await res.json().catch(() => ({}));
        return { template, ok: true, message_id: r.id || null };
      } catch (e) {
        return { template, ok: false, error: e?.message || String(e) };
      }
    })
  );

  return json(200, {
    ok: true,
    user_id: userId,
    company_id: company.id,
    account_status: "pending_review",
    accepted_terms_version: acceptedTermsVersion,
    accepted_privacy_version: acceptedPrivacyVersion,
    accepted_at: acceptedAt,
    message: "Konto utworzone, czeka na zatwierdzenie przez administratora.",
    emails: emailResults,
  });
};

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
