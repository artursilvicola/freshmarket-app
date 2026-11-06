// [feat/marketing-photos] Biblioteka zdjęć (ekran) + kafelek zdjęcia w kampanii: lista z użyciem i statusami, ostrzeżenie
// o publicznym adresie i małej puli, zatwierdzenie / wyłączenie (z potwierdzeniem) / historia użycia, zakładki w module
// Marketing, wybór zdjęcia kampanii (ręczny z okna, z rotacji, bez zdjęcia) z expected_version; po zatwierdzeniu bez przycisków.
import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../i18n";

const calls = vi.hoisted(() => ({ list: [], status: "draft", photo: null }));
const VER = (id, n = 1) => ({ id: "v-" + id + (n > 1 ? "-" + n : ""), version_no: n, public_url: n > 1 ? null : "https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/" + id + "/v1.jpg", published_at: n > 1 ? null : "2026-11-06T10:00:00Z", width: 1200, height: 800, bytes: 100000 });
const PENDING = (id, n, over = {}) => ({ ...VER(id, n), public_url: null, published_at: null, published: false, preview: { url: `https://x.supabase.co/storage/v1/object/sign/marketing-photos-pending/photos/${id}/v${n}.jpg?token=S`, signed: true, expires_at: "2026-11-06T10:10:00Z" }, ...over });
const PH = (id, over = {}) => ({ id, title: "Rozmowy " + id, alt_pl: "Rozmowy", alt_en: "Talks", caption_pl: "Zdjęcie archiwalne 2026", kind: "authentic", year: 2026, status: "ready", review_note: null, current_version_id: "v-" + id, approved_version_id: "v-" + id, current_version: VER(id), approved_version: VER(id), pending_version: null, usage: { campaigns: 0, sent_campaigns: 0, last_sent_at: null, open_assignments: 0 }, ...over });
vi.mock("../../lib/db.js", () => ({
  marketingCall: vi.fn(async (fn, body) => {
    calls.list.push([fn, body]);
    if (fn === "marketing-photos" && body.action === "list") return { photos: [PH("p1"), PH("p2", { status: "pending", review_note: "zapas — do przeglądu", approved_version_id: null, approved_version: null, pending_version: PENDING("p2", 1) }), PH("p3", { status: "disabled" }), PH("p4", { usage: { campaigns: 2, sent_campaigns: 1, last_sent_at: "2026-10-01T10:00:00Z", open_assignments: 1 }, current_version_id: "v-p4-2", current_version: VER("p4", 2), pending_version: PENDING("p4", 2) }), PH("p5", { status: "pending", approved_version_id: null, approved_version: null, pending_version: PENDING("p5", 1, { published: true, preview: { url: "https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/p5/v1.jpg", signed: false, expires_at: null } }) })], ready_count: 2, warnings: ["pool_small"], public_read: true };
    if (fn === "marketing-photos" && body.action === "usage") return { usage: [{ campaign_id: "c1", campaign_name: "Kampania X", campaign_status: "sent", sent_count: 12, first_sent_at: "2026-10-01T10:00:00Z", created_at: "2026-09-30T10:00:00Z" }] };
    if (fn === "marketing-photos") return { photo: PH(body.photo_id) };
    if (fn === "marketing-campaign" && body.action === "list") return { campaigns: [{ id: "camp-1", name: "Aktywacja", status: calls.status, template_key: "credits_no_proposal", content: {}, counts: { total: 0 } }] };
    if (fn === "marketing-campaign" && body.action === "get") return { campaign: { id: "camp-1", name: "Aktywacja", status: calls.status, template_key: "credits_no_proposal", content: {}, content_version: 3, layout_version: 2, photo_id: calls.photo?.photo_id || null }, default_content: { pl: { subject: "S", body: "B", cta: "C" }, en: { subject: "S", body: "B", cta: "C" } }, messages: [], photo: calls.photo };
    if (fn === "marketing-campaign" && body.action === "set_photo") return { campaign: { id: "camp-1", name: "Aktywacja", status: "draft", template_key: "credits_no_proposal", content: {}, content_version: 4, layout_version: 2, photo_id: body.photo_id ?? (body.auto ? "p1" : null) }, photo: body.photo_id === null ? null : { photo_id: body.photo_id || "p1", version_id: "v", url: "https://x/v1.jpg", alt_pl: "Rozmowy", title: "Rozmowy " + (body.photo_id || "p1"), version_no: 1, width: 1200, height: 800, frozen: false }, photo_pick: body.auto ? { reason: "never_sent" } : null };
    if (fn === "marketing-candidates") return { snapshot_at: "2026-11-06T10:00:00Z", summary: { companies: 0, base_ok: 0, eligible: 0, by_audience: {}, by_exclusion: {} }, rows: [] };
    return {};
  }),
}));
import MarketingPhotoLibrary from "./MarketingPhotoLibrary.jsx";
import MarketingActivation from "./MarketingActivation.jsx";

