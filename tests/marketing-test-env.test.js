// [feat/marketing-activation] Zabezpieczenia środowiska odbiorowego (review Codexa, runda skryptów):
// komplet wartości TYLKO z .env.test, jeden projekt dla frontu/backendu/bazy, ref produkcyjny
// odrzucany, fikcyjny klucz Resend wymuszony, MARKETING_SEND_ENABLED=false jawnie, brak dziedziczenia.
import { describe, it, expect } from "vitest";
import { parseDotenv, validateTestEnv, buildChildEnv, supabaseRef, dbUrlRef, jwtRole, REQUIRED_KEYS } from "../scripts/lib/test-env.mjs";

const good = () => ({
  TEST_DATABASE_URL: "postgresql://postgres:haslo@db.abcdefghijklmnopqrst.supabase.co:5432/postgres",
  VITE_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  VITE_SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-test",
  B2B_APP_URL: "http://localhost:8888",
  MARKETING_UNSUBSCRIBE_SECRET: "sekret-testowy-o-dlugosci-co-najmniej-24",
  RESEND_API_KEY: "re_test_disabled",
});

describe("parseDotenv", () => {
  it("czyta KEY=value, cudzysłowy, pomija komentarze i puste", () => {
    expect(parseDotenv('# k\nA=1\nB="dwa"\n\nC=\'trzy\'\nexport D=4\nZLE LINIA\n')).toEqual({ A: "1", B: "dwa", C: "trzy", D: "4" });
  });
});

describe("validateTestEnv", () => {
  it("komplet poprawnych wartości przechodzi", () => {
    expect(validateTestEnv(good())).toEqual({ ok: true, errors: [] });
  });
  it("brak klucza w pliku = odmowa, nawet gdy jest w procesie (walidacja nie patrzy na process.env)", () => {
    const f = good(); delete f.SUPABASE_SERVICE_ROLE_KEY;
    const prev = process.env.SUPABASE_SERVICE_ROLE_KEY; process.env.SUPABASE_SERVICE_ROLE_KEY = "z-procesu";
    try { const r = validateTestEnv(f); expect(r.ok).toBe(false); expect(r.errors).toContain("brak SUPABASE_SERVICE_ROLE_KEY w .env.test"); }
    finally { if (prev === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = prev; }
    for (const k of REQUIRED_KEYS) { const g = good(); g[k] = ""; expect(validateTestEnv(g).ok, k).toBe(false); }
  });
  it("ref produkcyjny w dowolnej zmiennej = odmowa", () => {
    for (const k of ["VITE_SUPABASE_URL", "SUPABASE_URL", "TEST_DATABASE_URL"]) {
      const g = good(); g[k] = g[k].replace("abcdefghijklmnopqrst", "sklyfuvzjikkqerxtulo");
      const r = validateTestEnv(g); expect(r.ok).toBe(false); expect(r.errors.join("\n")).toMatch(/PRODUKCYJNY/);
    }
  });
  it("frontend, backend i baza muszą wskazywać ten sam projekt testowy", () => {
    let g = good(); g.VITE_SUPABASE_URL = "https://innyinnyinnyinnyinny.supabase.co";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/różne projekty/);
    g = good(); g.TEST_DATABASE_URL = "postgresql://postgres:x@db.innyinnyinnyinnyinny.supabase.co:5432/postgres";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/TEST_DATABASE_URL .* różne projekty/);
    g = good(); g.SUPABASE_ANON_KEY = "inny";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/ANON_KEY .* różnią/);
    // pooler: ref w nazwie użytkownika
    g = good(); g.TEST_DATABASE_URL = "postgresql://postgres.abcdefghijklmnopqrst:x@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";
    expect(validateTestEnv(g).ok).toBe(true);
    expect(dbUrlRef(g.TEST_DATABASE_URL)).toBe("abcdefghijklmnopqrst");
    expect(supabaseRef("https://abcdefghijklmnopqrst.supabase.co/rest/v1")).toBe("abcdefghijklmnopqrst");
  });
  it("prawdziwie wyglądający klucz Resend = odmowa; MARKETING_SEND_ENABLED=true = odmowa; krótki sekret = odmowa; B2B_APP_URL poza localhost = odmowa", () => {
    let g = good(); g.RESEND_API_KEY = "re_AbCdEf123456";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/fikcyjny/);
    g = good(); g.MARKETING_SEND_ENABLED = "true";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/MARKETING_SEND_ENABLED=true/);
    g = good(); g.MARKETING_UNSUBSCRIBE_SECRET = "krotki";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/za krótki/);
    g = good(); g.B2B_APP_URL = "https://b2b.freshmarket.eu";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/localhost/);
  });
  it("klucz service_role równy anon = odmowa; JWT o roli anon pod SUPABASE_SERVICE_ROLE_KEY = odmowa; service_role pod anon = odmowa (przypadek z odbioru 04.11)", () => {
    const jwt = (role) => "eyJhbGciOiJIUzI1NiJ9." + Buffer.from(JSON.stringify({ iss: "supabase", ref: "abcdefghijklmnopqrst", role })).toString("base64url") + ".sig";
    expect(jwtRole(jwt("anon"))).toBe("anon");
    expect(jwtRole("sb_secret_abc")).toBeNull();
    let g = good(); g.SUPABASE_SERVICE_ROLE_KEY = g.SUPABASE_ANON_KEY;
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/identyczny z kluczem anon/);
    g = good(); g.SUPABASE_SERVICE_ROLE_KEY = jwt("anon"); g.VITE_SUPABASE_ANON_KEY = g.SUPABASE_ANON_KEY = jwt("anon") + "x";
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/rolę 'anon', a nie service_role/);
    g = good(); g.VITE_SUPABASE_ANON_KEY = g.SUPABASE_ANON_KEY = jwt("service_role");
    expect(validateTestEnv(g).errors.join("\n")).toMatch(/NIE może trafić do frontu/);
    g = good(); g.SUPABASE_SERVICE_ROLE_KEY = jwt("service_role"); g.VITE_SUPABASE_ANON_KEY = g.SUPABASE_ANON_KEY = jwt("anon");
    expect(validateTestEnv(g)).toEqual({ ok: true, errors: [] });
    g = good(); g.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_nowy_format";
    expect(validateTestEnv(g)).toEqual({ ok: true, errors: [] });
  });
});

