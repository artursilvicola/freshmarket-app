// [feat/fm-decision-source] Stan źródeł decyzji po stronie klienta: odczyt z bazy, unieważnianie
// pary przy własnej edycji, przywracanie po odrzuconym zapisie, ochrona przed spóźnionymi odczytami.
//
// Reguły (review Codexa 7f3343e):
//  - invalidate(pair): oznaczenie pary znika natychmiast, generacja odczytu rośnie (odczyt w toku
//    sprzed edycji jest odrzucany), zdjęty wiersz jest pamiętany razem z rewizją edycji;
//  - dopóki edycja pary nie jest rozliczona (settle/restore), wynik KAŻDEGO odczytu pomija tę parę
//    (odczyt mógł wystartować przed dotarciem zapisu do bazy);
//  - restore(token): zapis odrzucony → zdjęty wiersz wraca lokalnie (bez sieci), a odczyt potwierdza;
//    starsza edycja nie nadpisuje nowszej (rewizja tokenu musi być bieżąca);
//  - settle(token): zapis przyjęty → para przestaje być chroniona, pełny odczyt jest miarodajny;
//  - refetch: starsza odpowiedź nie nadpisuje nowszej; błąd = jedno ponowienie po retryMs.
import { groupDecisionSources } from "./fm-decision-sources.js";

const EMPTY = () => ({ target: {}, resp: {} });
const keyOf = (p) => `${p.entity}|${String(p.companyId)}|${String(p.retailerId)}`;

function withoutPair(grouped, p) {
  const cid = String(p.companyId), rid = String(p.retailerId);
  const next = { target: { ...(grouped?.target || {}) }, resp: { ...(grouped?.resp || {}) } };
  let removed = null;
  if (p.entity === "target" && next.target[cid]?.[rid]) { removed = next.target[cid][rid]; next.target[cid] = { ...next.target[cid] }; delete next.target[cid][rid]; }
  if (p.entity === "resp" && next.resp[rid]?.[cid]) { removed = next.resp[rid][cid]; next.resp[rid] = { ...next.resp[rid] }; delete next.resp[rid][cid]; }
  return { next, removed };
}
function withPair(grouped, p, row) {
  const cid = String(p.companyId), rid = String(p.retailerId);
  const next = { target: { ...(grouped?.target || {}) }, resp: { ...(grouped?.resp || {}) } };
  if (p.entity === "target") next.target[cid] = { ...(next.target[cid] || {}), [rid]: row };
  else next.resp[rid] = { ...(next.resp[rid] || {}), [cid]: row };
  return next;
}

export function createDecisionSourceStore({ fetchRows, onChange = () => {}, retryMs = 3000, setTimer = (fn, ms) => setTimeout(fn, ms) }) {
  let state = EMPTY();
  let req = 0;          // generacja odczytu: tylko odpowiedź bieżącej generacji trafia do stanu
  let revSeq = 0;       // rewizje edycji (globalnie rosnące)
  const pending = new Map();   // key → { rev, removed, pair } — edycje nierozliczone
  const emit = () => onChange(state);

  function invalidate(pair) {
    if (!pair?.entity || pair.companyId == null || pair.retailerId == null) return null;
    req += 1;                                   // odczyty w toku sprzed edycji: do kosza
    const k = keyOf(pair);
    const { next, removed } = withoutPair(state, pair);
    state = next;
    const prev = pending.get(k);
    const token = { key: k, rev: ++revSeq, pair };
    pending.set(k, { rev: token.rev, removed: removed || prev?.removed || null, pair });
    emit();
    return token;
  }
  function settle(token) {
    const e = token && pending.get(token.key);
    if (e && e.rev === token.rev) pending.delete(token.key);
  }
  function restore(token) {
    const e = token && pending.get(token.key);
    if (!e || e.rev !== token.rev) return false;   // nowsza edycja tej pary — starsze cofnięcie nic nie zmienia
    pending.delete(token.key);
    if (e.removed) { state = withPair(state, e.pair, e.removed); emit(); }
    return true;
  }
  function apply(rows) {
    let grouped = groupDecisionSources(rows);
    for (const e of pending.values()) grouped = withoutPair(grouped, e.pair).next;   // pary w edycji: nadal bez oznaczenia
    state = grouped;
    emit();
  }
  async function refetch({ retry = true } = {}) {
    const my = ++req;
    try {
      const rows = await fetchRows();
      if (my !== req) return false;
      apply(rows);
      return true;
    } catch (e) {
      if (my !== req) return false;
      if (retry) setTimer(() => { if (my === req) refetch({ retry: false }); }, retryMs);
      return false;
    }
  }
  // jedno wejście dla paneli: { invalidate } → token (bez odczytu), { settle|restore: token } → + odczyt, {} → odczyt
  function handle(opts = {}) {
    const { invalidate: inv = null, settle: stl = null, restore: rst = null, refetch: rf } = opts || {};
    let token = null;
    if (inv) token = invalidate(inv);
    if (stl) settle(stl);
    if (rst) restore(rst);
    const shouldFetch = rf !== undefined ? !!rf : !inv;
    if (shouldFetch) void refetch();
    return token;
  }
  return { handle, invalidate, settle, restore, refetch, getState: () => state, pendingCount: () => pending.size };
}
