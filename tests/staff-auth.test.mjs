import { describe, it, expect } from "vitest";
import { classifyAuthError, generatePin, staffPassword, normalizeStaffCode } from "../netlify/functions/_shared/staff-auth.js";

describe("classifyAuthError — tylko jednoznaczny zły PIN zwiększa licznik lockoutu", () => {
  it("brak błędu + sesja = success; brak błędu bez sesji = system_error", () => {
    expect(classifyAuthError(null, { access_token: "x" })).toBe("success");
    expect(classifyAuthError(null, null)).toBe("system_error");
  });
  it("GoTrue error.code invalid_credentials → invalid_credentials", () => {
    expect(classifyAuthError({ status: 400, code: "invalid_credentials", message: "Invalid login credentials" })).toBe("invalid_credentials");
    expect(classifyAuthError({ status: 400, error_code: "invalid_credentials", message: "whatever" })).toBe("invalid_credentials");
  });
  it("dokładny komunikat 'Invalid login credentials' przy 400 (starsze GoTrue bez code) → invalid_credentials", () => {
    expect(classifyAuthError({ status: 400, message: "Invalid login credentials" })).toBe("invalid_credentials");
  });
  it("nieznany błąd 400 GoTrue → system_error (NIE liczy się jako zły PIN)", () => {
    expect(classifyAuthError({ status: 400, code: "validation_failed", message: "Unsupported grant type" })).toBe("system_error");
    expect(classifyAuthError({ status: 400, message: "Email not confirmed" })).toBe("system_error");
    expect(classifyAuthError({ status: 400, code: "over_request_rate_limit", message: "Request rate limit reached" })).toBe("system_error");
  });
  it("5xx / sieć / timeout → system_error", () => {
    expect(classifyAuthError({ status: 502, message: "Bad Gateway" })).toBe("system_error");
    expect(classifyAuthError({ message: "fetch failed" })).toBe("system_error");
    expect(classifyAuthError(new Error("network timeout"))).toBe("system_error");
  });
});

describe("generatePin / staffPassword", () => {
  it("PIN ma 6 cyfr i nie jest trywialny", () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePin();
      expect(p).toMatch(/^\d{6}$/);
      expect(/^(\d)\1{5}$/.test(p)).toBe(false);
      expect("0123456789".includes(p) || "9876543210".includes(p)).toBe(false);
    }
  });
  it("hasło GoTrue = HMAC(pepper, KOD:PIN) — deterministyczne, zależne od peppera i kodu", () => {
    const pepper = "x".repeat(40);
    expect(staffPassword(pepper, "obsluga-1", "123457")).toBe(staffPassword(pepper, "OBSLUGA-1", "123457"));
    expect(staffPassword(pepper, "OBSLUGA-1", "123457")).not.toBe(staffPassword("y".repeat(40), "OBSLUGA-1", "123457"));
    expect(staffPassword(pepper, "OBSLUGA-1", "123457")).not.toBe(staffPassword(pepper, "OBSLUGA-2", "123457"));
    expect(normalizeStaffCode(" obsluga-3 ")).toBe("OBSLUGA-3");
  });
});
