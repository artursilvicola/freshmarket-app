/**
 * Netlify Function: generate-proforma
 * POST /.netlify/functions/generate-proforma
 *
 * Body: { plan_id: string, locale?: string }
 * Headers: Authorization: Bearer <user JWT>
 *
 * [feat/bank-transfer-proforma / Poprawki Lany #2]
 *
 * Generuje fakturę proforma dla płatności PRZELEWEM:
 *   1. Weryfikuje JWT, pobiera profil + company_id.
 *   2. Wymaga NIP firmy (rozliczenia) — bez NIP nie wystawiamy proformy.
 *   3. Bierze plan z package_plans (cena Z BAZY, nigdy z body).
 *   4. Liczy netto/VAT 23%/brutto.
 *   5. Atomowo nadaje numer PF/RRRR/NNNNNN (RPC allocate_proforma_number).
 *   6. Renderuje HTML (snapshot danych firmy) i zapisuje wiersz proformas.
 *   7. Wysyła proformę mailem (Resend) i zwraca { number, html, proforma_id }.
 *
 * NIE dotyka PayU, purchase_package, packages — pakiet pozostaje
 * "oczekuje na płatność"; aktywuje go admin ręcznie po zaksięgowaniu przelewu.
 */

import { createClient } from "@supabase/supabase-js";
import { envErrorPayload, missingEnvNames, resolveEnvConfig } from "./_shared/function-env.js";
import { errLoc, resolveLocale } from "./_shared/error-messages.js";
import { renderProforma } from "./_shared/proforma-template.js";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VAT_RATE = 23; // [Lany #2] zgodne z UI (modal płatności hardcoduje 23%).

export const handler = async (event) => {
  const acceptLang = event.headers["accept-language"] || event.headers["Accept-Language"];
  let locale = resolveLocale({ acceptLanguage: acceptLang });
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors };
  if (event.httpMethod !== "POST") return json(405, { error: errLoc(locale, "method_not_allowed") });

  const env = resolveEnvConfig();
  const missing = missingEnvNames(env, ["supabaseUrl", "supabaseServiceRoleKey", "resendApiKey"]);
  if (missing.length) return json(500, envErrorPayload("generate-proforma", missing));

  // ── Auth ────────────────────────────────────────────────────────────
  const authHeader = event.headers.authorization || event.headers.Authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return json(401, { error: errLoc(locale, "no_auth_token") });

  const supaSvc = createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
  const { data: userData, error: userErr } = await supaSvc.auth.getUser(token);
  if (userErr || !userData?.user) return json(401, { error: errLoc(locale, "invalid_token") });
  const userId = userData.user.id;

  // ── Body ────────────────────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: errLoc(locale, "invalid_json") }); }
  locale = resolveLocale({ bodyLocale: body.locale, acceptLanguage: acceptLang });
  const planId = String(body.plan_id || "").trim();
  if (!planId) return json(400, { error: errLoc(locale, "missing_plan_id") });

  // ── Profil + firma ──────────────────────────────────────────────────
  const { data: profile, error: profErr } = await supaSvc
    .from("profiles")
    .select("id, email, name, role, company_id, locale, company:companies!company_id(id, name, nip, country, city)")
    .eq("id", userId)
    .maybeSingle();
  if (profErr || !profile) return json(403, { error: errLoc(locale, "profile_not_found") });
  locale = resolveLocale({ bodyLocale: body.locale, profileLocale: profile.locale, acceptLanguage: acceptLang });
  if (profile.role !== "supplier" && profile.role !== "admin") {
    return json(403, { error: errLoc(locale, "only_supplier_buy_pkg") });
  }
  const companyId = profile.company_id;
  if (!companyId) return json(400, { error: errLoc(locale, "no_company_assigned") });

  const company = profile.company || {};
  // [Lany #1+#2] NIP wymagany do rozliczeń — bez NIP nie wystawiamy proformy.
  const nip = String(company.nip || "").trim();
  if (!nip) return json(400, { error: errLoc(locale, "proforma_nip_required") });

  // ── Plan (cena z bazy) ──────────────────────────────────────────────
  const { data: plan, error: planErr } = await supaSvc
    .from("package_plans")
    .select("*")
    .eq("id", planId)
    .eq("active", true)
    .maybeSingle();
  if (planErr || !plan) return json(400, { error: errLoc(locale, "plan_not_found", { planId }) });

  // ── Kwoty ───────────────────────────────────────────────────────────
  const net = Number(plan.price_eur);
  const vat = Math.round(net * (VAT_RATE / 100) * 100) / 100;
  const gross = Math.round((net + vat) * 100) / 100;

  // ── Numer PF/RRRR/NNNNNN (atomowo) ──────────────────────────────────
  const year = new Date().getFullYear();
  const { data: seqData, error: seqErr } = await supaSvc.rpc("allocate_proforma_number", { p_year: year });
  if (seqErr || seqData == null) {
    return json(500, { error: errLoc(locale, "proforma_number_failed", { detail: seqErr?.message || "unknown" }) });
  }
  const seq = Number(seqData);
  const number = `PF/${year}/${String(seq).padStart(6, "0")}`;

  // ── Snapshot + render ───────────────────────────────────────────────
  const issuedAt = new Date().toISOString();
  const planLabel = `${plan.tier} ${plan.qty}`;
  const addressSnapshot = [company.city, company.country].filter(Boolean).join(", ");
  const { subject, html, emailIntro } = renderProforma({
    number,
    issuedAt,
    planLabel,
    qty: plan.qty,
    currency: "EUR",
    net,
    vatRate: VAT_RATE,
    vat,
    gross,
    company: { name: company.name, nip, address: addressSnapshot },
    locale,
  });

  // ── Zapis wiersza proformas ─────────────────────────────────────────
  const { data: row, error: insErr } = await supaSvc
    .from("proformas")
    .insert({
      company_id: companyId,
      number,
      year,
      seq,
      plan_id: plan.id,
      qty: plan.qty,
      currency: "EUR",
      net_amount: net,
      vat_rate: VAT_RATE,
      vat_amount: vat,
      gross_amount: gross,
      company_name_snapshot: company.name || null,
      company_nip_snapshot: nip,
      company_address_snapshot: addressSnapshot || null,
      status: "pending",
      html,
      locale,
      issued_at: issuedAt,
    })
    .select("id, number, status, issued_at, gross_amount, currency")
    .single();
  if (insErr || !row) {
    return json(500, { error: errLoc(locale, "proforma_create_failed", { detail: insErr?.message || "unknown" }) });
  }

  // ── Mail (Resend) — best effort: błąd wysyłki nie blokuje wygenerowania ──
  let emailed = false;
  try {
    const emailHtml = html.replace(
      "</body></html>",
      `<table role="presentation" width="100%"><tr><td align="center" style="padding:12px;color:#94a3b8;font-size:11px;font-family:Arial,sans-serif;">${escAttr(emailIntro)}</td></tr></table></body></html>`
    );
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Fresh Market <newsletter@freshmarket.eu>",
        to: [profile.email],
        subject,
        html: emailHtml,
      }),
    });
    emailed = resendRes.ok;
  } catch {
    emailed = false; // proforma i tak zapisana + zwracana do pobrania
  }

  return json(200, {
    proforma_id: row.id,
    number: row.number,
    status: row.status,
    gross: Number(row.gross_amount),
    currency: row.currency,
    issued_at: row.issued_at,
    html,
    emailed,
  });
};

function escAttr(value) {
  return String(value ?? "").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: { ...cors, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}
