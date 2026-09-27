// [feat/free-credit-grants v3] Maszyna stanów formularza przyznania: scenariusz z review Codexa v2 (P2):
// żądanie w toku → próba edycji → utrata odpowiedzi → „Ponów” wysyła IDENTYCZNY payload i klucz.
import { describe, it, expect, vi } from "vitest";
vi.mock("../src/lib/supabase", () => ({ supabase: { rpc: vi.fn(), from: vi.fn() }, isSupabaseConfigured: true }));
import { openGrantForm, editGrantForm, addCompany, removeCompany, submitStart, submitFailed, submitSucceeded, canSubmit, buildPayload, closeNeedsWarning, isEditable } from "../src/lib/grant-form.js";

describe("grant-form", () => {
  it("otwarcie: klucz stały, domyślna data = +3 miesiące kalendarzowe (podgląd), do RPC idzie null", () => {
    const s = openGrantForm({ companyId: "c1", today: "2026-11-30", key: "k-00000001" });
    expect(s).toMatchObject({ key: "k-00000001", companyIds: ["c1"], qty: 1, reason: "compensation", expiresAt: "2027-02-28", expiresTouched: false, busy: false, locked: false });
    expect(buildPayload(s)).toEqual({ companyIds: ["c1"], qty: 1, reason: "compensation", message: "", note: "", expiresAt: null, idempotencyKey: "k-00000001" });
    const touched = editGrantForm(s, { expiresAt: "2027-01-15" });
    expect(buildPayload(touched).expiresAt).toBe("2027-01-15");
  });

  it("w toku: edycja, dodanie i usunięcie firmy są ignorowane; Ponów po błędzie wysyła snapshot z tym samym kluczem", async () => {
    let s = openGrantForm({ companyId: "c1", today: "2026-09-27", key: "k-00000001" });
    s = addCompany(s, "c2");
    s = editGrantForm(s, { qty: "2", message: "Rekompensata" });
    expect(canSubmit(s)).toBe(true);

    // odroczona odpowiedź RPC — formularz czeka
    let rejectRpc;
    const pending = new Promise((_, reject) => { rejectRpc = reject; });
    const first = submitStart(s);
    s = first.state;
    expect(s.busy).toBe(true);
    expect(isEditable(s)).toBe(false);
    expect(first.payload).toEqual({ companyIds: ["c1", "c2"], qty: 2, reason: "compensation", message: "Rekompensata", note: "", expiresAt: null, idempotencyKey: "k-00000001" });

    // admin próbuje zmienić treść w trakcie oczekiwania — bez efektu
    const attempted = removeCompany(editGrantForm(addCompany(s, "c3"), { qty: "9", message: "INNE" }), "c1");
    expect(attempted).toBe(s);
    expect(closeNeedsWarning(s)).toBe(true);

    // odpowiedź ginie (błąd sieci)
    rejectRpc(new Error("network"));
    await expect(pending).rejects.toThrow("network");
    s = submitFailed(s);
    expect(s).toMatchObject({ busy: false, locked: true, error: "failed" });
    expect(isEditable(s)).toBe(false);
    expect(editGrantForm(s, { qty: "50" })).toBe(s);
    expect(closeNeedsWarning(s)).toBe(true);

    // Ponów: dokładnie ten sam payload i klucz, mimo że canSubmit patrzy na pola
    const retry = submitStart(s);
    expect(retry.payload).toEqual(first.payload);
    expect(retry.payload.idempotencyKey).toBe("k-00000001");
    s = submitSucceeded(retry.state);
    expect(s).toMatchObject({ busy: false, locked: false, error: null });
    expect(closeNeedsWarning(s)).toBe(false);
  });

  it("niezgodność (klucz z inną treścią po stronie bazy) blokuje formularz bez ostrzeżenia o nieznanym wyniku", () => {
    let s = openGrantForm({ companyId: "c1", today: "2026-09-27", key: "k-00000001" });
    s = submitStart(s).state;
    s = submitFailed(s, { mismatch: true });
    expect(s).toMatchObject({ locked: true, error: "mismatch" });
    expect(closeNeedsWarning(s)).toBe(false);
  });

  it("walidacja: brak firm, zła liczba, zły powód, drugie wysłanie w toku", () => {
    let s = openGrantForm({ today: "2026-09-27", key: "k-00000001" });
    expect(canSubmit(s)).toBe(false);
    expect(submitStart(s).payload).toBeNull();
    s = addCompany(s, "c1");
    expect(canSubmit(editGrantForm(s, { qty: "0" }))).toBe(false);
    expect(canSubmit(editGrantForm(s, { qty: "101" }))).toBe(false);
    expect(canSubmit(editGrantForm(s, { reason: "bonus" }))).toBe(false);
    const busy = submitStart(s).state;
    expect(submitStart(busy).payload).toBeNull();
    expect(addCompany(s, "c1").companyIds).toEqual(["c1"]);
  });
});
