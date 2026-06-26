/**
 * PayU REST API helpers — OAuth, base URL, order create, signature verify.
 * [B2B Round prod-rollout / faza 3]
 *
 * PayU REST docs: https://developers.payu.com/europe/docs/
 *   - OAuth (client_credentials): /pl/standard/user/oauth/authorize
 *   - Create order: /api/v2_1/orders
 *   - Notify signature: SHA-256(payload + SECOND_KEY), header OpenPayU-Signature
 */

import crypto from "node:crypto";

const MINOR_UNIT_FACTOR = {
  BIF: 1, CLP: 1, DJF: 1, GNF: 1, JPY: 1, KMF: 1, KRW: 1,
  MGA: 1, PYG: 1, RWF: 1, UGX: 1, VND: 1, VUV: 1, XAF: 1,
  XOF: 1, XPF: 1,
};

export function payuBaseUrl(env) {
  // env = 'sandbox' | 'production' | 'prod' | 'live'
  const normalized = String(env || "sandbox").trim().toLowerCase();
  return ["production", "prod", "live"].includes(normalized)
    ? "https://secure.payu.com"
    : "https://secure.snd.payu.com";
}

/**
 * Pobierz OAuth access token (client_credentials).
 * Token żyje ~12 minut. Nie cache'ujemy w functions bo każda inwokacja
 * to nowa instancja Lambda — koszt 1 dodatkowy fetch.
 */
export async function fetchPayuToken({ baseUrl, clientId, clientSecret }) {
  const tokenUrl = `${baseUrl}/pl/standard/user/oauth/authorize`;
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`PayU OAuth ${res.status}: ${detail || res.statusText}`);
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error("PayU OAuth: brak access_token w odpowiedzi");
  }
  return data.access_token;
}

export function normalizePayuCurrencyCode(value) {
  const code = String(value || "EUR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new Error(`Nieprawidlowa waluta PayU: ${value || "(pusta)"}`);
  }
  return code;
}

export function parsePositiveNumber(value, fallback = null) {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function toMinorUnits(amount, currencyCode = "EUR") {
  const factor = MINOR_UNIT_FACTOR[currencyCode] || 100;
  return String(Math.round(Number(amount) * factor));
}

export function parsePayuStatusCode(error) {
  const message = String(error?.message || error || "");
  const match = message.match(/"statusCode"\s*:\s*"([^"]+)"/);
  return match?.[1] || null;
}

/**
 * Utwórz zamówienie w PayU. Zwraca { redirectUri, orderId, extOrderId,
 * statusCode, raw } albo rzuca błąd.
 *
 * PayU domyślnie zwraca 302 z Location → redirect_uri. Z `redirect: 'manual'`
 * dostajemy 302 jako status + JSON body z `redirectUri`. To upraszcza
 * obsługę po stronie frontu (przekieruje JS-em).
 */
export async function createPayuOrder({
  baseUrl,
  accessToken,
  posId,
  customerIp,
  description,
  currencyCode,
  totalAmount,      // string, w groszach/centach (np. "60000" = 600.00 EUR)
  extOrderId,
  buyer,            // { email, firstName, lastName, phone, language }
  products,         // [{ name, unitPrice, quantity }]
  notifyUrl,
  continueUrl,
  metadata,
}) {
  const orderUrl = `${baseUrl}/api/v2_1/orders`;
  const payload = {
    notifyUrl,
    continueUrl,
    customerIp: customerIp || "127.0.0.1",
    merchantPosId: posId,
    description,
    currencyCode,
    totalAmount,
    extOrderId,
    buyer: buyer || undefined,
    products,
  };

  const res = await fetch(orderUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
    redirect: "manual",
  });

  // PayU zwraca 302 z Location → redirect_uri przy success.
  // Z `redirect: 'manual'` body JSON też ma `redirectUri`.
  // Niektóre tryby (np. card token) zwracają 200.
  const body = await readPayuBody(res);
  const json = body.json;

  if (res.status !== 200 && res.status !== 302) {
    const detail = json ? JSON.stringify(json) : body.text;
    throw new Error(`PayU createOrder ${res.status}: ${detail || res.statusText}`);
  }

  const redirectUri = json?.redirectUri || res.headers.get("location");
  const orderId = json?.orderId || null;
  const statusCode = json?.status?.statusCode || (res.status === 302 ? "SUCCESS" : null);

  if (!redirectUri) {
    const detail = json ? JSON.stringify(json) : body.text;
    throw new Error(`PayU createOrder: brak redirectUri w odpowiedzi (${detail || `HTTP ${res.status}`})`);
  }

  return {
    redirectUri,
    orderId,
    extOrderId,
    statusCode,
    raw: {
      request: { ...payload, metadata },
      response: json,
      httpStatus: res.status,
      location: res.headers.get("location"),
    },
  };
}

async function readPayuBody(res) {
  const text = await res.text().catch(() => "");
  if (!text) return { text: "", json: null };
  try {
    return { text, json: JSON.parse(text) };
  } catch {
    return { text, json: null };
  }
}

/**
 * Weryfikuj sygnaturę PayU z headera OpenPayU-Signature.
 * Format: "sender=...;signature=<hex>;algorithm=SHA-256;content=DOCUMENT"
 *
 * Sygnatura = SHA-256(raw_body + SECOND_KEY) hex.
 */
export function verifyPayuSignature({ rawBody, signatureHeader, secondKey }) {
  if (!signatureHeader || !rawBody || !secondKey) return false;

  const parts = signatureHeader.split(";").reduce((acc, p) => {
    const [k, v] = p.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});

  const sig = parts.signature;
  const algo = (parts.algorithm || "SHA-256").toUpperCase();
  if (!sig) return false;
  if (algo !== "SHA-256" && algo !== "SHA256" && algo !== "MD5") return false;

  const hashAlgo = algo === "MD5" ? "md5" : "sha256";
  const computed = crypto.createHash(hashAlgo).update(rawBody + secondKey, "utf8").digest("hex");
  // constant-time compare
  return crypto.timingSafeEqual(
    Buffer.from(computed, "hex"),
    Buffer.from(sig, "hex")
  );
}
