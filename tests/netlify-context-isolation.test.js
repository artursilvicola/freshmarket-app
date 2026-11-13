import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isolateContexts, exposureOf, resolveEntry, shape, assertReadOnlyArgs, createHttpWriter, loadNetlifyToken,
  SafeError, toSafeError, EXIT,
} from "../scripts/lib/netlify-context-isolation.mjs";

// ── atrapa magazynu zmiennych Netlify ─────────────────────────────────────────
// Trzyma PRAWDZIWE (fikcyjne) wartości; przy odczycie sekrety są maskowane jak w API (16 gwiazdek + 4 znaki).
const SECRETS = {
  PAYU_ENV: "payu-env-WARTOSC-71",
  PAYU_OAUTH_CLIENT_ID: "payu-id-WARTOSC-72",
  PAYU_OAUTH_CLIENT_SECRET: "payu-oauth-SEKRET-73-abcdefabcdef",
  PAYU_POS_ID: "payu-pos-WARTOSC-74",
  PAYU_SECOND_KEY: "payu-second-SEKRET-75-abcdefabcdef",
  FM_EXPORT_TOKEN: "export-token-SEKRET-76-abcdefabcdefabcdef",
  RESEND_WEBHOOK_SECRET: "whsec-SEKRET-77-abcdefabcdefabcdef",
  RESEND_PROD: "re_live_SEKRET_PROD_Qz7k",
  RESEND_PREVIEW: "re_live_SEKRET_PREV_Qz7k",
  OPENAI_PROD: "sk-live-SEKRET-PROD-Wm3x",
  SRK_PROD: "srk-SEKRET-PROD-Hy5n",
  SRK_TEST: "srk-SEKRET-TEST-Bb2c",
  UNSUB: "unsub-SEKRET-PROD-Lp9d",
};
const SPLIT = ["PAYU_ENV", "PAYU_OAUTH_CLIENT_ID", "PAYU_OAUTH_CLIENT_SECRET", "PAYU_POS_ID", "PAYU_SECOND_KEY", "FM_EXPORT_TOKEN", "RESEND_WEBHOOK_SECRET"];
const DROP = { RESEND_API_KEY: ["deploy-preview", "branch-deploy"], OPENAI_API_KEY: ["deploy-preview", "branch-deploy"], SUPABASE_SERVICE_ROLE_KEY: ["branch-deploy"] };
const ALL_SCOPES = ["builds", "functions", "post_processing", "runtime"];

function fixture() {
  let n = 0;
  const e = (context, value) => ({ id: `e${++n}`, context, value });
  const perCtx = (prod, preview, branch) => [e("dev", ""), e("branch-deploy", branch), e("deploy-preview", preview), e("production", prod), e("dev-server", prod)];
  return [
    ...SPLIT.map((key) => ({ key, is_secret: false, scopes: [...ALL_SCOPES], values: [e("all", SECRETS[key])] })),
    { key: "RESEND_API_KEY", is_secret: true, scopes: ["builds", "functions", "runtime"], values: perCtx(SECRETS.RESEND_PROD, SECRETS.RESEND_PREVIEW, SECRETS.RESEND_PROD) },
    { key: "OPENAI_API_KEY", is_secret: true, scopes: ["builds", "functions", "runtime"], values: perCtx(SECRETS.OPENAI_PROD, SECRETS.OPENAI_PROD, SECRETS.OPENAI_PROD) },
    { key: "SUPABASE_SERVICE_ROLE_KEY", is_secret: true, scopes: ["builds", "functions", "runtime"], values: perCtx(SECRETS.SRK_PROD, SECRETS.SRK_TEST, SECRETS.SRK_PROD) },
    { key: "MARKETING_UNSUBSCRIBE_SECRET", is_secret: true, scopes: ["functions"], values: [e("production", SECRETS.UNSUB)] },
    { key: "VITE_SUPABASE_URL", is_secret: false, scopes: [...ALL_SCOPES], values: [e("production", "https://prod.example"), e("deploy-preview", "https://test.example"), e("branch-deploy", "https://prod.example")] },
    { key: "NODE_VERSION", is_secret: false, scopes: [...ALL_SCOPES], values: [e("all", "20")] },
  ];
}

