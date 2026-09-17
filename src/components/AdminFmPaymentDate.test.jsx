import React from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key, p) => p ? `${key}:${p.date}` : key }) }));
vi.mock("../lib/db", () => ({ setCompanyFmPaymentDate: vi.fn() }));
import { setCompanyFmPaymentDate } from "../lib/db";
import { hasPendingWork, _resetPendingWork } from "../lib/pending-work";
import AdminFmPaymentDate from "./AdminFmPaymentDate";

const company = { id:"company-a",fm_b2b_enabled:true,fm_payment_date:"2026-09-17" };
const trees = [];
const input = tree => tree.root.findByType("input");
const save = tree => tree.root.findAllByType("button")[0];
const change = (tree, value) => act(() => input(tree).props.onChange({target:{value}}));
function render(co = company, onSaved = vi.fn()) {
  let tree;
  act(() => { tree=create(<AdminFmPaymentDate company={co} onSaved={onSaved}/>); });
  trees.push(tree);
  return tree;
}
beforeEach(() => { setCompanyFmPaymentDate.mockReset(); });
afterEach(() => { act(() => trees.splice(0).forEach(t => t.unmount())); _resetPendingWork(); });

describe("admin FM payment date", () => {
  it("shows the stored date only while B2B is enabled", () => {
    const tree=render({...company,fm_b2b_enabled:false});
    expect(tree.toJSON()).toBeNull();
    act(() => tree.update(<AdminFmPaymentDate company={company} onSaved={vi.fn()}/>));
    expect(input(tree).props.value).toBe("2026-09-17");
    expect(save(tree).props.disabled).toBe(true);
  });
  it("does not write while typing; saves only the date with its expected old value", async () => {
    const onSaved=vi.fn(); const tree=render(company,onSaved);
    change(tree,"2026-05-19");
    expect(setCompanyFmPaymentDate).not.toHaveBeenCalled();
    expect(hasPendingWork()).toBe(true);
    setCompanyFmPaymentDate.mockResolvedValue({id:company.id,fm_payment_date:"2026-05-19"});
    await act(async () => save(tree).props.onClick());
    expect(setCompanyFmPaymentDate).toHaveBeenCalledWith(company.id,"2026-05-19","2026-09-17");
    expect(onSaved).toHaveBeenCalledWith({id:company.id,fm_payment_date:"2026-05-19"});
    expect(input(tree).props.value).toBe("2026-05-19");
    expect(hasPendingWork()).toBe(false);
  });
  it("blocks empty and invalid dates and allows cancellation without a write", () => {
    const tree=render(); change(tree,""); expect(save(tree).props.disabled).toBe(true);
    change(tree,"2026-02-30"); expect(save(tree).props.disabled).toBe(true);
    act(() => tree.root.findAllByType("button")[1].props.onClick());
    expect(input(tree).props.value).toBe(company.fm_payment_date);
    expect(setCompanyFmPaymentDate).not.toHaveBeenCalled();
  });
  it("blocks double submits and edits during the request", async () => {
    let resolve; setCompanyFmPaymentDate.mockImplementation(() => new Promise(r => {resolve=r;}));
    const tree=render(); change(tree,"2026-05-19");
    await act(async () => { save(tree).props.onClick(); save(tree).props.onClick(); });
    expect(setCompanyFmPaymentDate).toHaveBeenCalledTimes(1);
    expect(input(tree).props.disabled).toBe(true);
    expect(save(tree).props.disabled).toBe(true);
    await act(async () => resolve({id:company.id,fm_payment_date:"2026-05-19"}));
    expect(input(tree).props.disabled).toBe(false);
  });
  it("keeps the draft on transport or missing-RPC error, with no fake success", async () => {
    const onSaved=vi.fn(); const tree=render(company,onSaved);
    change(tree,"2026-05-19");
    setCompanyFmPaymentDate.mockRejectedValue({code:"PGRST202",message:"missing RPC"});
    await act(async () => save(tree).props.onClick());
    expect(input(tree).props.value).toBe("2026-05-19");
    expect(tree.root.findAllByProps({role:"alert"})).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled(); expect(hasPendingWork()).toBe(true);
  });
  it("shows a conflict and uses the refreshed date only after an explicit retry", async () => {
    const onSaved=vi.fn(); const tree=render(company,onSaved); change(tree,"2026-05-19");
    setCompanyFmPaymentDate.mockRejectedValueOnce({code:"40001",message:"fm_payment_date_conflict",details:"2026-06-01"});
    await act(async () => save(tree).props.onClick());
    expect(onSaved).toHaveBeenCalledWith({id:company.id,fm_payment_date:"2026-06-01"});
    expect(input(tree).props.value).toBe("2026-05-19");
    expect(setCompanyFmPaymentDate).toHaveBeenCalledTimes(1);
    setCompanyFmPaymentDate.mockResolvedValueOnce({id:company.id,fm_payment_date:"2026-05-19"});
    await act(async () => save(tree).props.onClick());
    expect(setCompanyFmPaymentDate).toHaveBeenLastCalledWith(company.id,"2026-05-19","2026-06-01");
  });
  it("loads a refreshed date without overwriting a dirty draft", () => {
    const tree=render();
    act(() => tree.update(<AdminFmPaymentDate company={{...company,fm_payment_date:"2026-06-01"}} onSaved={vi.fn()}/>));
    expect(input(tree).props.value).toBe("2026-06-01");
    change(tree,"2026-05-19");
    act(() => tree.update(<AdminFmPaymentDate company={{...company,fm_payment_date:"2026-06-02"}} onSaved={vi.fn()}/>));
    expect(input(tree).props.value).toBe("2026-05-19");
  });
});
