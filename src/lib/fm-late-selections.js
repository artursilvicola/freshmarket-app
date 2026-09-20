import { supabase } from "./supabase";

// This module has no write path to preferences, buyer responses or the schedule.
async function readAll(table, columns, retailerId) {
  const rows = [];
  for (let from = 0; ; from += 500) {
    let query = supabase.from(table).select(columns).order("retailer_id");
    if (table === "fm_late_resps") query = query.order("supplier_legacy_id");
    if (retailerId != null) query = query.eq("retailer_id", retailerId);
    const { data, error } = await query.range(from, from + 499);
    if (error) throw error; // Missing migration/network failure must not look like an empty inbox.
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
  }
}

export async function loadLateSelections(retailerId) {
  const [access, rows] = await Promise.all([
    readAll("fm_late_selection_access", "retailer_id,enabled", retailerId),
    readAll("fm_late_resps", "id,retailer_id,supplier_legacy_id,zone,responded_at", retailerId),
  ]);
  return { access, rows };
}

export async function setLateAccess(retailerId, enabled) {
  const { data, error } = await supabase.from("fm_late_selection_access")
    .upsert({ retailer_id: retailerId, enabled: !!enabled }, { onConflict: "retailer_id" })
    .select("retailer_id,enabled").single();
  if (error) throw error;
  return data;
}

export async function saveLateSelection(retailerId, supplierId, zone) {
  if (!retailerId || !supplierId || !["want", "chance", null].includes(zone)) throw new Error("invalid_late_selection");
  let query;
  if (zone === null) {
    query = supabase.from("fm_late_resps").delete()
      .eq("retailer_id", retailerId).eq("supplier_legacy_id", supplierId).select("id").single();
  } else {
    query = supabase.from("fm_late_resps").upsert({
      retailer_id: retailerId, supplier_legacy_id: supplierId, zone, responded_at: new Date().toISOString(),
    }, { onConflict: "retailer_id,supplier_legacy_id" })
      .select("id,retailer_id,supplier_legacy_id,zone,responded_at").single();
  }
  const { data, error } = await query;
  if (error) throw error; // Includes a delete rejected by RLS (zero rows).
  return zone === null ? null : data;
}
