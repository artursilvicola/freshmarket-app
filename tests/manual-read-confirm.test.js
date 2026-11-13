import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { parseManualConfirmRequest, MANUAL_READ_TYPES } from "../netlify/functions/_shared/manual-confirm-request.js";
import { tplOffersReadByBuyer } from "../netlify/functions/_shared/supplier-email-templates.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("parseManualConfirmRequest — żądanie ręcznego potwierdzenia", () => {
  it("potwierdzenie: wymaga wysyłki i znanego rodzaju kontaktu", () => {
    expect(parseManualConfirmRequest({ legacy_id: 12, action: "confirm", read_type: "manual_phone", note: "  rozmowa  " }))
      .toEqual({ ok: true, action: "confirm", legacyId: 12, readType: "manual_phone", note: "rozmowa" });
    for (const t of MANUAL_READ_TYPES) expect(parseManualConfirmRequest({ legacy_id: 1, action: "confirm", read_type: t }).ok).toBe(true);
    expect(parseManualConfirmRequest({ legacy_id: 1, action: "confirm", read_type: "auto_buyer_open" })).toEqual({ ok: false, error: "invalid_read_type" });
    expect(parseManualConfirmRequest({ legacy_id: 1, action: "confirm" })).toEqual({ ok: false, error: "invalid_read_type" });
  });

  it("cofnięcie: wystarczy wysyłka", () => {
    expect(parseManualConfirmRequest({ legacy_id: "7", action: "undo" })).toEqual({ ok: true, action: "undo", legacyId: 7 });
  });

  it("odrzuca brak wysyłki, złą akcję i śmieci", () => {
    expect(parseManualConfirmRequest({ action: "confirm", read_type: "manual_phone" }).error).toBe("missing_legacy_id");
    expect(parseManualConfirmRequest({ legacy_id: -3, action: "undo" }).error).toBe("missing_legacy_id");
    expect(parseManualConfirmRequest({ legacy_id: 1.5, action: "undo" }).error).toBe("missing_legacy_id");
    expect(parseManualConfirmRequest({ legacy_id: 1, action: "charge" }).error).toBe("invalid_action");
    expect(parseManualConfirmRequest(null).ok).toBe(false);
  });

  it("notatka: tylko tekst, przycięta do 1000 znaków", () => {
    expect(parseManualConfirmRequest({ legacy_id: 1, action: "confirm", read_type: "manual_email", note: { a: 1 } }).note).toBe("");
    expect(parseManualConfirmRequest({ legacy_id: 1, action: "confirm", read_type: "manual_email", note: "x".repeat(5000) }).note.length).toBe(1000);
  });
});

describe("mail do dostawcy po ręcznym potwierdzeniu", () => {
  const base = { companyName: "Dostawca", offerTitle: "Jabłka", offers: [{ title: "Jabłka" }], offerCount: 1, retailerName: "Sieć", appUrl: "https://b2b.freshmarket.eu" };

  it("PL i EN opisują potwierdzenie przekazane organizatorowi, nie wejście do panelu", () => {
    const pl = tplOffersReadByBuyer({ ...base, openedVia: "manual", locale: "pl" });
    expect(pl.html).toContain("potwierdził organizatorowi Fresh Market, że zapoznał się z Twoją propozycją");
    expect(pl.html).not.toContain("wszedł do panelu");
    const en = tplOffersReadByBuyer({ ...base, openedVia: "manual", locale: "en" });
    expect(en.html).toContain("confirmed to the Fresh Market organiser that they have reviewed your submission");
  });

  it("pozostałe kanały bez zmian", () => {
    expect(tplOffersReadByBuyer({ ...base, openedVia: "app_list", locale: "pl" }).html).toContain("wszedł do panelu PreConnect");
    expect(tplOffersReadByBuyer({ ...base, openedVia: "email", locale: "pl" }).html).toContain("otworzył mail");
    expect(tplOffersReadByBuyer({ ...base, openedVia: "app_detail", locale: "pl" }).html).toContain("otworzył Twoją propozycję w panelu");
  });
});

describe("spięcie w kodzie (strażnik regresji)", () => {
  const app = read("../src/legacy/PreconnectFM.jsx").replace(/\r\n/g, "\n");
  const body = (name) => {
    const start = app.indexOf(`async function ${name}(`);
    expect(start).toBeGreaterThan(-1);
    const end = app.indexOf("\n  }\n", start);
    return app.slice(start, end);
  };

  it("ręczne potwierdzenie idzie przez serwer, nie przez zapis JSON-u z przeglądarki", () => {
    const fn = body("confirmManual");
    expect(fn).toMatch(/dbAdminConfirmSendRead\(\{ legacyId: id, action: "confirm"/);
    expect(fn).not.toMatch(/upsertLegacySend/);
  });

  it("cofnięcie ręcznego potwierdzenia idzie przez serwer (zwrot kredytu w bazie)", () => {
    expect(body("undoConfirm")).toMatch(/cur\.status === "read_manual"[\s\S]*dbAdminConfirmSendRead\(\{ legacyId: id, action: "undo" \}\)/);
  });

  it("formularz uprzedza o pobraniu kredytu (PL i EN)", () => {
    expect(app).toMatch(/admin\.pipeline\.confirm_form_charge_hint/);
    for (const l of ["pl", "en"]) {
      const j = JSON.parse(read(`../src/i18n/${l}/legacy.json`));
      const hit = JSON.stringify(j).match(/"confirm_form_charge_hint":"[^"]+"/);
      expect(hit, l).not.toBeNull();
      for (const k of ["confirm_saved_charged", "confirm_saved_already_charged", "confirm_saved_no_credit", "confirm_skipped", "undo_confirm_done_refunded"]) {
        expect(JSON.stringify(j)).toContain(`"${k}":`);
      }
    }
  });

  it("funkcja serwera wpuszcza tylko aktywnego administratora i woła funkcje z migracji", () => {
    const fn = read("../netlify/functions/admin-confirm-send-read.js");
    expect(fn).toMatch(/!profile\?\.active \|\| profile\.role !== "admin"/);
    expect(fn).toMatch(/rpc\("confirm_legacy_send_manual"/);
    expect(fn).toMatch(/rpc\("undo_legacy_send_manual_confirm"/);
    expect(fn).toMatch(/openedVia: "manual"/);
    const sql = read("../supabase/migrations/20261113120000_manual_read_confirm.sql");
    for (const f of ["confirm_legacy_send_manual", "undo_legacy_send_manual_confirm"]) {
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon, authenticated`));
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${f}\\([^)]*\\) to service_role`));
    }
  });
});