class FakeNetlify {
  constructor(vars = fixture()) { this.vars = vars; this.seq = 1000; this.calls = []; }
  find(key) { const v = this.vars.find((x) => x.key === key); if (!v) throw Object.assign(new Error(`404 ${key}`), { code: "ENOTFOUND_VAR" }); return v; }
  view(v) {
    return { key: v.key, is_secret: v.is_secret, scopes: [...v.scopes], values: v.values.map((x) => ({ id: x.id, context: x.context, value: v.is_secret && x.value ? "*".repeat(16) + String(x.value).slice(-4) : x.value })) };
  }
  async listVars() { this.calls.push("list"); return this.vars.map((v) => this.view(v)); }
  async getVar(key) { this.calls.push(`get:${key}`); return this.view(this.find(key)); }
  async putVar(key, body) {
    this.calls.push(`put:${key}`);
    const v = this.find(key);
    v.scopes = [...body.scopes]; v.is_secret = !!body.is_secret;
    v.values = body.values.map((x) => ({ id: `n${++this.seq}`, context: x.context, value: x.value }));
    return true;
  }
  async deleteValue(key, id) { this.calls.push(`del:${key}:${id}`); const v = this.find(key); v.values = v.values.filter((x) => x.id !== id); return true; }
  writes() { return this.calls.filter((c) => /^(put|del):/.test(c)); }
  real(key, ctx) { const v = this.vars.find((x) => x.key === key); const x = v.values.find((y) => y.context === ctx) || v.values.find((y) => y.context === "all"); return x ? x.value : undefined; }
}
const timeout = () => Object.assign(new Error(`ETIMEDOUT podczas wysyłania ${SECRETS.PAYU_SECOND_KEY}`), { code: "ETIMEDOUT" });

async function run(net, extra = {}) {
  const lines = [];
  const result = await isolateContexts({ client: net, split: SPLIT, drop: DROP, dry: false, log: (l) => lines.push(String(l)), sleep: async () => {}, ...extra });
  return { result, lines, text: lines.join("\n") };
}
function expectNoSecrets(text) {
  for (const [name, value] of Object.entries(SECRETS)) {
    expect(text.includes(value), `log zawiera wartość ${name}`).toBe(false);
    expect(text.includes("*".repeat(16) + value.slice(-4)), `log zawiera zamaskowaną końcówkę ${name}`).toBe(false);
  }
}
const prodSnapshot = (net) => Object.fromEntries(net.vars.map((v) => [v.key, net.real(v.key, "production")]));

// ── scenariusze ───────────────────────────────────────────────────────────────
describe("pomocnicze: dziedziczenie i kształt", () => {
  it("kontekst bez własnego wpisu dziedziczy z „all”", () => {
    const v = { values: [{ id: "1", context: "all", value: "x" }] };
    expect(resolveEntry(v, "deploy-preview").context).toBe("all");
    expect(exposureOf(v, "deploy-preview")).toEqual(["all"]);
    expect(exposureOf({ values: [{ id: "1", context: "production", value: "x" }] }, "deploy-preview")).toEqual([]);
  });
  it("pusta wartość nie jest ekspozycją; wpis konkretnej gałęzi jest", () => {
    expect(exposureOf({ values: [{ id: "1", context: "branch-deploy", value: "" }] }, "branch-deploy")).toEqual([]);
    expect(exposureOf({ values: [{ id: "1", context: "branch", value: "x" }] }, "branch-deploy")).toEqual(["branch"]);
  });
  it("shape nie zdradza treści ani końcówki", () => {
    expect(shape("*".repeat(16) + "Qz7k")).toBe("zamaskowana");
    expect(shape("tajne")).toBe("jawna(5 zn.)");
    expect(shape("")).toBe("pusta");
    expect(shape(undefined)).toBe("brak");
  });
});

