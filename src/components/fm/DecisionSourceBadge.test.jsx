// [feat/fm-decision-source] Oznaczenie „Wybrane przez administratora”: tylko dla źródła admin,
// PL/EN z prawdziwych słowników, autor i czas wyłącznie dla administratora.
import React from "react";
import { create } from "react-test-renderer";
import { describe, it, expect, vi } from "vitest";
import pl from "../../i18n/pl/legacy.json";
import en from "../../i18n/en/legacy.json";

const state = vi.hoisted(() => ({ lang: "pl" }));
vi.mock("react-i18next", () => ({
  useTranslation: () => {
    const dict = state.lang === "en" ? en : pl;
    const t = (key, vars = {}) => {
      const v = key.split(".").reduce((o, k) => (o == null ? undefined : o[k]), dict);
      if (typeof v !== "string") return key;
      return v.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] ?? ""));
    };
    return { t, i18n: { language: state.lang } };
  },
}));
import DecisionSourceBadge from "./DecisionSourceBadge.jsx";

const text = (el) => JSON.stringify(create(el).toJSON());
const ADMIN_ROW = { entity: "target", company_id: "c1", retailer_id: 100, source: "admin", source_user_id: "aaaaaaaa-0000-4000-8000-000000000000", source_at: "2026-09-20T10:00:00Z", author: { name: "Oksana", email: "o@fm" } };

describe("DecisionSourceBadge", () => {
  it("PL: użytkownik widzi tylko komunikat, bez autora i czasu", () => {
    state.lang = "pl";
    const t = text(<DecisionSourceBadge source={ADMIN_ROW} />);
    expect(t).toContain("Wybrane przez administratora");
    expect(t).toContain(pl.fm.decision_source.admin_tooltip);
    expect(t).not.toContain("Oksana");
    expect(t).not.toContain("decision-source-meta");
    expect(t).not.toContain("2026");
  });

  it("EN: Selected by the administrator", () => {
    state.lang = "en";
    const t = text(<DecisionSourceBadge source={ADMIN_ROW} />);
    expect(t).toContain("Selected by the administrator");
    expect(t).toContain(en.fm.decision_source.admin_tooltip);
    expect(t).not.toContain("Wybrane przez");
  });

  it("administrator widzi dodatkowo autora i czas", () => {
    state.lang = "pl";
    const t = text(<DecisionSourceBadge source={ADMIN_ROW} viewerIsAdmin />);
    expect(t).toContain("decision-source-meta");
    expect(t).toContain("Oksana");
    expect(t).toContain("2026");
    expect(t).toContain(pl.fm.decision_source.admin_meta.split("{{")[0].trim());
  });

  it("brak oznaczenia dla źródła supplier / buyer / automatic / brak wiersza", () => {
    for (const source of ["supplier", "buyer", "automatic"]) expect(create(<DecisionSourceBadge source={{ ...ADMIN_ROW, source }} viewerIsAdmin />).toJSON()).toBeNull();
    expect(create(<DecisionSourceBadge source={null} />).toJSON()).toBeNull();
    expect(create(<DecisionSourceBadge />).toJSON()).toBeNull();
  });

  it("wariant target/resp (widok admina): etykieta nazywa stronę pary, PL i EN", () => {
    state.lang = "pl";
    expect(text(<DecisionSourceBadge source={ADMIN_ROW} variant="target" viewerIsAdmin />)).toContain(pl.fm.decision_source.admin_badge_target);
    expect(text(<DecisionSourceBadge source={ADMIN_ROW} variant="resp" viewerIsAdmin />)).toContain(pl.fm.decision_source.admin_badge_resp);
    state.lang = "en";
    expect(text(<DecisionSourceBadge source={ADMIN_ROW} variant="resp" viewerIsAdmin />)).toContain(en.fm.decision_source.admin_badge_resp);
  });

  it("sesja serwerowa bez autora: placeholder z i18n u admina", () => {
    state.lang = "pl";
    const t = text(<DecisionSourceBadge source={{ ...ADMIN_ROW, source_user_id: null, author: null }} viewerIsAdmin />);
    expect(t).toContain(pl.fm.decision_source.unknown_author);
  });
});