let tree;
const text = (n) => typeof n === "string" ? n : Array.isArray(n) ? n.map(text).join("") : (n?.children || []).map(text).join("");
const out = () => text(tree.toJSON());
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };
const all = (id) => tree.root.findAllByProps({ "data-testid": id });
const byId = (id) => all(id)[0];
let hadWindow, prevConfirm;
beforeEach(async () => { await i18n.changeLanguage("pl"); calls.list.length = 0; calls.status = "draft"; calls.photo = { photo_id: "p1", version_id: "v-p1", version_no: 1, url: "https://x/v1.jpg", alt_pl: "Rozmowy", title: "Rozmowy p1", width: 1200, height: 800, frozen: false }; hadWindow = "window" in globalThis; if (!hadWindow) globalThis.window = {}; prevConfirm = globalThis.window.confirm; });
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; globalThis.window.confirm = prevConfirm; if (!hadWindow) delete globalThis.window; });

describe("Biblioteka zdjęć", () => {
  it("lista: 4 karty ze statusami i użyciem, ostrzeżenie o publicznym adresie i małej puli (2 gotowe), filtr po statusie", async () => {
    const fl = vi.fn();
    await act(async () => { tree = create(<MarketingPhotoLibrary fl={fl} />); }); await flush();
    expect(calls.list[0]).toEqual(["marketing-photos", { action: "list" }]);
    expect(all("ph-card")).toHaveLength(5);
    expect(out()).toContain("dostępny publicznie pod stałym adresem HTTPS");
    expect(text(byId("ph-pool-small").children)).toContain("tylko 2 gotowych zdjęć");
    expect(out()).toContain("do zatwierdzenia"); expect(out()).toContain("wyłączone"); expect(out()).toContain("zapas — do przeglądu");
    expect(out()).toContain("w 2 kampaniach, wysyłało 1"); expect(out()).toContain("w 1 otwartych"); expect(out()).toContain("nigdy niewysłane");
    await act(async () => { byId("ph-filter-pending").props.onClick(); });
    expect(all("ph-card")).toHaveLength(2); expect(all("ph-approve")).toHaveLength(2); expect(all("ph-private")).toHaveLength(0);
    // [review 3/P2] administrator WIDZI kadr oczekujący: podpisany podgląd z prywatnego bucketa (p2) i publiczny po przerwanym zatwierdzeniu (p5)
    expect(all("ph-pending-preview").map((n) => n.props.src)).toEqual(["https://x.supabase.co/storage/v1/object/sign/marketing-photos-pending/photos/p2/v1.jpg?token=S", "https://x.supabase.co/storage/v1/object/public/marketing-photos/photos/p5/v1.jpg"]);
    expect(all("ph-pending-published")).toHaveLength(1); expect(out()).toContain("Wersja 1 jest już opublikowana, ale zatwierdzenie nie zostało zapisane");
    expect(out()).toContain("chroniony adres ważny 10 minut");
    await act(async () => { byId("ph-filter-all").props.onClick(); });
    expect(all("ph-disable")).toHaveLength(2); // p1, p4 ready
    // [P2] p4: zatwierdzona v1 w rotacji, nowy kadr v2 czeka — osobny przycisk zatwierdzenia nowego kadru, miniatura z v1
    expect(all("ph-pending-version")).toHaveLength(1); expect(out()).toContain("Nowy kadr (wersja 2) czeka na zatwierdzenie");
    expect(all("ph-approve")).toHaveLength(3); expect(text(all("ph-approve")[1].children)).toBe("Zatwierdź nowy kadr (v2)");
    const p4imgs = all("ph-card")[3].findAllByType("img").map((i) => i.props.src);
    expect(p4imgs[0]).toContain("/public/marketing-photos/photos/p4/v1.jpg"); // miniatura = zatwierdzona v1
    expect(p4imgs[1]).toContain("/sign/marketing-photos-pending/photos/p4/v2.jpg"); // podgląd nowego kadru v2 obok ostrzeżenia
  });
  it("zatwierdzenie wysyła approve i odświeża; wyłączenie pyta o potwierdzenie (anulowane = brak wywołania); historia użycia otwiera okno z kampanią", async () => {
    const fl = vi.fn();
    await act(async () => { tree = create(<MarketingPhotoLibrary fl={fl} />); }); await flush();
    await act(async () => { byId("ph-approve").props.onClick(); }); await flush();
    expect(calls.list.find(([f, b]) => f === "marketing-photos" && b.action === "approve")).toEqual(["marketing-photos", { action: "approve", photo_id: "p2", version_id: "v-p2" }]);
    expect(calls.list.filter(([f, b]) => f === "marketing-photos" && b.action === "approve")).toHaveLength(1);
    expect(fl).toHaveBeenCalledWith("Zdjęcie zatwierdzone — jest w rotacji.", undefined);
    globalThis.window.confirm = vi.fn(() => false);
    await act(async () => { byId("ph-disable").props.onClick(); }); await flush();
    expect(globalThis.window.confirm).toHaveBeenCalledWith(expect.stringContaining("Wyłączyć zdjęcie „Rozmowy p1”?"));
    expect(calls.list.find(([f, b]) => f === "marketing-photos" && b.action === "disable")).toBeUndefined();
    globalThis.window.confirm = vi.fn(() => true);
    await act(async () => { byId("ph-disable").props.onClick(); }); await flush();
    expect(calls.list.find(([f, b]) => f === "marketing-photos" && b.action === "disable")).toEqual(["marketing-photos", { action: "disable", photo_id: "p1" }]);
    await act(async () => { byId("ph-usage").props.onClick(); }); await flush();
    expect(out()).toContain("Użycie zdjęcia · Rozmowy p1"); expect(out()).toContain("Kampania X"); expect(out()).toContain("12");
  });
  it("tłumaczenia EN: zakładka i ostrzeżenie", async () => {
    await i18n.changeLanguage("en");
    await act(async () => { tree = create(<MarketingPhotoLibrary fl={vi.fn()} />); }); await flush();
    expect(out()).toContain("Photo library for PreConnect e-mails"); expect(out()).toContain("Only 2 ready photos are in rotation"); expect(out()).toContain("Approve crop");
  });
});

