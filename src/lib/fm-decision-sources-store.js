// [feat/fm-decision-source] Stan źródeł decyzji po stronie klienta: odczyt z bazy, unieważnianie
// pary przy własnej edycji, rozliczanie KAŻDEGO zapisu z osobna, ochrona przed spóźnionymi odczytami.
//
// Model (review Codexa 7f3343e i a75ca3f):
//  - `confirmed` = ostatni stan potwierdzony przez bazę: pełny odczyt ORAZ każdy przyjęty zapis
//    (przyjęty zapis użytkownika = źródło użytkownika = brak oznaczenia dla tej pary);
//  - `pending` = nierozliczone edycje par: lista rewizji (po jednej na kliknięcie);
//  - widok = confirmed bez par z nierozliczonymi edycjami (optymistycznie: bez oznaczenia);
//  - invalidate(pair) → token {rev}: para znika z widoku, generacja odczytu rośnie (odczyt w toku
//    sprzed edycji jest odrzucany);
//  - settle(token): zapis TEJ edycji przyjęty → confirmed bez tej pary, rewizja zdjęta z listy;
//    starszy przyjęty zapis nie nadpisuje nowszej edycji (nowsze rewizje zostają nierozliczone),
//    ale zmienia podstawę ewentualnego przywrócenia;
//  - restore(token): zapis TEJ edycji odrzucony → rewizja zdjęta z listy; gdy nie ma innych
//    nierozliczonych edycji pary, widok wraca do `confirmed` (lokalnie, bez sieci);
//  - settle/restore zwiększają generację odczytu: odczyt rozpoczęty przed rozliczeniem nie może
//    nadpisać potwierdzonego stanu; panel po rozliczeniu uruchamia świeży odczyt;
//  - refetch: starsza odpowiedź nie nadpisuje nowszej; błąd = jedno ponowienie po retryMs.
import { groupDecisionSources } from "./fm-decision-sources.js";

const EMPTY = () => ({ target: {}, resp: {} });
const keyOf = (p) => `${p.entity}|${String(p.companyId)}|${String(p.retailerId)}`;

function withoutPair(grouped, p) {
  const cid = String(p.companyId), rid = String(p.retailerId);
  const next = { target: { ...(grouped?.target || {}) }, resp: { ...(grouped?.resp || {}) } };
  if (p.entity === "target" && next.target[cid]?.[rid]) { next.target[cid] = { ...next.target[cid] }; delete next.target[cid][rid]; }
  if (p.entity === "resp" && next.resp[rid]?.[cid]) { next.resp[rid] = { ...next.resp[rid] }; delete next.resp[rid][cid]; }
  return next;
}

export function createDecisionSourceStore({ fetchRows, onChange = () => {}, retryMs = 3000, setTimer = (fn, ms) => setTimeout(fn, ms) }) {
  let confirmed = EMPTY();
  let req = 0;          // generacja odczytu: tylko odpowiedź bieżącej generacji trafia do stanu
  let revSeq = 0;       // rewizje edycji (globalnie rosnące)
  const pending = new Map();   // key → { pair, revs: number[] }
  const view = () => { let g = confirmed; for (const e of pending.values()) g = withoutPair(g, e.pair); return g; };
  const emit = () => onChange(view());

  function invalidate(pair) {
    if (!pair?.entity || pair.companyId == null || pair.retailerId == null) return null;
    req += 1;                                   // odczyty w toku sprzed edycji: do kosza
    const k = keyOf(pair);
    const rev = ++revSeq;
    const e = pending.get(k) || { pair, revs: [] };
    e.revs.push(rev);
    pending.set(k, e);
    emit();
    return { key: k, rev, pair };
  }
  function drop(token) {
    const e = token && pending.get(token.key);
    if (!e || !e.revs.includes(token.rev)) return null;
    e.revs = e.revs.filter(r => r !== token.rev);
    if (!e.revs.length) pending.delete(token.key);
    req += 1;                                   // odczyt rozpoczęty przed rozliczeniem nie nadpisze potwierdzonego stanu
    return e;
  }
  function settle(token) {
    const e = drop(token);
    if (!e) return false;
    confirmed = withoutPair(confirmed, e.pair);   // baza ma teraz źródło użytkownika → podstawa bez oznaczenia
    emit();
    return true;
  }
  function restore(token) {
    if (!drop(token)) return false;
    emit();                                     // bez innych nierozliczonych edycji para wraca do stanu potwierdzonego
    return true;
  }
  function apply(rows) { confirmed = groupDecisionSources(rows); emit(); }
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
  return { handle, invalidate, settle, restore, refetch, getState: () => view(), pendingCount: () => pending.size };
}
