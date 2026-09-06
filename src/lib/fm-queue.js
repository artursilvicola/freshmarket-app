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

// spotkania grupy (admin / przypisany operator — RLS)
export async function listFmQueueMeetings(groupId) {
  const { data, error } = await supabase.from("fm_queue_meetings")
    .select("*, companies(name)").eq("queue_group_id", groupId).order("nr");
  if (error) return softFail(error, []);
  return data || [];
}

// dostawca: własne spotkania (RLS company_id = app_company_id())
export async function listMyFmQueueMeetings() {
  const { data, error } = await supabase.from("fm_queue_meetings")
    .select("id,nr,status,queue_group_id,called_at,started_at,ended_at,return_after_nr").order("nr");
  if (error) return softFail(error, []);
  return data || [];
}

// ── RPC ──────────────────────────────────────────────────────────────────────
async function rpc(name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) {
    const e = new Error(error.message || name);
    e.code = error.code;
    e.fmCode = /FM_[A-Z_]+/.exec(error.message || "")?.[0] || null;
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
