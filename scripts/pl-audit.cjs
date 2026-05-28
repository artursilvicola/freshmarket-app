// [P2-final-qa C1] PL string audit — categorise every file containing
// Polish diacritics in src/, netlify/functions/, public/, supabase/auth-email-templates/.
// Skips: i18n JSON (legitimately PL), docs (KOMPENDIUM/legal/i18n), node_modules, dist, .git.

const fs = require("fs");
const path = require("path");

const PL_PAT = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;
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
      if (!PL_PAT.test(lines[i])) continue;
      const trim = lines[i].trim();
      const isComment = trim.startsWith("//") || trim.startsWith("*") || trim.startsWith("/*") || trim.startsWith("#");
      hits.push({ line: i + 1, text: trim.slice(0, 200), comment: isComment });
    }
    if (!hits.length) continue;
    const codeHits = hits.filter(function (h) { return !h.comment; });
    const commentHits = hits.filter(function (h) { return h.comment; });
    stats[rel] = { total: hits.length, comments: commentHits.length, code: codeHits.length };
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
  stats: stats,
  issues: issues.map(function (x) { return { file: x.file, count: x.code.length, first5: x.code.slice(0, 5) }; }),
};
console.log(JSON.stringify(out, null, 2));