describe("próba na sucho", () => {
  it("niczego nie zapisuje, pokazuje plan i wynik symulacji", async () => {
    const net = new FakeNetlify();
    const { result, text } = await run(net, { dry: true });
    expect(net.writes()).toEqual([]);
    expect(result.status).toBe("dry");
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.exposedNow.length).toBeGreaterThan(0);
    expect(result.exposed).toEqual([]);
    expect(text).toMatch(/A PAYU_SECOND_KEY: do zamiany „all” → production \+ dev/);
    expect(text).toMatch(/B RESEND_API_KEY \/ deploy-preview: do usunięcia wpis \(zamaskowana\)/);
    expectNoSecrets(text);
  });
  it("domyślnie działa na sucho (zapis wymaga jawnego dry: false)", async () => {
    const net = new FakeNetlify();
    const result = await isolateContexts({ client: net, split: SPLIT, drop: DROP });
    expect(net.writes()).toEqual([]);
    expect(result.status).toBe("dry");
  });
});

describe("ścieżka poprawna", () => {
  it("odcina klucze, produkcja bez zmian, kod 0", async () => {
    const net = new FakeNetlify();
    const before = prodSnapshot(net);
    const prodIds = Object.fromEntries(["RESEND_API_KEY", "OPENAI_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"].map((k) => [k, net.find(k).values.find((x) => x.context === "production").id]));
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.OK);
    expect(result.status).toBe("ok");
    expect(result.writes).toBe(7 + 5);
    expect(prodSnapshot(net)).toEqual(before);
    for (const k of SPLIT) for (const ctx of ["deploy-preview", "branch-deploy"]) expect(net.real(k, ctx), `${k}@${ctx}`).toBeUndefined();
    for (const k of SPLIT) expect(net.real(k, "dev")).toBe(SECRETS[k]);
    expect(net.real("RESEND_API_KEY", "deploy-preview")).toBeUndefined();
    expect(net.real("RESEND_API_KEY", "branch-deploy")).toBeUndefined();
    expect(net.real("OPENAI_API_KEY", "deploy-preview")).toBeUndefined();
    expect(net.real("SUPABASE_SERVICE_ROLE_KEY", "branch-deploy")).toBeUndefined();
    expect(net.real("SUPABASE_SERVICE_ROLE_KEY", "deploy-preview")).toBe(SECRETS.SRK_TEST); // klucz testowy zostaje celowo
    for (const [k, id] of Object.entries(prodIds)) expect(net.find(k).values.find((x) => x.context === "production").id).toBe(id);
    expect(text).toMatch(/sekrety: ten sam identyfikator wpisu/);
    expect(text).toMatch(/WYNIK: OK/);
    expectNoSecrets(text);
  });
  it("ponowne uruchomienie niczego nie zapisuje i nadal kończy się kodem 0", async () => {
    const net = new FakeNetlify();
    await run(net);
    const n = net.writes().length;
    const { result } = await run(net);
    expect(net.writes().length).toBe(n);
    expect(result.exitCode).toBe(EXIT.OK);
  });
});

