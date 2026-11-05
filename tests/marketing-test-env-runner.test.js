// [feat/marketing-activation] Przygotowanie bazy testowej na ATRAPIE klienta (bez bazy):
// jawne kody wyjścia, migracja + rejestr w jednej transakcji, ROLLBACK przy każdej awarii,
// pominięcie zarejestrowanych plików, odmowa dla niepustej bazy bez rejestru.
import { describe, it, expect } from "vitest";
import { prepareTestDatabase, stripTxWrappers, REGISTRY } from "../scripts/lib/test-env-runner.mjs";

function fakeClient({ registryExists = false, companiesExist = false, registered = [], failOn = null, state = null } = {}) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push(params ? [sql, params] : sql);
      if (failOn && failOn(sql, params, calls)) throw new Error("symulowana awaria: " + String(sql).slice(0, 40));
      if (sql.includes(`to_regclass('${REGISTRY}')`)) return { rows: [{ ok: registryExists }] };
      if (sql.includes("to_regclass('public.companies')")) return { rows: [{ ok: companiesExist }] };
      if (sql === `select filename from ${REGISTRY}`) return { rows: registered.map((filename) => ({ filename })) };
      if (sql.startsWith("select\n    (select count(*)::int from public.companies")) return { rows: [state || { test_companies: 11, test_operators: 12, admins: 1, packages: 9, suppressions: 1, marketing_tables: true, migrations_registered: 2 }] };
      return { rows: [] };
    },
  };
  return client;
}
const files = ["001_a.sql", "002_b.sql"];
const readMigration = (f) => `begin;\ncreate table ${f.replace(".sql", "")} (id int);\ncommit;\n`;
const seeds = [{ name: "seed.sql", sql: "begin;\ninsert into x values (1);\ncommit;" }];
const run = (client, over = {}) => prepareTestDatabase({ client, files, readMigration, seeds, ...over });

describe("stripTxWrappers", () => {
  it("usuwa tylko samodzielne begin;/commit;", () => {
    expect(stripTxWrappers("BEGIN;\nselect 1; -- commit; w komentarzu\ncommit;\n")).toBe("select 1; -- commit; w komentarzu");
    expect(stripTxWrappers("  begin ;  \n insert into t values ('begin;');\nCOMMIT; -- koniec")).toBe(" insert into t values ('begin;');");
  });
});

describe("prepareTestDatabase", () => {
  it("sukces: każda migracja = BEGIN → SQL → INSERT rejestr → COMMIT; seedy w transakcji; zwraca 0", async () => {
    const c = fakeClient();
    expect(await run(c)).toBe(0);
    const seq = c.calls.map((x) => (Array.isArray(x) ? x[0] : x));
    const i = seq.indexOf("begin");
    expect(seq.slice(i, i + 4)).toEqual(["begin", "create table 001_a (id int);", `insert into ${REGISTRY} (filename) values ($1)`, "commit"]);
    expect(c.calls.find((x) => Array.isArray(x) && x[1][0] === "001_a.sql")).toBeTruthy();
    expect(seq.filter((s) => s === "commit")).toHaveLength(files.length + seeds.length);
    expect(seq).toContain(`create table ${REGISTRY} (filename text primary key, applied_at timestamptz not null default now())`);
  });
  it("[P1] błąd SQL migracji → ROLLBACK, brak wpisu do rejestru, JAWNY kod 1 (nie undefined)", async () => {
    const c = fakeClient({ failOn: (sql) => sql === "create table 002_b (id int);" });
    const code = await run(c);
    expect(code).toBe(1);
    const seq = c.calls.map((x) => (Array.isArray(x) ? x[0] : x));
    expect(seq[seq.length - 1]).toBe("rollback");
    expect(c.calls.filter((x) => Array.isArray(x) && x[1][0] === "002_b.sql")).toHaveLength(0);
    expect(seq).not.toContain("insert into x values (1);");  // seedy nie ruszyły
  });
  it("[P2] awaria MIĘDZY wykonaniem SQL a wpisem do rejestru → ROLLBACK całej transakcji (SQL też wycofany), kod 1", async () => {
    const c = fakeClient({ failOn: (sql, params) => sql.startsWith(`insert into ${REGISTRY}`) && params?.[0] === "001_a.sql" });
    expect(await run(c)).toBe(1);
    const seq = c.calls.map((x) => (Array.isArray(x) ? x[0] : x));
    const i = seq.indexOf("begin");
    expect(seq.slice(i, i + 4)).toEqual(["begin", "create table 001_a (id int);", `insert into ${REGISTRY} (filename) values ($1)`, "rollback"]);
    expect(seq).not.toContain("commit");
  });
  it("awaria w ROLLBACK po błędzie nie maskuje kodu 1", async () => {
    const c = fakeClient({ failOn: (sql) => sql === "create table 001_a (id int);" || sql === "rollback" });
    expect(await run(c)).toBe(1);
  });
  it("zarejestrowane pliki są pomijane (dokładnie raz)", async () => {
    const c = fakeClient({ registryExists: true, registered: ["001_a.sql"] });
    expect(await run(c)).toBe(0);
    const seq = c.calls.map((x) => (Array.isArray(x) ? x[0] : x));
    expect(seq).not.toContain("create table 001_a (id int);");
    expect(seq).toContain("create table 002_b (id int);");
  });
  it("niepusta baza bez rejestru → odmowa 3, bez żadnej migracji", async () => {
    const c = fakeClient({ companiesExist: true });
    expect(await run(c)).toBe(3);
    expect(c.calls.map((x) => (Array.isArray(x) ? x[0] : x))).not.toContain("begin");
  });
  it("błąd seedu → ROLLBACK i 1; rozjazd stanu końcowego → 1", async () => {
    const c = fakeClient({ failOn: (sql) => sql === "insert into x values (1);" });
    expect(await run(c)).toBe(1);
    expect(c.calls[c.calls.length - 1]).toBe("rollback");
    const c2 = fakeClient({ state: { test_companies: 8, test_operators: 10, marketing_tables: true, migrations_registered: 2 } });
    expect(await run(c2)).toBe(1);
    const c3 = fakeClient({ state: { test_companies: 11, test_operators: 12, marketing_tables: true, migrations_registered: 1 } });
    expect(await run(c3)).toBe(1);
  });
});
