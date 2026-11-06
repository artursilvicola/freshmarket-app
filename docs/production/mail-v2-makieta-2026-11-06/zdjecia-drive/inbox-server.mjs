// Lokalny odbiornik miniatur z Google Drive (tylko na czas planszy kontaktowej).
// Przeglądarka Artura (zalogowana do Drive) pobiera podglądy `drive.google.com/thumbnail?id=…&sz=w1600`
// i wysyła je POST-em tutaj; serwer zapisuje je do katalogu `inbox/`. Nic nie zmienia na Drive.
//   node inbox-server.mjs   (port 8766)
import http from "node:http";
import { mkdirSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const inbox = path.join(here, "inbox");
mkdirSync(inbox, { recursive: true });
const safe = (s) => String(s || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);

http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Private-Network": "true", "Access-Control-Max-Age": "600" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, "http://localhost");
  if (req.method === "GET" && url.pathname === "/list") {
    const files = existsSync(inbox) ? readdirSync(inbox).map((f) => ({ f, bytes: statSync(path.join(inbox, f)).size })) : [];
    res.writeHead(200, { ...cors, "content-type": "application/json" }); return res.end(JSON.stringify(files));
  }
  if (req.method === "POST" && url.pathname === "/save") {
    const name = safe(url.searchParams.get("name"));
    if (!name) { res.writeHead(400, cors); return res.end("name"); }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      if (buf.length < 1000 || buf.length > 12_000_000) { res.writeHead(400, cors); return res.end("size"); }
      writeFileSync(path.join(inbox, name), buf);
      res.writeHead(200, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, name, bytes: buf.length }));
    });
    return;
  }
  res.writeHead(200, { ...cors, "content-type": "text/plain" }); res.end("photo-inbox ok");
}).listen(8766, "127.0.0.1", () => console.log("photo-inbox on http://127.0.0.1:8766 ->", inbox));
