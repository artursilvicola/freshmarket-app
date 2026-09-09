// [feat/fm-queue] Warstwa danych modułu kolejek / numerków (migracja 053).
// Zmiany STANU kolejki idą wyłącznie przez RPC SECURITY DEFINER (fm_queue_*);
// konfiguracja (grupy, stanowiska, obsługa) — zwykłe zapytania pod RLS admina.
// Wszystkie funkcje są odporne na brak tabel (przed aplikacją 053): zwracają
// puste dane zamiast wywalać aplikację.
import { supabase } from "./supabase";

const MISSING_RE = /relation .* does not exist|Could not find the (table|function)|schema cache/i;
function softFail(error, fallback) {
  if (error && MISSING_RE.test(error.message || "")) return fallback;
  if (error) throw error;
  return fallback;
}

export function newIdemKey() {
  return (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

// ── pojemność dla algorytmu ──────────────────────────────────────────────────
// { [retailerId]: { stations, capacity, groups } } — suma po AKTYWNYCH grupach
// i AKTYWNYCH stanowiskach danej sieci (split: Dino Owoce + Dino Kwiaty).
export async function getFmQueueCapacityByRetailer(eventDate = null) {
  let q = supabase.from("fm_queue_groups").select("id,retailer_id,event_date,active,meetings_per_station,fm_stations(id,active)");
  if (eventDate) q = q.eq("event_date", eventDate);
  const { data, error } = await q;
  if (error) return softFail(error, {});
  const rows = data || [];
  // bez event_date bierzemy najnowszy dzień, który ma jakąkolwiek konfigurację
  const maxDate = rows.reduce((m, r) => (r.event_date > m ? r.event_date : m), "");
  const out = {};
  for (const g of rows) {
    if (!g.active || (maxDate && g.event_date !== maxDate)) continue;
    const st = (g.fm_stations || []).filter(s => s.active).length;
    if (!st) continue;
    const cur = out[g.retailer_id] || { stations: 0, capacity: 0, groups: 0 };
    cur.stations += st;
    cur.capacity += st * Number(g.meetings_per_station || 0);
    cur.groups += 1;
    out[g.retailer_id] = cur;
  }
  return out;
}

// ── konfiguracja (admin) ─────────────────────────────────────────────────────
export async function listFmQueueGroups(eventDate) {
  let q = supabase.from("fm_queue_groups")
    .select("*, fm_stations(*), retailers(id,name,fm26_chain_id,fm_gate)")
    .order("retailer_id").order("label");
  if (eventDate) q = q.eq("event_date", eventDate);
  const { data, error } = await q;
  if (error) return softFail(error, []);
  return (data || []).map(g => ({ ...g, fm_stations: (g.fm_stations || []).sort((a, b) => a.idx - b.idx) }));
}

export async function upsertFmQueueGroup(row) {
  const allowed = ["id", "event_date", "retailer_id", "label", "categories", "gate", "meetings_per_station", "active"];
  const clean = {};
  for (const k of allowed) if (row[k] !== undefined) clean[k] = row[k];
  if (clean.label === "") clean.label = null;
  const { data, error } = await supabase.from("fm_queue_groups").upsert(clean).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFmQueueGroup(id) {
  const { error } = await supabase.from("fm_queue_groups").delete().eq("id", id);
  if (error) throw error;
}

export async function upsertFmStation(row) {
  const allowed = ["id", "queue_group_id", "idx", "label", "active"];
  const clean = {};
  for (const k of allowed) if (row[k] !== undefined) clean[k] = row[k];
  const { data, error } = await supabase.from("fm_stations").upsert(clean).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFmStation(id) {
  const { error } = await supabase.from("fm_stations").delete().eq("id", id);
  if (error) throw error;
}

export async function getFmQueueSettings(eventDate) {
  const { data, error } = await supabase.from("fm_queue_settings").select("*").eq("event_date", eventDate).maybeSingle();
  if (error) return softFail(error, null);
  return data;
}

export async function saveFmQueueSettings(row) {
  const allowed = ["event_date", "board_rotation_s", "board_items_per_page", "board_pinned_group_ids"];
  const clean = {};
  for (const k of allowed) if (row[k] !== undefined) clean[k] = row[k];
  const { data, error } = await supabase.from("fm_queue_settings").upsert(clean).select().single();
  if (error) throw error;
  return data;
}

// ── obsługa (admin) ──────────────────────────────────────────────────────────
export async function listFmStaff(eventDate) {
  let q = supabase.from("fm_staff").select("*, fm_queue_assignments(queue_group_id)").order("code");
  if (eventDate) q = q.eq("event_date", eventDate);
  const { data, error } = await q;
  if (error) return softFail(error, []);
  return data || [];
}

export async function updateFmStaff(id, patch) {
  const allowed = ["display_name", "active", "blocked", "device_label"];
  const clean = {};
  for (const k of allowed) if (patch[k] !== undefined) clean[k] = patch[k];
  const { data, error } = await supabase.from("fm_staff").update(clean).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function listFmQueueLog(eventDate, limit = 500) {
  const { data, error } = await supabase.from("fm_queue_log")
    .select("*").order("id", { ascending: false }).limit(limit);
  if (error) return softFail(error, []);
  return data || [];
}

// [review 8.09 — P2] Odczyty listy też mają limit czasu (jak RPC): wiszące Data API przy
// działającym Wi-Fi musi skończyć się BŁĘDEM sieciowym, a nie cichym czekaniem — panel
// oznacza wtedy dane jako nieaktualne zamiast pokazywać stary stan jako świeży.
const READ_TIMEOUT_MS = 10_000;
function readSignal(timeoutMs = READ_TIMEOUT_MS) {
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(timeoutMs);
  } catch { /* starsza przegladarka — bez limitu */ }
  return null;
}
function readError(err) {
  const e = new Error(/abort|timeout/i.test(String(err?.name || err?.message)) ? "read timeout" : (err?.message || "read error"));
  e.network = true;
  return e;
}

// spotkania grupy (admin / przypisany operator — RLS)
export async function listFmQueueMeetings(groupId, { timeoutMs = READ_TIMEOUT_MS } = {}) {
  let q = supabase.from("fm_queue_meetings")
    .select("*, companies(name)").eq("queue_group_id", groupId).order("nr");
  const sig = readSignal(timeoutMs);
  if (sig) q = q.abortSignal(sig);
  let res;
  try { res = await q; } catch (err) { throw readError(err); }
  const { data, error } = res;
  if (error) {
    if (/abort|timeout|PGRST003|upstream|fetch/i.test(`${error.code || ""} ${error.message || ""}`)) throw readError(error);
    return softFail(error, []);
  }
  return data || [];
}

// [feat/staff-meeting-list] stanowiska grupy — etykiety w liście spotkań („na którym stanowisku”
// przy wspólnej kolejce Auchan ×2). SELECT dla zalogowanych (fm_stations_auth_select), bez nazw firm.
export async function listFmStations(groupId, { timeoutMs = READ_TIMEOUT_MS } = {}) {
  let q = supabase.from("fm_stations")
    .select("id,idx,label,active").eq("queue_group_id", groupId).order("idx");
  const sig = readSignal(timeoutMs);
  if (sig) q = q.abortSignal(sig);
  let res;
  try { res = await q; } catch (err) { throw readError(err); }
  const { data, error } = res;
  if (error) return softFail(error, []);
  return data || [];
}

// dostawca: własne spotkania (RLS company_id = app_company_id()) — WYŁĄCZNIE z dnia produkcyjnego
// (fm_settings.event_date). Spotkania z dni testowych (próba generalna na kopii planu, 21–22.09)
// nie mogą trafić do uczestników. Bez znanej daty nie zwracamy nic: lepiej brak karty niż
// próbny numer pokazany dostawcy jako prawdziwy. [fix/fm-queue-day-scoping]
export async function listMyFmQueueMeetings(eventDate) {
  if (!eventDate) return [];
  const { data, error } = await supabase.from("fm_queue_meetings")
    .select("id,nr,status,queue_group_id,called_at,started_at,ended_at,return_after_nr,fm_queue_groups!inner(event_date)")
    .eq("fm_queue_groups.event_date", eventDate).order("nr");
  if (error) return softFail(error, []);
  return data || [];
}

// ── RPC ──────────────────────────────────────────────────────────────────────
// Kazde RPC ma limit czasu (domyslnie 10 s): gdy Data API nie odpowiada (np. wyczerpana pula
// polaczen — PGRST003 / "upstream request timeout"), tablet dostaje blad sieciowy i ponawia
// z TYM SAMYM kluczem idempotencji zamiast wisiec do timeoutu bramy (60 s).
export const RPC_TIMEOUT_MS = 10_000;
async function rpc(name, params, { timeoutMs = RPC_TIMEOUT_MS } = {}) {
  let q = supabase.rpc(name, params);
  try {
    if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") q = q.abortSignal(AbortSignal.timeout(timeoutMs));
  } catch { /* starsza przegladarka — bez limitu */ }
  let res;
  try {
    res = await q;
  } catch (err) {
    const e = new Error(/abort|timeout/i.test(String(err?.name || err?.message)) ? "network timeout" : (err?.message || "network error"));
    e.fmCode = null; e.network = true;
    throw e;
  }
  const { data, error } = res;
  if (error) {
    const e = new Error(error.message || name);
    e.code = error.code;
    e.fmCode = /FM_[A-Z_]+/.exec(error.message || "")?.[0] || null;
    e.network = /abort|timeout|PGRST003|upstream/i.test(`${error.code || ""} ${error.message || ""}`);
    throw e;
  }
  return data;
}

export const fmQueueRpc = {
  myStations:       (eventDate = null) => rpc("fm_queue_my_stations", { p_event_date: eventDate }),
  stationState:     (stationId) => rpc("fm_queue_station_state", { p_station_id: stationId }),
  openStation:      (stationId, version, idem = newIdemKey()) => rpc("fm_queue_open_station", { p_station_id: stationId, p_expected_version: version, p_idem: idem }),
  callNext:         (stationId, version, idem = newIdemKey()) => rpc("fm_queue_call_next", { p_station_id: stationId, p_expected_version: version, p_idem: idem }),
  start:            (stationId, version, idem = newIdemKey()) => rpc("fm_queue_start", { p_station_id: stationId, p_expected_version: version, p_idem: idem }),
  finishAndCallNext:(stationId, version, callNext = true, idem = newIdemKey()) => rpc("fm_queue_finish_and_call_next", { p_station_id: stationId, p_expected_version: version, p_idem: idem, p_call_next: callNext }),
  noShow:           (stationId, version, idem = newIdemKey()) => rpc("fm_queue_no_show", { p_station_id: stationId, p_expected_version: version, p_idem: idem }),
  skip:             (meetingId, idem = newIdemKey()) => rpc("fm_queue_skip", { p_meeting_id: meetingId, p_idem: idem }),
  markReturned:     (meetingId, idem = newIdemKey()) => rpc("fm_queue_mark_returned", { p_meeting_id: meetingId, p_idem: idem }),
  serveReturnee:    (stationId, meetingId, version, idem = newIdemKey()) => rpc("fm_queue_serve_returnee", { p_station_id: stationId, p_meeting_id: meetingId, p_expected_version: version, p_idem: idem }),
  finishReturnee:   (stationId, version, idem = newIdemKey()) => rpc("fm_queue_finish_returnee", { p_station_id: stationId, p_expected_version: version, p_idem: idem }),
  addException:     (groupId, name, idem = newIdemKey()) => rpc("fm_queue_add_exception", { p_group_id: groupId, p_name: name, p_idem: idem }),
  setMode:          (stationId, mode, version, idem = newIdemKey()) => rpc("fm_queue_set_mode", { p_station_id: stationId, p_mode: mode, p_expected_version: version, p_idem: idem }),
  undo:             (stationId, version, idem = newIdemKey()) => rpc("fm_queue_undo", { p_station_id: stationId, p_expected_version: version, p_idem: idem }),
  openDay:          (eventDate, force = false) => rpc("fm_queue_open_day", { p_event_date: eventDate, p_force: force }),
  closeAll:         (eventDate) => rpc("fm_queue_close_all", { p_event_date: eventDate }),
  resetDay:         (eventDate) => rpc("fm_queue_reset_day", { p_event_date: eventDate, p_confirm: `RESET ${eventDate}` }),
  setTestMode:      (eventDate, on) => rpc("fm_queue_set_test_mode", { p_event_date: eventDate, p_on: on }),
  reopenDay:        (eventDate) => rpc("fm_queue_reopen_day", { p_event_date: eventDate }),
  moveMeeting:      (meetingId, targetGroupId, nr = null) => rpc("fm_queue_move_meeting", { p_meeting_id: meetingId, p_target_group_id: targetGroupId, p_nr: nr }),
  assignRetailer:   (operatorId, retailerId, eventDate, assign = true) => rpc("fm_queue_assign_retailer", { p_operator_id: operatorId, p_retailer_id: retailerId, p_event_date: eventDate, p_assign: assign }),
  publicSnapshot:   (eventDate = null) => rpc("fm_queue_public_snapshot", { p_event_date: eventDate }),
};

// Realtime: jedna subskrypcja na zmiany stanowisk i grup (tablety, admin, tablica).
// Telefony uczestników NIE używają Realtime — polling snapshotu (Netlify + cache).
export function subscribeFmQueue(onChange) {
  const ch = supabase.channel("fm-queue-live")
    .on("postgres_changes", { event: "*", schema: "public", table: "fm_stations" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "fm_queue_groups" }, onChange)
    .subscribe();
  return () => { try { supabase.removeChannel(ch); } catch { /* noop */ } };
}

// [feat/staff-meeting-list] Jeden obiekt API panelu obsługi (StaffPanel). Produkcja używa tego
// obiektu; podgląd deweloperski (/obsluga-demo, tylko `import.meta.env.DEV`) podstawia
// symulację w pamięci — bez danych testowych w produkcyjnej bazie.
export const staffApi = {
  rpc: fmQueueRpc,
  listMeetings: listFmQueueMeetings,
  listStations: listFmStations,
  subscribe: subscribeFmQueue,
};