describe("Marketing → zakładki i zdjęcie kampanii", () => {
  const open = async () => { const fl = vi.fn(); await act(async () => { tree = create(<MarketingActivation fl={fl} />); }); await flush(); await act(async () => { byId("mk-campaign").props.onClick(); }); await flush(); return fl; };
  it("zakładka „Biblioteka zdjęć” pokazuje bibliotekę; „Kampanie” wraca do listy", async () => {
    await open();
    expect(all("ph-card")).toHaveLength(0);
    await act(async () => { byId("mk-tab-photos").props.onClick(); }); await flush();
    expect(all("ph-card")).toHaveLength(5);
    await act(async () => { byId("mk-tab-campaigns").props.onClick(); });
    expect(all("ph-card")).toHaveLength(0);
  });
  it("szkic: kafelek z zdjęciem kampanii, wybór z okna wysyła set_photo z expected_version, „z rotacji” → auto, „bez zdjęcia” → null", async () => {
    const fl = await open();
    expect(byId("mk-photo-img").props.src).toBe("https://x/v1.jpg");
    expect(out()).toContain("plik v1 · 1200×800 px");
    await act(async () => { byId("mk-photo-pick").props.onClick(); }); await flush();
    expect(out()).toContain("Wybierz zdjęcie do kampanii");
    expect(all("mk-picker-photo")).toHaveLength(2); // tylko ready z plikiem (p1, p4)
    await act(async () => { all("mk-picker-photo")[1].props.onClick(); }); await flush();
    expect(calls.list.find(([f, b]) => b.action === "set_photo")).toEqual(["marketing-campaign", { action: "set_photo", campaign_id: "camp-1", expected_version: 3, photo_id: "p4" }]);
    expect(fl).toHaveBeenCalledWith("Zdjęcie kampanii zapisane.", undefined);
    expect(out()).not.toContain("Wybierz zdjęcie do kampanii"); expect(out()).toContain("Rozmowy p4");
    await act(async () => { byId("mk-photo-auto").props.onClick(); }); await flush();
    expect(calls.list.filter(([f, b]) => b.action === "set_photo").pop()[1]).toMatchObject({ auto: true, expected_version: 4 });
    expect(fl).toHaveBeenCalledWith("z rotacji: zdjęcie jeszcze niewysyłane", "info");
    await act(async () => { byId("mk-photo-remove").props.onClick(); }); await flush();
    expect(calls.list.filter(([f, b]) => b.action === "set_photo").pop()[1]).toMatchObject({ photo_id: null });
    expect(all("mk-photo-none")).toHaveLength(1); expect(all("mk-photo-remove")).toHaveLength(0);
  });
  it("po zatwierdzeniu: zamrożone zdjęcie bez przycisków, z notką o zamrożeniu", async () => {
    calls.status = "approved"; calls.photo = { ...calls.photo, frozen: true };
    await open();
    expect(all("mk-photo-pick")).toHaveLength(0); expect(all("mk-photo-auto")).toHaveLength(0);
    expect(out()).toContain("Zdjęcie zamrożone przy zatwierdzeniu");
  });
});
