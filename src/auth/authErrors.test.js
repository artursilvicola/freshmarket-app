import { describe, it, expect } from "vitest";
import { isMagicLinkNoAccountError, loginErrorKey } from "./authErrors.js";

describe("magic link tylko dla istniejących kont — komunikaty", () => {
  it("rozpoznaje odpowiedź Supabase dla nieznanego adresu", () => {
    expect(isMagicLinkNoAccountError({ message: "Signups not allowed for otp" })).toBe(true);
    expect(isMagicLinkNoAccountError({ message: "Signup not allowed for this instance" })).toBe(true);
    expect(isMagicLinkNoAccountError({ code: "otp_disabled", message: "" })).toBe(true);
    expect(isMagicLinkNoAccountError({ message: "Invalid login credentials" })).toBe(false);
    expect(isMagicLinkNoAccountError(null)).toBe(false);
  });

  it("w trybie magic link nieznany adres dostaje własny klucz, reszta bez zmian", () => {
    expect(loginErrorKey({ message: "Signups not allowed for otp" }, "magic")).toBe("login.magic_link_no_account");
    expect(loginErrorKey({ message: "Signups not allowed for otp" }, "password")).toBeNull();
    expect(loginErrorKey({ message: "Invalid login credentials" }, "magic")).toBeNull();
    expect(loginErrorKey({ message: "Email rate limit exceeded" }, "magic")).toBeNull();
  });
});
