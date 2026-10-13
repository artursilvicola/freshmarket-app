import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../components/supplier/FmMyQueue", () => ({ default: () => null }));
vi.mock("../components/fm/LateSelections.jsx", () => ({ BuyerLateSelections: () => null, AdminLateSelections: () => null }));

import i18n from "../i18n";
import { PipelineTableV2 } from "./PreconnectFM.jsx";
import RetailerMailingHistory from "../components/admin/RetailerMailingHistory.jsx";

let tree;
const sendMail = vi.fn();
const toggleBasket = vi.fn();
const props = {
  lockMode: "track", onSendRetailerEmail: sendMail, onToggleBasket: toggleBasket,
  dbCapacity: [], companies: [], offers: [],
  retailers: [{ id: 1, name: "ALFA" }, { id: 2, name: "BETA" }, { id: 3, name: "GAMMA" }],
  sends: [
    { id: 1, retailerId: 1, status: "read", sentAt: "2026-10-01", emailSentAt: "2026-10-06T12:14:00Z", resendMessageIds: ["a"] },
    { id: 2, retailerId: 2, status: "sent", sentAt: "2026-10-13", inEmailBasket: true },
    { id: 3, retailerId: 3, status: "rejected", sentAt: "2026-10-01", emailSentAt: "2026-10-05T12:14:00Z", resendMessageIds: ["c"] },
  ],
};
const text = node => typeof node === "string" ? node : (node?.children || []).map(text).join("");
const mount = overrides => act(() => { tree = create(<PipelineTableV2 {...props} {...overrides}/>); });

beforeEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage("pl"); });
afterEach(() => { if (tree) act(() => tree.unmount()); tree = null; });

describe("Pipeline / Networks mailing history integration", () => {
  it("shows history alongside retailer rows, including past mailings with no pending basket", () => {
    mount();
    const histories = tree.root.findAllByType(RetailerMailingHistory);
    expect(histories.map(h => h.props.retailerId).sort()).toEqual([1, 2, 3]);
    const alfa = histories.find(h => h.props.retailerId === 1);
    expect(text(alfa)).toContain("Ostatni mailing: 06.10.2026, 14:14");
    act(() => alfa.findByType("button").props.onClick());
    expect(text(alfa)).toContain("Propozycje: 1");
    expect(sendMail).not.toHaveBeenCalled();
    expect(toggleBasket).not.toHaveBeenCalled();
    const buttons = tree.root.findAllByType("button").filter(n => text(n).includes("Wyślij e-mail") && !text(n).includes("Historia"));
    expect(buttons.filter(b => !b.props.disabled)).toHaveLength(1);
    act(() => buttons.find(b => !b.props.disabled).props.onClick());
    expect(sendMail).toHaveBeenCalledWith(2);
  });

  it("never mounts the mailing history in moderation mode", () => {
    mount({ lockMode: "mod" });
    expect(tree.root.findAllByType(RetailerMailingHistory)).toHaveLength(0);
  });

  it("table filters do not truncate the retailer's mailing history", () => {
    mount();
    const filter = tree.root.findAllByType("select").find(n => n.props["aria-label"] === i18n.t("admin.pipeline.table.filter_email_label", { ns: "legacy" }));
    expect(filter).toBeTruthy();
    act(() => filter.props.onChange({ target: { value: "unsent" } }));
    const alfa = tree.root.findAllByType(RetailerMailingHistory).find(h => h.props.retailerId === 1);
    expect(text(alfa)).toContain("06.10.2026, 14:14");
    act(() => alfa.findByType("button").props.onClick());
    expect(text(alfa)).toContain("Propozycje: 1");
  });

  it("a legacy UTC mailing date is consistent with sent counts and cannot be put in the basket again", () => {
    mount({ sends: [{ id: 1, retailerId: 1, status: "sent", mailingSentAt: "2026-10-06", inEmailBasket: true }] });
    const alfa = tree.root.findByType(RetailerMailingHistory);
    expect(text(alfa)).toContain("06.10.2026");
    expect(text(tree.root)).toContain("1 w panelu · 0 w koszyku · 1 wysłane");
    expect(tree.root.findAllByType("input").filter(n => n.props.type === "checkbox")).toHaveLength(0);
  });
});
