import content from "./notice-content.js";

export const MEETING_LINKS = {
  app: "https://b2b.freshmarket.eu",
  boards: "https://b2b.freshmarket.eu/tablice",
};

// Approved copy is shared by the participant UI and the browser/CLI PDF renderer.
// The priority description is editorial copy, not input to the matching algorithm.
export function meetingNotice(language = "pl", audience = "supplier") {
  const lang = String(language).toLowerCase().startsWith("pl") ? "pl" : "en";
  const t = content[lang];
  const buyer = audience === "buyer";
  const buyerChanges = lang === "pl"
    ? "Plan może być korygowany w związku ze zmianami dostępności uczestników. Aktualną kolejność spotkań można śledzić w aplikacji Fresh Market B2B."
    : "The plan may be adjusted if participants' availability changes. You can follow the current meeting order in the Fresh Market B2B app.";
  const buyerGuarantee = lang === "pl"
    ? "Numer oznacza miejsce dostawcy w kolejce do danej sieci, ale nie jest gwarancją odbycia spotkania."
    : "A number indicates a supplier's place in the queue for a particular retailer, but does not guarantee that the meeting will take place.";
  const sections = [
    ...(!buyer ? [{ id: "priorities", title: t.priorityTitle, intro: t.priorityIntro, items: t.priorities, paragraphs: [t.later] }] : []),
    { id: "desks", title: t.desksTitle, paragraphs: t.desks },
    { id: "changes", title: t.changesTitle, paragraphs: [buyer ? buyerChanges : t.changes[0], `<b>${buyer ? buyerGuarantee : t.guarantee}</b>`, t.changes[1]] },
    ...(!buyer ? [{ id: "cancellations", title: t.cancelTitle, paragraphs: [t.cancelIntro, t.credits, t.biedronka] }] : []),
  ];
  return { ...t, lang, audience: buyer ? "buyer" : "supplier", sections, links: MEETING_LINKS };
}

// Only <b> is supported in our static copy. Never inject HTML into the page.
export function noticeRuns(value = "") {
  return String(value).split(/(<b>.*?<\/b>)/g).filter(Boolean).map(part =>
    part.startsWith("<b>") ? { text: part.slice(3, -4), bold: true } : { text: part });
}