describe("[P2] sukces tylko wtedy, gdy kluczy faktycznie nie ma w podglądzie i gałęzi", () => {
  it("sekret z wpisami kontekstów ORAZ wpisem „all”: odmowa przed jakimkolwiek zapisem (dziedziczenie)", async () => {
    const net = new FakeNetlify();
    net.find("RESEND_API_KEY").values.push({ id: "all-1", context: "all", value: SECRETS.RESEND_PROD });
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.REFUSED);
    expect(net.writes()).toEqual([]);
    expect(text).toMatch(/RESEND_API_KEY: ma wpis „all” — podgląd i gałąź DZIEDZICZĄ/);
    expect(text).toMatch(/Nic nie zapisano/);
    expectNoSecrets(text);
  });
  it("usunięcie „udane”, ale wpis został: kod 1 i lista kluczy nadal widocznych", async () => {
    const net = new FakeNetlify();
    net.deleteValue = async function (key, id) { this.calls.push(`del:${key}:${id}`); return true; }; // serwer nic nie usuwa
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.FAILED);
    expect(text).toMatch(/RESEND_API_KEY \/ deploy-preview: wpis NADAL JEST/);
    expect(result.exposed).toEqual(expect.arrayContaining(["RESEND_API_KEY@deploy-preview←deploy-preview"]));
    expect(text).toMatch(/NADAL WIDZĄ:/);
    expect(text).not.toMatch(/WYNIK: OK/);
  });
  it("gdy po operacjach klucz wraca przez dziedziczenie, kontrola końcowa wymusza kod 1", async () => {
    const net = new FakeNetlify();
    const list = net.listVars.bind(net);
    let calls = 0;
    net.listVars = async () => { // ktoś równolegle dodał wpis „all” do sekretu — widać go dopiero w kontroli końcowej
      if (++calls === 2) net.find("OPENAI_API_KEY").values.push({ id: "late-all", context: "all", value: SECRETS.OPENAI_PROD });
      return list();
    };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.FAILED);
    expect(result.exposed).toEqual(expect.arrayContaining(["OPENAI_API_KEY@deploy-preview←all", "OPENAI_API_KEY@branch-deploy←all"]));
    expect(text).not.toMatch(/WYNIK: OK/);
  });
  it("struktura inna niż oczekiwana (sekret wśród zmiennych do zamiany): odmowa, zero zapisów", async () => {
    const net = new FakeNetlify();
    net.find("FM_EXPORT_TOKEN").is_secret = true;
    const { result } = await run(net);
    expect(result.exitCode).toBe(EXIT.REFUSED);
    expect(net.writes()).toEqual([]);
  });
});

describe("[P2] awaria po zapisie = stan niepewny, bez automatycznego cofania", () => {
  it("błąd odczytu zaraz po zapisie: kod 2, jeden zapis, stan ustalony jako „weszła”, kontrola końcowa wykonana", async () => {
    const net = new FakeNetlify();
    const get = net.getVar.bind(net);
    let failNext = false;
    const put = net.putVar.bind(net);
    net.putVar = async (key, body) => { const r = await put(key, body); failNext = true; return r; };
    net.getVar = async (key) => { if (failNext) { failNext = false; net.calls.push(`get!:${key}`); throw timeout(); } return get(key); };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.UNCERTAIN);
    expect(result.status).toBe("uncertain");
    expect(net.writes()).toEqual(["put:PAYU_ENV"]); // żadnego cofania, żadnych dalszych zapisów
    expect(result.keys.PAYU_ENV).toBe("applied");
    expect(text).toMatch(/PAYU_ENV: STAN NIEPEWNY/);
    expect(text).toMatch(/zmiana WESZŁA/);
    expect(text).toMatch(/KONTROLA KOŃCOWA:/);
    expect(result.productionDiff).toEqual([]);
    expect(result.exposed.length).toBeGreaterThan(0); // reszta kluczy nietknięta — raport to pokazuje
    expectNoSecrets(text);
  });
  it("zapis przerwany timeoutem, ale wykonany po stronie serwera: kod 2, stan „weszła”", async () => {
    const net = new FakeNetlify();
    const put = net.putVar.bind(net);
    net.putVar = async (key, body) => { await put(key, body); throw timeout(); };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.UNCERTAIN);
    expect(net.writes()).toEqual(["put:PAYU_ENV"]);
    expect(result.keys.PAYU_ENV).toBe("applied");
    expectNoSecrets(text);
  });
  it("zapis przerwany przed wykonaniem: kod 2, stan „nie weszła”, bez dalszych zapisów", async () => {
    const net = new FakeNetlify();
    net.putVar = async function (key) { this.calls.push(`put:${key}`); throw timeout(); };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.UNCERTAIN);
    expect(net.writes()).toEqual(["put:PAYU_ENV"]);
    expect(result.keys.PAYU_ENV).toBe("not_applied");
    expect(text).toMatch(/zmiana NIE weszła/);
  });
  it("serwer jednoznacznie odrzucił zapis i stan jest wyjściowy: kod 1 (nie „niepewny”)", async () => {
    const net = new FakeNetlify();
    net.putVar = async function (key) { this.calls.push(`put:${key}`); throw new SafeError("zapis: serwer odrzucił żądanie (HTTP 403)", { status: 403, rejected: true }); };
    const { result } = await run(net);
    expect(result.exitCode).toBe(EXIT.FAILED);
    expect(net.writes()).toEqual(["put:PAYU_ENV"]);
  });
  it("po zapisie nie da się już nic odczytać: kod 2, stan nieznany, jawny komunikat o braku kontroli końcowej", async () => {
    const net = new FakeNetlify();
    const put = net.putVar.bind(net);
    let dead = false;
    net.putVar = async (key, body) => { await put(key, body); dead = true; };
    const get = net.getVar.bind(net), list = net.listVars.bind(net);
    net.getVar = async (key) => { if (dead) throw timeout(); return get(key); };
    net.listVars = async () => { if (dead) throw timeout(); return list(); };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.UNCERTAIN);
    expect(result.keys.PAYU_ENV).toBe("unknown");
    expect(result.productionDiff).toBeNull();
    expect(text).toMatch(/KONTROLA KOŃCOWA NIEMOŻLIWA/);
    expect(text).not.toMatch(/WYNIK: OK/);
    expectNoSecrets(text);
  });
  it("błąd odczytu po usunięciu wpisu sekretu: kod 2, bez kolejnych usunięć", async () => {
    const net = new FakeNetlify();
    const del = net.deleteValue.bind(net), get = net.getVar.bind(net);
    let failNext = false;
    net.deleteValue = async (key, id) => { const r = await del(key, id); failNext = true; return r; };
    net.getVar = async (key) => { if (failNext) { failNext = false; throw timeout(); } return get(key); };
    const { result } = await run(net);
    expect(result.exitCode).toBe(EXIT.UNCERTAIN);
    expect(net.writes().filter((c) => c.startsWith("del:")).length).toBe(1);
    expect(result.keys.RESEND_API_KEY).toBe("applied");
  });
});

