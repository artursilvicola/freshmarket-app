// [fix/retailer-create-with-buyer] Reguły „kto jest kupcem sieci” + tworzenie sieci z kupcem.
import { describe, expect, it, vi } from "vitest";
import {
  countsAsActiveBuyer, countActiveBuyers, retailerHasUsableBuyer,
  isPlaceholderBuyer, createRetailerWithBuyer,
} from "./retailer-buyers.js";

const realny = (p = {}) => ({ id: "uuid-1", name: "Anna Kowalska", email: "a@siec.pl", active: true, ...p });
const zastepczy = (p = {}) => ({ id: "990909_b1", name: "", email: "", active: true, isPlaceholder: true, ...p });

describe("kto liczy się jako aktywny kupiec", () => {
  it("prawdziwy profil kupca liczy się", () => {
    expect(countsAsActiveBuyer(realny())).toBe(true);
  });

  it("PUSTY wiersz zastępczy NIE liczy się — to on udawał „1 aktywnego kupca”", () => {
    expect(isPlaceholderBuyer(zastepczy())).toBe(true);
    expect(countsAsActiveBuyer(zastepczy())).toBe(false);
  });

  it("zastępczy Z e-mailem liczy się — stare sieci mają tam realny kontakt", () => {
    expect(countsAsActiveBuyer(zastepczy({ name: "Jan Stary", email: "jan@siec.pl" }))).toBe(true);
  });

  it("dezaktywowany nie liczy się, nawet z e-mailem", () => {
    expect(countsAsActiveBuyer(realny({ active: false }))).toBe(false);
  });

  it("sam biały znak w e-mailu to brak e-maila", () => {
    expect(countsAsActiveBuyer(zastepczy({ email: "   " }))).toBe(false);
  });

  it("licznik pomija puste zastępcze", () => {
    expect(countActiveBuyers([realny(), zastepczy(), realny({ id: "uuid-2" })])).toBe(2);
    expect(countActiveBuyers([zastepczy()])).toBe(0);
    expect(countActiveBuyers(null)).toBe(0);
  });

  it("sieć z samym pustym zastępczym nie ma kupca, z którym działa mailing", () => {
    expect(retailerHasUsableBuyer({ buyers: [zastepczy()] })).toBe(false);
    expect(retailerHasUsableBuyer({ buyers: [realny()] })).toBe(true);
  });
});

describe("tworzenie sieci razem z kupcem", () => {
  const entry = { id: 990910, name: "ZZZ TEST", buyers: [{ name: "Test Kupiec", email: "k@test.pl" }] };

  it("obie operacje OK → sukces", async () => {
    const upsertRetailers = vi.fn(async () => {});
    const saveBuyer = vi.fn(async () => true);
    const r = await createRetailerWithBuyer({ entry, upsertRetailers, saveBuyer });
    expect(r).toEqual({ retailerCreated: true, buyerCreated: true });
    expect(upsertRetailers).toHaveBeenCalledWith([entry]);
    expect(saveBuyer).toHaveBeenCalledWith(entry.id, entry);
  });

  it("sieć się nie zapisała → konta kupca NIE próbujemy zakładać", async () => {
    const blad = new Error("brak połączenia");
    const saveBuyer = vi.fn(async () => true);
    const r = await createRetailerWithBuyer({
      entry, upsertRetailers: vi.fn(async () => { throw blad; }), saveBuyer,
    });
    expect(r.retailerCreated).toBe(false);
    expect(r.buyerCreated).toBe(false);
    expect(r.error).toBe(blad);
    expect(saveBuyer).not.toHaveBeenCalled();   // inaczej profil wskazywałby na nieistniejącą sieć
  });

  it("sieć OK, kupiec padł → to NIE jest sukces, ale sieć zostaje", async () => {
    const r = await createRetailerWithBuyer({
      entry, upsertRetailers: vi.fn(async () => {}), saveBuyer: vi.fn(async () => false),
    });
    expect(r).toEqual({ retailerCreated: true, buyerCreated: false });
  });

  it("ponowienie nie tworzy drugiej sieci — wołający powtarza sam zapis kupca", async () => {
    const upsertRetailers = vi.fn(async () => {});
    let proba = 0;
    const saveBuyer = vi.fn(async () => (++proba > 1));
    const pierwsza = await createRetailerWithBuyer({ entry, upsertRetailers, saveBuyer });
    expect(pierwsza.buyerCreated).toBe(false);
    // ponowienie idzie przez „Zapisz zmiany”, czyli sam saveBuyer
    expect(await saveBuyer(entry.id, entry)).toBe(true);
    expect(upsertRetailers).toHaveBeenCalledTimes(1);
  });
});
