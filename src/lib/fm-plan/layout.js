// [feat/fm-plan-export] Układ kart spotkań B2B dla pdfmake — port zaakceptowanego
// projektu HTML (artifact „Karta Spotkań FM 2026" v7, 5.09.2026).
// Zasady wbudowane w układ:
//   • jeden język na kartę (card.lang), • wiersz tabeli nigdy nie jest cięty
//   (dontBreakRows), • nazwa firmy/sieci w nagłówku i stopce KAŻDEJ strony,
//   • karta dostawcy bez danych kupców; karta sieci z logo/krajem/opisem/kontaktem dostawcy,
//   • GATE 1 = pełna plakietka, GATE 2 = obrys (czytelne w druku cz-b).
import { T, EVENT, contactsLine } from "./i18n.js";
import { FM_LOGO_DATA_URI, SPONSOR_LOGOS } from "./assets.js";

const C = { ink: "#14211a", ink2: "#3d4a43", mute: "#6c7a72", rule: "#d9e2dc", ruleStrong: "#b9c6be",
  brand: "#1f8f4e", brandDeep: "#166b3b", tint: "#eaf5ee", warn: "#b45309", warnTint: "#fdf3e4", warnInk: "#5a3d12" };
const MM = 2.8346; // pt na mm
const PAGE = { w: 595.28, h: 841.89, left: 13 * MM, right: 13 * MM, top: 30 * MM, bottom: 16 * MM };

const noBorders = { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 };
const rowLines = {
  hLineWidth: (i, node) => (i === 0 ? 0 : i === 1 || i === node.table.body.length ? 1.2 : 0.6),
  hLineColor: (i, node) => (i === 1 || i === node.table.body.length ? C.ink : C.rule),
  vLineWidth: () => 0, paddingLeft: (i) => (i === 0 ? 0 : 5), paddingRight: () => 5, paddingTop: () => 6, paddingBottom: () => 6,
};

function logoTile(dataUri, fallbackText, w, h, color) {
  // kafelek logo: obraz dopasowany do ramki, fallback: wordmark/inicjały
  const inner = dataUri
    ? { image: dataUri, fit: [w - 6, h - 6], alignment: "center", margin: [0, 2, 0, 0] }
    : { text: fallbackText, font: "Barlow", bold: true, fontSize: fallbackText.length > 12 ? 8 : 9.5, color: color || C.ink, alignment: "center", margin: [0, (h - 11) / 2, 0, 0] };
  return {
    table: { widths: [w], heights: [h], body: [[inner]] },
    layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => C.ruleStrong, vLineColor: () => C.ruleStrong, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 0, paddingBottom: () => 0 },
  };
}

function gatePill(gate) {
  const g = gate === 2 ? 2 : gate === 1 ? 1 : null;
  const text = g ? `GATE ${g}` : "GATE ?";
  const filled = g === 1;
  return {
    table: { widths: [44], body: [[{ text, font: "Barlow", bold: true, fontSize: 10.5, alignment: "center", color: filled ? "#ffffff" : C.ink, fillColor: filled ? C.ink : null, margin: [0, 2, 0, 2] }]] },
    layout: { hLineWidth: () => 1.2, vLineWidth: () => 1.2, hLineColor: () => C.ink, vLineColor: () => C.ink, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
    alignment: "right",
  };
}

function headerBlock(card, t) {
  return {
    margin: [PAGE.left, 11 * MM, PAGE.right, 0],
    stack: [
      { columns: [
        { image: FM_LOGO_DATA_URI, fit: [70, 34], width: 72 },
        { width: "*", alignment: "right", stack: [
          { text: EVENT.name, font: "Barlow", bold: true, fontSize: 19, color: C.brandDeep, lineHeight: 0.95 },
          { text: t.event_meta, fontSize: 8.5, color: C.ink2, margin: [0, 3, 0, 0] },
        ] },
      ] },
      { canvas: [{ type: "line", x1: 0, y1: 5, x2: PAGE.w - PAGE.left - PAGE.right, y2: 5, lineWidth: 2.2, lineColor: C.ink }] },
    ],
  };
}

function footerLine(card, t, page, pages) {
  const pg = pages > 1 ? ` · ${t.pagew} ${page}/${pages}` : "";
  return {
    margin: [PAGE.left, 4 * MM, PAGE.right, 0],
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: PAGE.w - PAGE.left - PAGE.right, y2: 0, lineWidth: 0.8, lineColor: C.ruleStrong }] },
      { columns: [
        { text: `${t.card} ${card.card} · ${card.name}${pg}`.toUpperCase(), fontSize: 7, color: C.mute, characterSpacing: 0.4, margin: [0, 4, 0, 0] },
        { text: t.version, fontSize: 7, color: C.mute, alignment: "right", margin: [0, 4, 0, 0] },
      ] },
    ],
  };
}

