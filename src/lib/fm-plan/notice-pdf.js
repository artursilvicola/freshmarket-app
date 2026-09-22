import { meetingNotice, noticeRuns } from "./notice.js";
import { SPONSOR_LOGOS } from "./assets.js";

const green = "#166b3b", ink = "#183b31";
const heading = text => ({ text, font: "Barlow", bold: true, fontSize: 13.5, color: green, margin: [0, 0, 0, 6] });
const paragraph = text => ({ text: noticeRuns(text), fontSize: 9.3, lineHeight: 1.16, color: ink, margin: [0, 0, 0, 7] });

function sectionBlock(section) {
  return { unbreakable: true, margin: [0, 0, 0, 9], stack: [
    heading(section.title),
    ...(section.intro ? [paragraph(section.intro)] : []),
    ...(section.items ? section.items.map(([title, body], i) => paragraph(`<b>${i + 1}. ${title}.</b> ${body}`)) : []),
    ...section.paragraphs.map(paragraph),
  ] };
}

// Only one pair of QR codes per card, alongside the existing operational instructions.
// The notice page deliberately has no repeated queue/QR section.
export function meetingResourcesBlock(lang) {
  const n = meetingNotice(lang);
  return { unbreakable: true, margin: [0, 6, 0, 0], stack: [
    { ...heading(n.liveTitle), fontSize: 12, margin: [0, 0, 0, 2] },
    { columns: [[n.links.app, n.appQr], [n.links.boards, n.boardQr]].map(([url, label]) => ({ width: "*", columns: [
      // Same QR version and module size for both URLs; retain a four-module quiet zone.
      { qr: url, version: 3, fit: 58, padding: 4, width: 80, eccLevel: "M" },
      { width: "*", margin: [4, 6, 0, 0], stack: [
        { text: label, bold: true, fontSize: 8.7, color: ink, margin: [0, 0, 0, 5] },
        { text: url.replace("https://", ""), link: url, fontSize: 8.1, color: green },
      ] },
    ] })), columnGap: 15 },
    { ...paragraph(n.liveOutro), fontSize: 8.4, margin: [0, 2, 0, 4] },
    { columns: SPONSOR_LOGOS.map(s => ({ image: s.dataUri, fit: [66, 20], width: 74, margin: [0, 0, 8, 0] })) },
  ] };
}

export function meetingNoticeBlock(lang, audience) {
  const n = meetingNotice(lang, audience);
  const left = n.sections.filter(s => ["priorities", "desks"].includes(s.id));
  const right = n.sections.filter(s => !["priorities", "desks"].includes(s.id));
  return { pageBreak: "before", stack: [
    { ...heading(n.noticeTitle), fontSize: 18, margin: [0, 0, 0, 9] },
    { ...paragraph(n.intro), margin: [0, 0, 0, 14] },
    { columns: [{ width: "*", stack: left.map(sectionBlock) }, { width: "*", stack: right.map(sectionBlock) }], columnGap: 20 },
    { unbreakable: true, margin: [0, 5, 0, 0], stack: [heading(n.helpTitle),
      { columns: n.contacts.map(contact => ({ width: "*", stack: [
        { text: contact.name, bold: true, fontSize: 10, color: ink, margin: [0, 0, 0, 3] },
        { text: contact.language, bold: true, fontSize: 9, color: green, margin: [0, 0, 0, 4] },
        { text: contact.email, link: `mailto:${contact.email}`, fontSize: 9, margin: [0, 0, 0, 3] },
        { text: `${contact.phoneLabel} ${contact.phone}`, link: `tel:${contact.phoneLink}`, fontSize: 9 },
        ...(contact.whatsapp ? [{ text: "WhatsApp", link: `https://wa.me/${contact.whatsapp}`, fontSize: 8.5, color: green, margin: [0, 4, 0, 0] }] : []),
      ] })), columnGap: 20 },
    ] },
  ] };
}
