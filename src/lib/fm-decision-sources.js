// [feat/fm-decision-source] Źródło decyzji w module FM: kto ustawił wybór sieci
// dostawcy (entity "target") albo decyzję kupca (entity "resp").
// Wiersze pochodzą z tabeli fm_decision_sources (RLS: admin wszystko, dostawca
// tylko własne "target", kupiec tylko własne "resp"). Ten moduł dodatkowo pilnuje
// po stronie klienta, żeby oznaczenie nigdy nie trafiło do drugiej strony pary.
export const DECISION_SOURCES = ["supplier", "buyer", "admin", "automatic", "system"];

// { target: { [companyId]: { [retailerId]: row } }, resp: { [retailerId]: { [companyId]: row } } }
export function groupDecisionSources(rows) {
  const out = { target: {}, resp: {} };
  for (const r of rows || []) {
    if (!r || (r.entity !== "target" && r.entity !== "resp")) continue;
    const cid = String(r.company_id || ""), rid = String(r.retailer_id ?? "");
    if (!cid || !rid) continue;
    if (r.entity === "target") (out.target[cid] ||= {})[rid] = r;
    else (out.resp[rid] ||= {})[cid] = r;
  }
  return out;
}

export function targetSource(grouped, companyId, retailerId) {
  if (!grouped || companyId == null || retailerId == null) return null;
  return grouped.target?.[String(companyId)]?.[String(retailerId)] || null;
}

export function respSource(grouped, retailerId, companyId) {
  if (!grouped || companyId == null || retailerId == null) return null;
  return grouped.resp?.[String(retailerId)]?.[String(companyId)] || null;
}

export const isAdminSet = (row) => !!row && row.source === "admin";

// Filtr widoczności po roli OGLĄDAJĄCEGO konto (nie sesji): dostawca dostaje
// wyłącznie źródła własnych wyborów, kupiec wyłącznie źródła własnych decyzji,
// admin wszystko. Każda inna rola — nic.
export function sourcesVisibleTo(viewerRole, grouped, { companyId = null, retailerId = null } = {}) {
  const empty = { target: {}, resp: {} };
  if (!grouped) return empty;
  if (viewerRole === "admin") return grouped;
  if (viewerRole === "supplier") {
    const cid = String(companyId || "");
    return cid && grouped.target?.[cid] ? { target: { [cid]: grouped.target[cid] }, resp: {} } : empty;
  }
  if (viewerRole === "buyer") {
    const rid = String(retailerId ?? "");
    return rid && grouped.resp?.[rid] ? { target: {}, resp: { [rid]: grouped.resp[rid] } } : empty;
  }
  return empty;
}

// Autor i czas dla administratora. Autor: nazwa/e-mail z osadzonego profilu, a bez
// niego skrócony identyfikator; sesja serwerowa (bez autora) → placeholder z i18n.
export function formatSourceMeta(row, { locale = "pl", unknownAuthor = "—" } = {}) {
  if (!row) return { who: unknownAuthor, when: "" };
  const author = row.author || null;
  const who = author?.name || author?.email || (row.source_user_id ? String(row.source_user_id).slice(0, 8) + "…" : unknownAuthor);
  let when = "";
  if (row.source_at) {
    const d = new Date(row.source_at);
    when = Number.isNaN(d.getTime()) ? String(row.source_at) : d.toLocaleString(locale === "en" ? "en-GB" : "pl-PL", { dateStyle: "short", timeStyle: "short" });
  }
  return { who, when };
}
