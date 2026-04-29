/**
 * Netlify Function: send-offer
 * POST /.netlify/functions/send-offer
 * Body: { sendId: uuid }
 *
 * Wysyła ofertę mailem do kupca przez Resend.
 *
 * Wymaga ENV:
 *   - RESEND_API_KEY
 *   - SUPABASE_URL (ten sam co VITE_SUPABASE_URL)
 *   - SUPABASE_SERVICE_ROLE_KEY (UWAGA: NIE anon, tylko service_role!)
 *
 * Bezpieczeństwo: ta funkcja powinna być wywoływana tylko po stronie serwera
 * lub po dodatkowej autoryzacji (np. JWT z aplikacji). Na razie minimalna wersja.
 */

import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!RESEND_API_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Brak RESEND_API_KEY w env" }),
    };
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Brak konfiguracji Supabase (URL / SERVICE_ROLE_KEY)" }),
    };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Niepoprawny JSON" }) };
  }

  const { sendId } = body;
  if (!sendId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Brak sendId" }) };
  }

  // Klient z service_role — omija RLS (potrzebne, bo to backend)
  const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // 1. Pobierz dane wysyłki
  const { data: send, error: sErr } = await supa
    .from("sends")
    .select(`
      *,
      offer:offers(*, photos:offer_photos(*)),
      retailer:retailers(*),
      supplier:companies(*)
    `)
    .eq("id", sendId)
    .single();
  if (sErr || !send) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: "Wysyłka nie znaleziona" }),
    };
  }

  if (send.status !== "approved" && send.status !== "queued") {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: `Wysyłka ma status ${send.status} — nie wysyłam` }),
    };
  }

  // 2. Złóż HTML maila
  const html = renderEmail(send);

  // 3. Wyślij przez Resend
  const resendRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Fresh Market <oferty@freshmarket.eu>", // wymaga zweryfikowanej domeny
      to: [send.retailer.buyer_email],
      subject: `[Fresh Market] ${send.offer.title || send.offer.product}`,
      html,
    }),
  });

  if (!resendRes.ok) {
    const txt = await resendRes.text();
    return {
      statusCode: 502,
      body: JSON.stringify({ error: "Resend error", detail: txt }),
    };
  }

  // 4. Zaktualizuj status wysyłki
  await supa
    .from("sends")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", sendId);

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true }),
  };
};

function renderEmail(send) {
  const o = send.offer;
  const r = send.retailer;
  const s = send.supplier;
  const photos = (o.photos || []).slice(0, 3);

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${esc(o.title || o.product)}</title></head>
<body style="font-family:-apple-system,sans-serif;background:#f8fafc;padding:20px;color:#1e293b;">
  <div style="max-width:640px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <div style="background:#0d9488;color:white;padding:20px;">
      <div style="font-size:13px;opacity:0.85;">Fresh Market — oferta B2B</div>
      <div style="font-size:20px;font-weight:600;margin-top:4px;">${esc(o.title || o.product)}</div>
    </div>

    ${photos.length ? `
      <div style="padding:16px;display:flex;gap:8px;">
        ${photos.map((p) => `<img src="${esc(p.url)}" style="width:33%;height:120px;object-fit:cover;border-radius:8px;">`).join("")}
      </div>
    ` : ""}

    <div style="padding:20px;">
      <div style="margin-bottom:14px;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Dostawca</div>
        <div style="font-size:16px;font-weight:600;">${esc(s.name)}</div>
        <div style="font-size:13px;color:#475569;">${esc(s.country || "")} · ${esc(s.city || "")}</div>
      </div>

      <div style="margin-bottom:14px;">
        <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Produkt</div>
        <div style="font-size:14px;">${esc(o.product)} ${o.variety ? `· ${esc(o.variety)}` : ""}</div>
        <div style="font-size:13px;color:#475569;">Pochodzenie: ${esc(o.origin || "—")} ${o.region ? `(${esc(o.region)})` : ""}</div>
      </div>

      ${o.price_offer ? `
        <div style="margin-bottom:14px;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Cena</div>
          <div style="font-size:16px;font-weight:600;color:#0d9488;">
            ${esc(o.price_offer)} ${esc(o.currency || "")} / ${esc(o.price_unit || "kg")} · ${esc(o.incoterm || "")}
          </div>
        </div>
      ` : ""}

      ${o.description ? `
        <div style="margin-top:18px;padding-top:18px;border-top:1px solid #e2e8f0;">
          <div style="font-size:12px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;">Opis</div>
          <div style="font-size:14px;line-height:1.6;color:#334155;white-space:pre-wrap;">${esc(o.description)}</div>
        </div>
      ` : ""}
    </div>

    <div style="padding:16px 20px;background:#f1f5f9;font-size:12px;color:#64748b;">
      Wiadomość wysłana do ${esc(r.buyer_name)} (${esc(r.name)}) ·
      Oferta wysłana automatycznie z platformy Fresh Market.
    </div>
  </div>
</body>
</html>`;
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