function titleBlock(card, t, kind) {
  const n = card.meetings.length;
  return {
    columns: [
      { text: kind === "supplier" ? t.title : t.title_chain, font: "Barlow", bold: true, fontSize: 22, lineHeight: 0.95 },
      { width: "auto", alignment: "right", stack: [
        { text: String(n), font: "Barlow", bold: true, fontSize: 24, lineHeight: 0.9 },
        { text: t.meetingsWord(n), fontSize: 8.5, color: C.mute },
      ] },
    ],
    margin: [0, 3 * MM, 0, 3 * MM],
  };
}

function identityBand(card, t, kind) {
  const left = [
    { text: (kind === "supplier" ? t.supplier : t.chain).toUpperCase(), fontSize: 7.5, characterSpacing: 0.8, color: C.brandDeep, bold: true },
    { text: card.name, font: "Barlow", bold: true, fontSize: 18, lineHeight: 1, margin: [0, 2, 0, 0] },
  ];
  if (kind === "supplier") {
    const c = card.contact; const who = c.name ? `${c.name}${c.position ? ", " + c.position : ""}` : "";
    left.push({ text: [card.countryName, who ? " · " : "", { text: who, bold: true }], fontSize: 9, color: C.ink2, margin: [0, 3, 0, 0] });
  } else if (card.buyers && card.buyers.length) {
    left.push({ text: card.buyers.map((b) => `${b.name}${b.position ? " — " + b.position : ""}${b.cats && b.cats.length ? " (" + b.cats.join(", ") + ")" : ""}`).join("   ·   "), fontSize: 9, color: C.ink2, margin: [0, 3, 0, 0] });
  }
  const right = kind === "supplier"
    ? { width: "auto", alignment: "right", stack: [{ text: t.pkg, fontSize: 8.5, color: C.ink2 }, { text: card.pkg, bold: true, fontSize: 9.5, margin: [0, 2, 0, 0] }] }
    : { width: "auto", alignment: "right", stack: [{ text: t.gate, fontSize: 8.5, color: C.ink2, margin: [0, 0, 0, 3] }, gatePill(card.gate)] };
  return {
    table: { widths: ["*", "auto"], body: [[{ stack: left, border: [true, false, false, false] }, right]] },
    layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => C.brand, fillColor: () => C.tint, paddingLeft: (i) => (i === 0 ? 10 : 6), paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 8 },
    margin: [0, 0, 0, 4 * MM],
  };
}

const th = (text, align) => ({ text: text.toUpperCase(), fontSize: 7.2, characterSpacing: 0.7, color: C.mute, bold: true, alignment: align || "left", margin: [0, 0, 0, 2] });