describe("jednoznaczna niezgodność po zapisie", () => {
  it("serwer zapisał inną wartość produkcyjną: przywrócenie „all”, potwierdzenie, kod 1", async () => {
    const net = new FakeNetlify();
    const put = net.putVar.bind(net);
    let first = true;
    net.putVar = async (key, body) => {
      if (first) { first = false; return put(key, { ...body, values: body.values.map((x) => (x.context === "production" ? { ...x, value: "zepsute" } : x)) }); }
      return put(key, body);
    };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.FAILED);
    expect(net.writes()).toEqual(["put:PAYU_ENV", "put:PAYU_ENV"]);
    expect(net.real("PAYU_ENV", "production")).toBe(SECRETS.PAYU_ENV);
    expect(net.find("PAYU_ENV").values.map((x) => x.context)).toEqual(["all"]);
    expect(text).toMatch(/przywrócono stan wyjściowy/);
    expectNoSecrets(text);
  });
  it("przywracanie też zawodzi: kod 2, żadnych dalszych zapisów", async () => {
    const net = new FakeNetlify();
    const put = net.putVar.bind(net);
    let n = 0;
    net.putVar = async (key, body) => {
      n += 1;
      if (n === 1) return put(key, { ...body, values: [...body.values, { context: "deploy-preview", value: body.values[0].value }] });
      net.calls.push(`put:${key}`); throw timeout();
    };
    const { result } = await run(net);
    expect(result.exitCode).toBe(EXIT.UNCERTAIN);
    expect(net.writes().length).toBe(2);
  });
});