describe("buildChildEnv — izolacja procesu potomnego", () => {
  it("nie dziedziczy Supabase/Resend/Netlify/MARKETING z procesu; przekazuje tylko bazę systemową i .env.test; wymusza blokady", () => {
    const parent = { PATH: "/bin", TEMP: "/tmp", HOME: "/h", SUPABASE_SERVICE_ROLE_KEY: "PROD-KEY", SUPABASE_URL: "https://sklyfuvzjikkqerxtulo.supabase.co", RESEND_API_KEY: "re_prawdziwy", MARKETING_SEND_ENABLED: "true", NETLIFY_AUTH_TOKEN: "nf_token", RESEND_WEBHOOK_SECRET: "whsec", VITE_SUPABASE_URL: "https://sklyfuvzjikkqerxtulo.supabase.co" };
    const f = good();
    const env = buildChildEnv(f, parent);
    expect(env.PATH).toBe("/bin"); expect(env.TEMP).toBe("/tmp");
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe("service-test");
    expect(env.SUPABASE_URL).toBe(f.SUPABASE_URL);
    expect(env.VITE_SUPABASE_URL).toBe(f.VITE_SUPABASE_URL);
    expect(env.RESEND_API_KEY).toBe("re_test_disabled");
    expect(env.MARKETING_SEND_ENABLED).toBe("false");
    expect(env.VITE_ADMIN_MARKETING_ACTIVATION).toBe("true");
    expect(env.NETLIFY_AUTH_TOKEN).toBe("");
    expect(env.RESEND_WEBHOOK_SECRET).toBeUndefined();
    expect(JSON.stringify(env)).not.toContain("PROD-KEY");
    expect(JSON.stringify(env)).not.toContain("sklyfuvzjikkqerxtulo");
    expect(JSON.stringify(env)).not.toContain("nf_token");
  });
  it("plik bez klucza nie jest uzupełniany z procesu (klucz po prostu nie istnieje w potomnym)", () => {
    const f = good(); delete f.SUPABASE_SERVICE_ROLE_KEY;
    const env = buildChildEnv(f, { PATH: "/bin", SUPABASE_SERVICE_ROLE_KEY: "z-procesu" });
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });
});
