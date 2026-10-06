import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vitest";
import pl from "../i18n/pl/legacy.json";
import en from "../i18n/en/legacy.json";

const state = vi.hoisted(() => ({ language: "pl" }));
vi.mock("../lib/supabase", () => ({ supabase: {} }));
vi.mock("../i18n", () => ({ default: { language: "pl", t: key => key } }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    i18n: { language: state.language },
    t: (key, params = {}) => {
      const dict = state.language === "pl" ? pl : en;
      const value = key.split(".").reduce((item, part) => item?.[part], dict);
      return typeof value === "string" ? value.replace(/\{\{(\w+)\}\}/g, (_, name) => params[name] ?? "") : key;
    },
  }),
  Trans: ({ i18nKey }) => i18nKey,
}));
import { PageBuyerDetail } from "./PreconnectFM.jsx";

let tree;
afterEach(async () => {
  if (tree) await act(async () => tree.unmount());
  tree = null;
  state.language = "pl";
});
function props(contacts, extra = {}) {
  return {
    send: { id: "send-test", offerId: "offer-test", status: "read" },
    offers: [{ id: "offer-test", supplierId: "supplier-test", title: "Apples & pears", product: "apples", certs: [], packaging: [] }],
    companies: [{ id: "supplier-test", name: "Test supplier", contacts, email: "operator-private@example.com", country: "PL" }],
    buyer: { starred: [] }, nav: vi.fn(), toggleStar: vi.fn(), sends: [], ...extra,
  };
}
async function mount(contacts, extra) {
  await act(async () => { tree = create(<PageBuyerDetail {...props(contacts, extra)}/>); });
}
const emailLinks = () => tree.root.findAllByType("a").filter(node => node.props.href?.startsWith("mailto:"));
const actions = () => emailLinks().filter(node => node.props.href.includes("?subject="));

describe("buyer detail commercial contact actions", () => {
  it.each(["pl", "en"])("shows an honest empty state in %s without leaking operator contacts", async lang => {
    state.language = lang;
    await mount([]);
    expect(emailLinks()).toHaveLength(0);
    const rendered = JSON.stringify(tree.toJSON());
    expect(rendered).toContain((lang === "pl" ? pl : en).buyer.detail.cta.email_missing);
    expect(rendered).toContain((lang === "pl" ? pl : en).buyer.detail.contact_card.empty);
    expect(rendered).not.toContain("operator-private@example.com");
  });
  it("retains a phone-only contact with no empty mail links", async () => {
    await mount([{ name: "Sales", phone: " +48 123456789 ", email: "  " }, null, {}]);
    expect(emailLinks()).toHaveLength(0);
    const phones = tree.root.findAllByType("a").filter(node => node.props.href?.startsWith("tel:"));
    expect(phones).toHaveLength(1);
    expect(phones[0].props.href).toBe("tel:+48123456789");
  });
  it.each(["pl", "en"])("uses the first usable commercial email, with all six localized actions in %s", async lang => {
    state.language = lang;
    await mount([{ email: "wrong" }, { email: " sales+fruit@example.com " }, { email: "other@example.com" }]);
    expect(actions()).toHaveLength(6);
    for (const link of actions()) {
      expect(link.props.href.split("?")[0]).toBe("mailto:sales+fruit@example.com");
      const query = new URLSearchParams(link.props.href.split("?")[1]);
      expect(query.get("subject")).toContain("Apples & pears");
      expect(query.get("body")).toContain(lang === "pl" ? "Dzień dobry" : "Hello");
    }
    expect(emailLinks().filter(link => !link.props.href.includes("?subject=")).map(link => link.props.href)).toEqual([
      "mailto:sales+fruit@example.com", "mailto:other@example.com",
    ]);
    expect(tree.root.findAllByType("a").some(node => node.props.href?.startsWith("tel:"))).toBe(false);
  });
  it("keeps a literal international prefix and removes ordinary and nonbreaking spaces only in the phone href", async () => {
    const phone = "+48\u00a0603 424\t346";
    await mount([{ phone }]);
    const link = tree.root.findAllByType("a").find(node => node.props.href?.startsWith("tel:"));
    expect(link.props.href).toBe("tel:+48603424346");
    expect(link.children).toContain(phone);
  });
  it("still escapes percent signs and URI delimiters in the mail recipient", async () => {
    await mount([{ email: "sales%3Fbcc=team/example@example.com" }]);
    const recipient = "mailto:sales%253Fbcc%3Dteam%2Fexample@example.com";
    expect(actions()).toHaveLength(6);
    expect(actions().every(link => link.props.href.startsWith(`${recipient}?subject=`))).toBe(true);
    expect(emailLinks().find(link => !link.props.href.includes("?subject="))?.props.href).toBe(recipient);
  });
  it("updates when contacts are loaded later", async () => {
    await mount(undefined);
    expect(actions()).toHaveLength(0);
    await act(async () => tree.update(<PageBuyerDetail {...props([{ email: "sales@example.com" }])}/>));
    expect(actions()).toHaveLength(6);
  });
  it("never offers demo recipients while the supplier is missing", async () => {
    await mount([], { companies: [] });
    expect(emailLinks()).toHaveLength(0);
    expect(tree.root.findAllByType("a").some(node => node.props.href?.startsWith("tel:"))).toBe(false);
  });
  it("does not change the existing read callback or invoke it again on contact hydration", async () => {
    const onOpened = vi.fn();
    const send = { id: "send-test", offerId: "offer-test", status: "sent" };
    await mount([], { send, onOpened });
    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(onOpened).toHaveBeenCalledWith(send);
    await act(async () => tree.update(<PageBuyerDetail {...props([{ email: "sales@example.com" }], { send, onOpened })}/>));
    expect(onOpened).toHaveBeenCalledTimes(1);
  });
});
