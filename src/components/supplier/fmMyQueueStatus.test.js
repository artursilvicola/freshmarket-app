import { describe, it, expect } from "vitest";
import { groupsFromSnapshot, nowNumbers, meetingStatusKey } from "./fmMyQueueStatus.js";

const st = (group_id, station_idx, mode, current_nr, last_called_nr) => ({ group_id, station_idx, mode, current_nr, last_called_nr, retailer_name: "Auchan Polska", gate: 1 });

describe("„Twoja kolej” — podejdź tylko po faktycznym wywołaniu", () => {
  const groups = groupsFromSnapshot([st("g", 1, "open", 12, 12)]);
  const g = groups.g;
  it("zaplanowany 13 przy ostatnio wywołanym 12 → „jesteś następny”, NIE „podejdź”", () => {
    expect(meetingStatusKey({ nr: 13, status: "planned" }, g)).toEqual({ key: "next_up" });
  });
  it("wywołany (status called) → „podejdź”, niezależnie od numerów", () => {
    expect(meetingStatusKey({ nr: 13, status: "called" }, g)).toEqual({ key: "your_turn" });
    expect(meetingStatusKey({ nr: 13, status: "called" }, null)).toEqual({ key: "your_turn" });
  });
  it("dalsze numery → liczba numerów przed dostawcą", () => {
    expect(meetingStatusKey({ nr: 15, status: "planned" }, g)).toEqual({ key: "ahead", n: 2 });
    expect(meetingStatusKey({ nr: 14, status: "planned" }, g)).toEqual({ key: "ahead", n: 1 });
  });
  it("statusy z rekordu mają pierwszeństwo przed liczeniem", () => {
    expect(meetingStatusKey({ nr: 5, status: "in_progress" }, g).key).toBe("in_progress");
    expect(meetingStatusKey({ nr: 5, status: "returned_in_progress" }, g).key).toBe("in_progress");
    expect(meetingStatusKey({ nr: 5, status: "done" }, g).key).toBe("done");
    expect(meetingStatusKey({ nr: 5, status: "no_show" }, g).key).toBe("no_show");
    expect(meetingStatusKey({ nr: 5, status: "returned_waiting" }, g).key).toBe("returned");
    expect(meetingStatusKey({ nr: 5, status: "skipped" }, g).key).toBe("skipped");
    expect(meetingStatusKey({ nr: 5, status: "cancelled" }, g).key).toBe("cancelled");
  });
  it("brak grupy / zamknięte / przerwa / wolne wejście", () => {
    expect(meetingStatusKey({ nr: 13, status: "planned" }, null).key).toBe("closed");
    expect(meetingStatusKey({ nr: 13, status: "planned" }, groupsFromSnapshot([st("g", 1, "closed", null, 0)]).g).key).toBe("closed");
    expect(meetingStatusKey({ nr: 13, status: "planned" }, groupsFromSnapshot([st("g", 1, "paused", null, 12)]).g).key).toBe("paused");
    expect(meetingStatusKey({ nr: 13, status: "planned" }, groupsFromSnapshot([st("g", 1, "free_entry", null, 12)]).g).key).toBe("free");
    // wolne wejście na jednym stanowisku, ale drugie otwarte → nadal kolejka
    expect(meetingStatusKey({ nr: 13, status: "planned" }, groupsFromSnapshot([st("g", 1, "free_entry", null, 12), st("g", 2, "open", 12, 12)]).g).key).toBe("next_up");
  });
});

describe("TERAZ przy dwóch równoległych stanowiskach (Auchan ×2)", () => {
  it("pokazuje numer przy KAŻDYM otwartym stanowisku, nie tylko ostatnio wywołany", () => {
    const g = groupsFromSnapshot([st("g", 1, "open", 11, 12), st("g", 2, "open", 12, 12)]).g;
    expect(nowNumbers(g)).toEqual([11, 12]);
    // numer 13 zaplanowany: przed nim 0 numerów → „jesteś następny”, nie „podejdź”
    expect(meetingStatusKey({ nr: 13, status: "planned" }, g)).toEqual({ key: "next_up" });
  });
  it("stanowisko zamykane (closing) z trwającym spotkaniem nadal liczy się jako TERAZ", () => {
    const g = groupsFromSnapshot([st("g", 1, "closing", 11, 12), st("g", 2, "closed", null, 12)]).g;
    expect(nowNumbers(g)).toEqual([11]);
  });
  it("otwarte stanowiska bez bieżącego numeru → ostatnio wywołany numer grupy; wszystko zamknięte → nic", () => {
    expect(nowNumbers(groupsFromSnapshot([st("g", 1, "open", null, 12), st("g", 2, "open", null, 12)]).g)).toEqual([12]);
    expect(nowNumbers(groupsFromSnapshot([st("g", 1, "open", null, 0)]).g)).toEqual([]);
    expect(nowNumbers(groupsFromSnapshot([st("g", 1, "closed", null, 12)]).g)).toEqual([]);
    expect(nowNumbers(null)).toEqual([]);
  });
  it("grupy z osobnymi kolejkami (Dino Owoce / Kwiaty) nie mieszają się", () => {
    const groups = groupsFromSnapshot([st("owoce", 1, "open", 3, 3), st("kwiaty", 1, "closed", null, 0)]);
    expect(Object.keys(groups).sort()).toEqual(["kwiaty", "owoce"]);
    expect(nowNumbers(groups.owoce)).toEqual([3]);
    expect(nowNumbers(groups.kwiaty)).toEqual([]);
  });
});

// ── review release 9.09: closing ≠ „wolno wywołać następnego” ────────────────
describe("zamykanie kolejki nie zapowiada kolejnego dostawcy", () => {
  it("jedyne stanowisko closing z trwającym nr 12: 13 nie dostaje „następny”, TERAZ nadal 12", () => {
    const g = groupsFromSnapshot([st("g", 1, "closing", 12, 12)]).g;
    expect(meetingStatusKey({ nr: 13, status: "planned" }, g)).toEqual({ key: "closing" });
    expect(nowNumbers(g)).toEqual([12]);
  });
  it("closing + closed → closing; closing + open → nadal kolejka (drugie stanowisko może wywołać)", () => {
    expect(meetingStatusKey({ nr: 13, status: "planned" }, groupsFromSnapshot([st("g", 1, "closing", 12, 12), st("g", 2, "closed", null, 12)]).g).key).toBe("closing");
    expect(meetingStatusKey({ nr: 13, status: "planned" }, groupsFromSnapshot([st("g", 1, "closing", 11, 12), st("g", 2, "open", 12, 12)]).g).key).toBe("next_up");
  });
  it("„Zamknij wszystkie” (settings.closed_all_at) blokuje zapowiedź nawet przy stanowisku open", () => {
    const g = groupsFromSnapshot([st("g", 1, "open", 12, 12)], { closed_all_at: "2026-09-24T15:00:00Z" }).g;
    expect(meetingStatusKey({ nr: 13, status: "planned" }, g)).toEqual({ key: "closing" });
    expect(meetingStatusKey({ nr: 12, status: "called" }, g)).toEqual({ key: "your_turn" });   // wywołany kończy normalnie
  });
});
