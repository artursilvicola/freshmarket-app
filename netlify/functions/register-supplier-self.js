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

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { error: "Niepoprawny JSON" });
  }

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
    return json(400, { error: "Podaj poprawny adres email." });
  }
  if (!password || password.length < 8) {
    return json(400, { error: "Hasło musi mieć minimum 8 znaków." });
  }
  if (!companyName || companyName.length < 2) {
    return json(400, { error: "Podaj nazwę firmy." });
  }
  if (companyName.length > 200) {
    return json(400, { error: "Nazwa firmy jest za długa." });
  }

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);

  // ── Sprawdź czy email już istnieje w profiles ──────────────────────
  const { data: existing } = await supaSvc
    .from("profiles")
    .select("id, email")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return json(409, { error: "Konto z tym adresem email już istnieje. Spróbuj zalogować się lub odzyskać hasło." });
  }

  // ── Krok 1: utwórz auth user ────────────────────────────────────────
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
    },
  });
  if (userErr || !userData?.user) {
    return json(500, { error: "Nie udało się utworzyć konta: " + (userErr?.message || "unknown") });
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
    await supaSvc.auth.admin.deleteUser(userId).catch(() => {});
    return json(500, { error: "Nie udało się utworzyć firmy: " + (coErr?.message || "unknown") });
  }

  // ── Krok 3: utwórz profile (rola supplier) ─────────────────────────
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
      },
      { onConflict: "id" }
    );
  if (profErr) {
    // Cleanup: usuń company + user
    await supaSvc.from("companies").delete().eq("id", company.id).catch(() => {});
    await supaSvc.auth.admin.deleteUser(userId).catch(() => {});
    return json(500, { error: "Nie udało się utworzyć profilu: " + profErr.message });
  }

  // ── Krok 4: wyślij maile (fire-and-forget, nie blokujemy odpowiedzi) ──
  // Mail A do supplera + powiadomienie do admina. Każdy template
  // renderuje się w supplier-email-templates.js. Wysyłka przez Resend.
  const tpls = [
    {
      template: "registration_accepted",
      to: email,
      payload: { companyName, contactName, appUrl: env.b2bAppUrl },
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
