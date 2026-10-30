// [feat/instructions-split] „Archiwum instrukcji 2026": dawna połączona instrukcja
// PreConnect + Spotkania B2B (HTML wpisany przez organizatora w Branding →
// „Archiwum instrukcji 2026 (treść HTML)", per rola i język). Osobna strona z
// własnym adresem — nigdy nie jest wklejana do bieżących instrukcji. Treść w bazie
// zostaje bez zmian.
import { useTranslation } from "react-i18next";
import { Archive, FileText } from "lucide-react";
import { PrintActions, RoleSwitcher } from "./InstructionPage.jsx";
import { usePrintIsolation } from "./print-isolation.js";
import "./InstructionPage.css";

export default function InstructionArchivePage({ role, lang = "pl", html = "", roleSwitcher = null, directUrl = null, backHref = null, onBack = null, onPrint = null }) {
  const { t } = useTranslation("legacy");
  const p = "instructions.page.";
  const print = usePrintIsolation(onPrint);
  const body = String(html || "").trim();
  const backClick = (e) => { if (onBack) { e.preventDefault(); onBack(); } };
  return (
    <article className="fm-instr fm-instr--archive" lang={lang} data-doc="archive2026" data-role={role}>
      <header className="fm-instr__header">
        <div className="fm-instr__eyebrow"><Archive size={14} aria-hidden="true" />{t(p + "archive_title")}</div>
        <h1 className="fm-instr__title">{t(p + "archive_title")}</h1>
        <div className="fm-instr__meta"><span className="fm-instr__badge">{t(p + `role_${role}`)}</span></div>
        <p className="fm-instr__archive-notice">{t(p + "archive_notice")}</p>
        <RoleSwitcher roleSwitcher={roleSwitcher} label={t(p + "switch_label")} />
        <PrintActions onPrint={print} directUrl={directUrl} t={t} p={p} />
        {backHref && <p className="fm-instr__back"><a href={backHref} onClick={backClick}>{t(p + "back_to_current")}</a></p>}
      </header>
      {body
        ? <section className="fm-instr__chapter fm-instr__archive-body" dangerouslySetInnerHTML={{ __html: body }} />
        : <section className="fm-instr__chapter"><p className="fm-instr__intro"><FileText size={14} aria-hidden="true" /> {t(p + "archive_empty")}</p></section>}
    </article>
  );
}
