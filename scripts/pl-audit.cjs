// [P2-final-qa C1] PL string audit — categorise every file containing
// Polish text in src/, netlify/functions/, public/, supabase/auth-email-templates/.
// Skips: i18n JSON (legitimately PL), docs (KOMPENDIUM/legal/i18n), node_modules, dist, .git.
//
// [P2-final-qa post-review] Detection is now TWO-pass:
//   (a) Polish diacritics (original) — `[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]`
//   (b) ASCII-only Polish markers — case-insensitive word boundaries for
//       "Brak", "Nie udalo|Nie udało", "wymaga", "wymagane", "Niepoprawny",
//       "sprobuj|spróbuj", "Upload OK, ale", "wymagany", "Konto bez roli".
// (b) is what Codex flagged: db.js had user-facing throws like "Brak aktywnej
// sesji." (no diacritics) which slipped the original audit.
//
// Each hit is tagged `{ kind: 'diacritic' | 'ascii' }` so downstream report
// can prioritise ASCII-only language debt before merge.

const fs = require("fs");
const path = require("path");

const PL_DIACRITIC_PAT = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
const PL_ASCII_PAT = /\b(Brak|Nie udalo|Nie udało|wymaga|wymagane|wymagany|Niepoprawny|Niepoprawna|sprobuj|spróbuj|Konto bez roli)\b|Upload OK, ale/i;
const PL_PAT = new RegExp(PL_DIACRITIC_PAT.source + "|" + PL_ASCII_PAT.source);
const stats = {};
const issues = [];

function walk(dir, opts) {
  opts = opts || {};
  const allowExts = opts.allowExts || [".js", ".jsx", ".ts", ".tsx", ".json", ".html", ".css", ".svg", ".md", ".txt"];
  const skipDirs = new Set(["node_modules", "dist", ".git", "build", ".netlify", "storybook-static"]);
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(path.join(dir, entry.name), opts);
      continue;
    }
    if (!allowExts.includes(path.extname(entry.name))) continue;
    const file = path.join(dir, entry.name);
    const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
    // Skip i18n PL JSON (legitimately PL).
    if (rel.startsWith("src/i18n/pl/")) continue;
    let content;
    try { content = fs.readFileSync(file, "utf8"); }
    catch { continue; }
    if (!PL_PAT.test(content)) continue;
    const lines = content.split("\n");
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const hasDiacritic = PL_DIACRITIC_PAT.test(line);
      const hasAscii = PL_ASCII_PAT.test(line);
      if (!hasDiacritic && !hasAscii) continue;
      const trim = line.trim();
      const isComment = trim.startsWith("//") || trim.startsWith("*") || trim.startsWith("/*") || trim.startsWith("#");
      // 'kind' priority: ascii > diacritic when both present (the ASCII-only
      // markers are the new high-priority signal for Codex review).
      const kind = hasAscii ? "ascii" : "diacritic";
      hits.push({ line: i + 1, text: trim.slice(0, 200), comment: isComment, kind: kind });
    }
    if (!hits.length) continue;
    const codeHits = hits.filter(function (h) { return !h.comment; });
    const commentHits = hits.filter(function (h) { return h.comment; });
    const codeAscii = codeHits.filter(function (h) { return h.kind === "ascii"; });
    stats[rel] = {
      total: hits.length,
      comments: commentHits.length,
      code: codeHits.length,
      code_ascii: codeAscii.length,
    };
    if (codeHits.length > 0) issues.push({ file: rel, code: codeHits });
  }
}

walk("src");
walk("netlify/functions");
walk("public");
walk("supabase/auth-email-templates", { allowExts: [".html", ".txt"] });

const out = {
  files_with_pl_total: Object.keys(stats).length,
  files_with_code_pl: issues.length,
  total_code_hits: issues.reduce(function (a, x) { return a + x.code.length; }, 0),
  total_code_ascii_hits: issues.reduce(function (a, x) {
    return a + x.code.filter(function (h) { return h.kind === "ascii"; }).length;
  }, 0),
  stats: stats,
  issues: issues.map(function (x) {
    const ascii = x.code.filter(function (h) { return h.kind === "ascii"; });
    return {
      file: x.file,
      count: x.code.length,
      count_ascii: ascii.length,
      first5: x.code.slice(0, 5),
      ascii_hits: ascii.slice(0, 10),
    };
  }),
};
console.log(JSON.stringify(out, null, 2));