describe("zamaskowane sekrety: niezmienność potwierdza identyfikator wpisu", () => {
  it("wpis production sekretu dostał nowy identyfikator przy tej samej zamaskowanej postaci: wykryte, kod inny niż 0", async () => {
    const net = new FakeNetlify();
    const del = net.deleteValue.bind(net);
    net.deleteValue = async (key, id) => {
      await del(key, id);
      const p = net.find(key).values.find((x) => x.context === "production");
      p.id = "podmieniony-" + p.id; // ta sama wartość, inny wpis
      return true;
    };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.UNCERTAIN);
    expect(text).toMatch(/RESEND_API_KEY \/ deploy-preview: po usunięciu stan jest INNY niż oczekiwany/);
    expect(result.productionDiff).toContain("RESEND_API_KEY");
    expect(net.writes().filter((c) => c.startsWith("del:")).length).toBe(1);
  });
  it("niezwiązany sekret zmieniony w trakcie przebiegu psuje kontrolę produkcji (kod 1)", async () => {
    const net = new FakeNetlify();
    const list = net.listVars.bind(net);
    let calls = 0;
    net.listVars = async () => { if (++calls === 2) net.find("MARKETING_UNSUBSCRIBE_SECRET").values[0].id = "inny"; return list(); };
    const { result, text } = await run(net);
    expect(result.exitCode).toBe(EXIT.FAILED);
    expect(result.productionDiff).toEqual(["MARKETING_UNSUBSCRIBE_SECRET"]);
    expect(text).toMatch(/PRODUKCJA SIĘ ZMIENIŁA/);
  });
});

