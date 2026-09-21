import { supabase } from "./supabase";
import { chainCapacity, FM_MIN_GAP, isPairExcluded, isSupplierEligible, supplierCapacity } from "./fm-algo";

export async function loadCorrections() {
  const { data, error } = await supabase.from("fm_correction_drafts").select("*").eq("id", 1).maybeSingle();
  if (error) throw error;
  return data;
}

// Read pages at or before the loaded revision: a concurrent writer cannot mix in a newer history.
export async function loadCorrectionHistory(revision) {
  const rows = [];
  for (let start = 0; ; start += 100) {
    const { data, error } = await supabase.from("fm_correction_history")
      .select("id,revision,action,details,actor_name,created_at")
      .lte("revision", revision).order("revision", { ascending: false }).range(start, start + 99);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 100) return rows;
  }
}

export async function commitCorrection(request) {
  const { data, error } = await supabase.rpc("fm_commit_correction", {
    p_expected_revision: request.revision,
    p_request_id: request.id,
    p_action: request.action,
    p_schedule: request.schedule ?? null,
    p_details: request.details || {},
  });
  if (error) throw error;
  return data;
}

export function describeChange(plan, from, to, suppliers, chains, responses = {}) {
  const cell = p => ({ ...p, sid: plan.cq[p.cid]?.[p.pos] || null });
  const a = cell(from), b = cell(to);
  if (!a.sid || (a.cid === b.cid && a.pos === b.pos) || a.sid === b.sid) return null;
  // A company must not occur twice in the same retailer's queue.
  if (a.cid !== b.cid && ((plan.cq[b.cid] || []).includes(a.sid) || (b.sid && (plan.cq[a.cid] || []).includes(b.sid)))) {
    throw new Error("fm_correction_duplicate");
  }
  const label = x => ({ ...x, company: suppliers.find(s => s.id === x.sid)?.name || x.sid,
    chain: chains.find(c => c.id === x.cid)?.name || x.cid });
  const placements = [{ sid: a.sid, cid: b.cid, pos: b.pos }, ...(b.sid ? [{ sid: b.sid, cid: a.cid, pos: a.pos }] : [])];
  const rejected = placements.filter(p => a.cid !== b.cid && responses[p.cid]?.[p.sid] === "remove");
  const warnings = [];
  for (const p of placements) {
    for (const [cid, queue] of Object.entries(plan.cq)) {
      queue.forEach((sid, pos) => {
        if (sid !== p.sid || (cid === a.cid && pos === a.pos) || (cid === b.cid && pos === b.pos)) return;
        if (Math.abs(pos - p.pos) < 2) warnings.push({ ...label(p), otherChain: chains.find(c => c.id === cid)?.name || cid, otherPos: pos });
      });
    }
  }
  return { action: b.sid ? "swap" : "move", a: label(a), b: label(b), rejected: rejected.map(label), warnings };
}

export function undoCandidate(history) {
  const undone = new Set(history.filter(x => x.action === "undo").map(x => x.details.undo_of));
  return history.find(x => ["swap", "move", "remove", "add", "rebuild", "load_approved"].includes(x.action) && !undone.has(x.id)) || null;
}

// Plan-specific lower limits (e.g. an agreed nine-meeting plan) never increase
// the company's purchased allowance. The server independently enforces both.
export function correctionMeetingLimit(plan, supplier) {
  const cap = supplierCapacity(supplier), override = plan?.meeting_limits?.[supplier.id];
  if (!Object.hasOwn(plan?.meeting_limits || {}, supplier.id)) return cap;
  return Number.isInteger(override) && override > 0 && override <= 25 ? Math.min(cap, override) : null;
}

export function describeAddition(plan, target, supplier, chains, responses = {}) {
  const chain = chains.find(c => c.id === target.cid);
  const meetings = Object.entries(plan?.cq || {}).flatMap(([cid, q]) =>
    q.flatMap((sid, pos) => sid === supplier.id ? [{ cid, pos }] : []));
  const limit = correctionMeetingLimit(plan, supplier);
  const issues = [];
  if (!isSupplierEligible(supplier)) issues.push("fm_correction_supplier_ineligible");
  if (!chain || !Array.isArray(plan?.cq?.[target.cid]) || !Number.isInteger(target.pos) || target.pos < 0 || target.pos > 10000) issues.push("fm_correction_invalid_cell");
  if (plan?.cq?.[target.cid]?.[target.pos]) issues.push("fm_correction_occupied");
  if (meetings.some(m => m.cid === target.cid)) issues.push("fm_correction_duplicate");
  if (limit == null) issues.push("fm_correction_limit_invalid");
  else if (meetings.length >= limit) issues.push("fm_correction_supplier_limit");
  const cap = chain?.capacity > 0 ? chain.capacity : plan?.cs?.[target.cid]?.cap ?? chainCapacity(chain).cap;
  if ((plan?.cq?.[target.cid] || []).filter(Boolean).length >= cap) issues.push("fm_correction_capacity");
  if (isPairExcluded(null, responses[target.cid]?.[supplier.id])) issues.push("fm_correction_buyer_rejected");
  const nearby = meetings.filter(m => Math.abs(m.pos - target.pos) < FM_MIN_GAP)
    .map(m => ({ ...m, chain: chains.find(c => c.id === m.cid)?.name || m.cid }));
  if (nearby.length) issues.push("fm_correction_gap");
  return { to: { cid: target.cid, pos: target.pos, sid: supplier.id, company: supplier.name, chain: chain?.name || target.cid },
    beforeCount: meetings.length, afterCount: meetings.length + 1, limit, issues, nearby };
}
