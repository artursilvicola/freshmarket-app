// [feat/fm-plan-export] Master Excel planu spotkań — jeden wiersz = jedno spotkanie
// (+ arkusze Dostawcy i Sieci). Dla zespołu i recepcji: sortowanie, listy na bramki,
// kontrola kompletności. Zawiera dane kupców — plik WYŁĄCZNIE dla organizatora.
import * as XLSX from "xlsx";

export function buildMasterWorkbook(model) {
  const supById = new Map(model.suppliers.map((s) => [s.id, s]));
  const meetingRows = [];
  for (const ch of model.chains) {
    for (const m of ch.meetings) {
      const s = supById.get(m.supplier.id);
      meetingRows.push({
        "Nr": m.nr,
        "Sieć": ch.name,
        "Kraj sieci": ch.country,
        "Gate": ch.gate || "",
        "Kupcy": ch.buyers.map((b) => b.name).filter(Boolean).join("; "),
        "Dostawca": m.supplier.name,
        "Kraj dostawcy": m.supplier.country,
        "Pakiet": m.supplier.pkg,
        "Osoba (profil)": m.supplier.contact.name,
        "Telefon": m.supplier.contact.phone,
        "E-mail kontaktu": m.supplier.contact.email,
        "E-maile kont": s ? s.emails.join("; ") : "",
        "Język karty dostawcy": s ? s.lang.toUpperCase() : "",
        "Karta dostawcy": s ? s.card : "",
        "Karta sieci": ch.card,
        "Produkty": m.supplier.products,
      });
    }
  }
  meetingRows.sort((a, b) => a["Sieć"].localeCompare(b["Sieć"], "pl") || a["Nr"] - b["Nr"]);

  const supplierRows = model.suppliers.map((s) => ({
    "Karta": s.card, "Dostawca": s.name, "Kraj": s.country, "Język": s.lang.toUpperCase(), "Pakiet": s.pkg,
    "Liczba spotkań": s.meetings.length, "Numery": s.meetings.map((m) => m.nr).join(", "),
    "Sieci": s.meetings.map((m) => m.chain.name).join("; "),
    "Osoba": s.contact.name, "Telefon": s.contact.phone, "E-maile kont": s.emails.join("; "), "Logo": s.logoUrl ? "tak" : "brak",
  }));
  const chainRows = model.chains.map((c) => ({
    "Karta": c.card, "Sieć": c.name, "Kraj": c.country, "Język": c.lang.toUpperCase(), "Gate": c.gate || "",
    "Liczba spotkań": c.meetings.length, "Kupcy": c.buyers.map((b) => `${b.name}${b.position ? " (" + b.position + ")" : ""}`).join("; "),
    "E-maile kupców": c.emails.join("; "), "Logo": c.logoUrl ? "tak" : "brak",
  }));

  const wb = XLSX.utils.book_new();
  const add = (rows, name, widths) => {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "(brak danych)": "" }]);
    ws["!cols"] = widths.map((w) => ({ wch: w }));
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(meetingRows, "Spotkania", [6, 22, 8, 6, 30, 34, 8, 12, 24, 18, 28, 34, 8, 8, 8, 40]);
  add(supplierRows, "Dostawcy", [7, 36, 6, 6, 12, 8, 22, 50, 24, 18, 40, 6]);
  add(chainRows, "Sieci", [7, 24, 6, 6, 6, 8, 60, 50, 6]);
  const meta = [
    { Pole: "Wygenerowano", Wartość: model.generatedAt },
    { Pole: "Tryb", Wartość: model.mode === "final" ? "plan zatwierdzony" : model.mode === "working" ? "plan roboczy" : "SYMULACJA (bez planu w bazie)" },
    { Pole: "Spotkań", Wartość: meetingRows.length },
    { Pole: "Dostawców", Wartość: model.suppliers.length },
    { Pole: "Sieci", Wartość: model.chains.length },
  ];
  add(meta, "Info", [16, 40]);
  return wb;
}

export function workbookToBuffer(wb) {
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
export function workbookToArrayBuffer(wb) {
  return XLSX.write(wb, { type: "array", bookType: "xlsx" });
}