describe("[P1] sekrety poza linią poleceń i poza komunikatami błędów", () => {
  it("toSafeError odrzuca oryginalny komunikat", () => {
    const e = toSafeError(timeout(), "zapis");
    expect(e).toBeInstanceOf(SafeError);
    expect(e.message).toBe("zapis: błąd ETIMEDOUT — szczegóły ukryte");
    expect(e.message.includes(SECRETS.PAYU_SECOND_KEY)).toBe(false);
    expect(toSafeError(new Error(`Command failed: netlify api --data ${SECRETS.FM_EXPORT_TOKEN}`), "x").message).toBe("x: błąd — szczegóły ukryte");
  });
  it("odczyt przez CLI przyjmuje wyłącznie identyfikatory", () => {
    expect(assertReadOnlyArgs("getEnvVar", { account_id: "acc123", key: "PAYU_ENV", site_id: "site-1" })).toBe(true);
    expect(() => assertReadOnlyArgs("updateEnvVar", { account_id: "a", key: "K", site_id: "s" })).toThrow(/nie jest odczytem/);
    expect(() => assertReadOnlyArgs("getEnvVar", { account_id: "a", key: "K", site_id: "s", body: { values: [] } })).toThrow(/nie jest identyfikatorem/);
    expect(() => assertReadOnlyArgs("getEnvVar", { key: 'K" && echo x' })).toThrow(/nie jest identyfikatorem/);
  });
  it("zapis HTTPS: wartość tylko w treści żądania, token tylko w nagłówku", async () => {
    const seen = [];
    const fetchImpl = async (url, init) => { seen.push({ url, init }); return { ok: true, status: 200 }; };
    const w = createHttpWriter({ fetchImpl, token: "TOKEN-TAJNY", accountId: "acc", siteId: "site" });
    await w.putVar("PAYU_SECOND_KEY", { key: "PAYU_SECOND_KEY", scopes: ["functions"], is_secret: false, values: [{ context: "production", value: SECRETS.PAYU_SECOND_KEY }] });
    await w.deleteValue("RESEND_API_KEY", "e42");
    expect(seen[0].url).toBe("https://api.netlify.com/api/v1/accounts/acc/env/PAYU_SECOND_KEY?site_id=site");
    expect(seen[0].init.method).toBe("PUT");
    expect(seen[0].url.includes(SECRETS.PAYU_SECOND_KEY)).toBe(false);
    expect(JSON.parse(seen[0].init.body).values[0].value).toBe(SECRETS.PAYU_SECOND_KEY);
    expect(seen[0].init.headers.Authorization).toBe("Bearer TOKEN-TAJNY");
    expect(seen[1].url).toBe("https://api.netlify.com/api/v1/accounts/acc/env/RESEND_API_KEY/value/e42?site_id=site");
    expect(seen[1].init.method).toBe("DELETE");
    expect(seen[1].init.body).toBeUndefined();
  });
  it("błędy zapisu HTTPS nie zawierają treści odpowiedzi, wartości ani tokenu", async () => {
    const body = { key: "K", scopes: [], is_secret: false, values: [{ context: "production", value: SECRETS.PAYU_SECOND_KEY }] };
    const mk = (fetchImpl) => createHttpWriter({ fetchImpl, token: "TOKEN-TAJNY", accountId: "acc", siteId: "site" });
    const rejected = await mk(async () => ({ ok: false, status: 422, text: async () => `echo ${SECRETS.PAYU_SECOND_KEY}` })).putVar("K", body).catch((e) => e);
    expect(rejected).toBeInstanceOf(SafeError);
    expect(rejected.rejected).toBe(true);
    expect(rejected.message).toBe("zapis K: serwer odrzucił żądanie (HTTP 422)");
    const server = await mk(async () => ({ ok: false, status: 502 })).putVar("K", body).catch((e) => e);
    expect(server.rejected).toBe(false);
    expect(server.message).toMatch(/nie wiadomo, czy żądanie zostało wykonane/);
    const network = await mk(async () => { throw Object.assign(new Error(`socket hang up; Authorization: Bearer TOKEN-TAJNY; ${SECRETS.PAYU_SECOND_KEY}`), { code: "ECONNRESET" }); }).putVar("K", body).catch((e) => e);
    expect(network.message).toBe("zapis K: brak odpowiedzi (ECONNRESET) — nie wiadomo, czy żądanie doszło");
    for (const e of [rejected, server, network]) {
      expect(e.message.includes("TOKEN-TAJNY")).toBe(false);
      expect(e.message.includes(SECRETS.PAYU_SECOND_KEY)).toBe(false);
    }
  });
  it("token: zmienna środowiska ma pierwszeństwo, potem konfiguracja CLI; brak → błąd bez treści", () => {
    const files = { "C:/AppData/netlify/Config/config.json": JSON.stringify({ userId: "u1", users: { u1: { auth: { token: "Z-PLIKU" } } } }) };
    const readFile = (f) => { if (!(f in files)) throw new Error("ENOENT"); return files[f]; };
    const base = { readFile, platform: "win32", homedir: "C:/Users/x", appData: "C:/AppData" };
    expect(loadNetlifyToken({ ...base, env: { NETLIFY_AUTH_TOKEN: "Z-ENV" } })).toBe("Z-ENV");
    expect(loadNetlifyToken({ ...base, env: {} })).toBe("Z-PLIKU");
    expect(() => loadNetlifyToken({ ...base, env: {}, appData: "C:/Inne" })).toThrow(/nie znaleziono tokenu Netlify/);
  });
  it("nakładka 07: jedyne wywołanie procesu to odczyt z kontrolą argumentów; zapis wymaga --apply", () => {
    const src = readFileSync(new URL("../docs/production/wdrozenie-kredyty-wejscie-kupca-2026-11-13/07-odciecie-sekretow-od-podgladow.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
    expect(src.match(/execSync\(/g).length).toBe(1);
    expect(src).toMatch(/function read\(op, data\) \{\n  assertReadOnlyArgs\(op, data\);/);
    expect(src).not.toMatch(/updateEnvVar|deleteEnvVarValue|createEnvVars/);
    expect(src).toMatch(/const APPLY = process\.argv\.includes\("--apply"\);/);
    expect(src).toMatch(/dry: !APPLY/);
    expect(src).not.toMatch(/console\.(log|error)\([^)]*\.(message|stack)\b(?![^)]*toSafeError)/);
    const lib = readFileSync(new URL("../scripts/lib/netlify-context-isolation.mjs", import.meta.url), "utf8");
    expect(lib).not.toMatch(/child_process/);
  });
});