export function supplierDoc(card, { mode = "final" } = {}) {
  const t = T[card.lang];
  const rows = card.meetings.map((m) => [
    { text: String(m.nr).padStart(2, "0"), font: "Barlow", bold: true, fontSize: 20, lineHeight: 0.9, margin: [0, 2, 0, 0] },
    { columns: [
      { width: 62, ...logoTile(m.chain.logo, m.chain.name, 60, 26, m.chain.color) },
      { width: "*", stack: [{ text: m.chain.name, bold: true, fontSize: 11, lineHeight: 1.05 }, { text: m.chain.countryName, fontSize: 8, color: C.mute, margin: [0, 2, 0, 0] }], margin: [4, 3, 0, 0] },
    ], columnGap: 4 },
    { text: m.chain.cats.join(" · "), fontSize: 9.5, margin: [0, 6, 0, 0] },
    { ...gatePill(m.chain.gate), margin: [0, 4, 0, 0] },
  ]);
  const table = rows.length ? {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [42, "*", 140, 60],
      body: [[th(t.th_nr), th(t.th_chain), th(t.th_cat), th(t.th_gate, "right")], ...rows] },
    layout: rowLines,
  } : { text: "—", color: C.mute };

  const how = {
    unbreakable: true, margin: [0, 6 * MM, 0, 0],
    table: { widths: ["*"], body: [[{
      columns: [
        { width: "58%", stack: [
          { text: t.how_h.toUpperCase(), font: "Barlow", bold: true, fontSize: 11.5, margin: [0, 0, 0, 4] },
          { text: t.how_intro, fontSize: 8.6, color: C.ink2, lineHeight: 1.25, margin: [0, 0, 0, 4] },
          { ol: t.how_steps.map((s) => ({ text: s, fontSize: 8.6, lineHeight: 1.25, margin: [0, 0, 0, 2] })), color: C.brandDeep },
        ] },
        { width: "*", stack: [
          { text: t.how_time_h.toUpperCase(), font: "Barlow", bold: true, fontSize: 11.5, margin: [0, 0, 0, 4] },
          { text: t.how_time, fontSize: 8.6, color: C.ink2, lineHeight: 1.25, margin: [0, 0, 0, 6] },
          { table: { widths: ["*"], body: [[{ text: [{ text: t.miss_h + " ", bold: true, color: C.warn }, t.miss], fontSize: 8.3, color: C.warnInk, lineHeight: 1.25, fillColor: C.warnTint, margin: [6, 5, 6, 5] }]] },
            layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 2 : 0), vLineColor: () => C.warn, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 } },
        ] },
      ], columnGap: 14,
    }]] },
    layout: { hLineWidth: () => 0.8, vLineWidth: () => 0.8, hLineColor: () => C.ruleStrong, vLineColor: () => C.ruleStrong, paddingLeft: () => 11, paddingRight: () => 11, paddingTop: () => 9, paddingBottom: () => 9 },
  };

  return docDefinition(card, t, "supplier", [titleBlock(card, t, "supplier"), identityBand(card, t, "supplier"), table, how, contactsBlock(t)], mode);
}

export function chainDoc(card, { mode = "final" } = {}) {
  const t = T[card.lang];
  const rows = card.meetings.map((m) => {
    const s = m.supplier;
    return [
      { text: String(m.nr).padStart(2, "0"), font: "Barlow", bold: true, fontSize: 15, lineHeight: 0.9, margin: [0, 3, 0, 0] },
      { columns: [
        { width: 70, ...logoTile(s.logo, s.initials, 68, 34) },
        { width: "*", stack: [
          { text: s.name, bold: true, fontSize: 10.5, lineHeight: 1.05 },
          { text: [{ text: s.country, bold: true, color: C.ink2, characterSpacing: 0.4 }, ` · ${s.countryName} · ${s.pkg}`], fontSize: 8, color: C.mute, margin: [0, 1.5, 0, 0] },
          s.desc ? { text: s.desc, fontSize: 8.2, color: C.ink2, lineHeight: 1.25, margin: [0, 3, 0, 0] } : null,
        ].filter(Boolean), margin: [4, 1, 0, 0] },
      ], columnGap: 4 },
      { stack: [{ text: s.contact.name || "—", fontSize: 9, margin: [0, 3, 0, 0] }, s.contact.phone ? { text: s.contact.phone, fontSize: 8.5, color: C.mute, margin: [0, 2, 0, 0] } : null].filter(Boolean) },
    ];
  });
  const table = rows.length ? {
    table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths: [36, "*", 130],
      body: [[th(t.th_nr), th(t.th_sup), th(t.th_person)], ...rows] },
    layout: { ...rowLines, paddingTop: () => 5, paddingBottom: () => 5 },
  } : { text: "—", color: C.mute };

  const info = {
    unbreakable: true, margin: [0, 6 * MM, 0, 0],
    table: { widths: ["*"], body: [[{
      columns: [
        { width: "60%", stack: [
          { text: t.info_h.toUpperCase(), font: "Barlow", bold: true, fontSize: 11.5, margin: [0, 0, 0, 4] },
          { ul: t.info.map((s) => ({ text: s, fontSize: 8.8, lineHeight: 1.3, margin: [0, 0, 0, 2] })), color: C.brand },
        ] },
        { width: "*", stack: [
          { table: { widths: ["*"], body: [[{ text: t.info_team, fontSize: 8.6, color: C.ink2, lineHeight: 1.3, fillColor: C.tint, margin: [7, 6, 7, 6] }]] },
            layout: { hLineWidth: () => 0, vLineWidth: (i) => (i === 0 ? 3 : 0), vLineColor: () => C.brand, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 }, margin: [0, 18, 0, 0] },
        ] },
      ], columnGap: 14,
    }]] },
    layout: { hLineWidth: () => 0.8, vLineWidth: () => 0.8, hLineColor: () => C.ruleStrong, vLineColor: () => C.ruleStrong, paddingLeft: () => 11, paddingRight: () => 11, paddingTop: () => 9, paddingBottom: () => 9 },
  };

  return docDefinition(card, t, "chain", [titleBlock(card, t, "chain"), identityBand(card, t, "chain"), table, info, contactsBlock(t)], mode);
}

function contactsBlock(t) {
  return {
    unbreakable: true, margin: [0, 5 * MM, 0, 0],
    stack: [
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: PAGE.w - PAGE.left - PAGE.right, y2: 0, lineWidth: 0.8, lineColor: C.ruleStrong }] },
      { columns: [
        { width: "*", stack: [
          { text: [{ text: t.help + ": ", bold: true }, contactsLine(t === T.pl ? "pl" : "en")], fontSize: 8, color: C.ink2, lineHeight: 1.35 },
          { text: [t.live + ": ", { text: EVENT.app, bold: true }, ` · ${EVENT.support}`], fontSize: 8, color: C.ink2, lineHeight: 1.35 },
        ], margin: [0, 6, 0, 0] },
        { width: "auto", columns: [
          { text: t.sponsors.toUpperCase(), fontSize: 6.6, characterSpacing: 0.6, color: C.mute, width: 60, margin: [0, 10, 0, 0] },
          ...SPONSOR_LOGOS.map((s) => ({ image: s.dataUri, fit: [66, 22], width: 70, margin: [4, 6, 0, 0] })),
        ] },
      ], columnGap: 10 },
    ],
  };
}

function docDefinition(card, t, kind, content, mode) {
  return {
    pageSize: "A4",
    pageMargins: [PAGE.left, PAGE.top, PAGE.right, PAGE.bottom],
    defaultStyle: { font: "Plex", fontSize: 9.5, color: C.ink, lineHeight: 1.15 },
    info: { title: `${kind === "supplier" ? t.title : t.title_chain} — ${card.name}`, author: "Fresh Market", subject: "Fresh Market 2026 · B2B" },
    header: (page, pages) => {
      const h = headerBlock(card, t);
      if (page > 1) h.stack.splice(1, 0, { text: `${card.name} · ${kind === "supplier" ? t.title : t.title_chain} ${t.cont} · ${t.page(page, pages)}`, fontSize: 8, color: C.mute, alignment: "right", margin: [0, 3, 0, 0] });
      return h;
    },
    footer: (page, pages) => footerLine(card, t, page, pages),
    watermark: mode === "simulation" ? { text: t.simulation, color: C.warn, opacity: 0.08, bold: true, fontSize: 40 } : undefined,
    content,
  };
}
