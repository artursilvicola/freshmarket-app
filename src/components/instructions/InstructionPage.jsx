// [feat/instructions-split] Strona instrukcji w aplikacji: spis treści, krótkie
// rozdziały, ponumerowane kroki, zrzuty ekranu, wydruk / zapis do PDF.
//
// Treść przychodzi z `src/content/instructions` (PL/EN, per dokument i rola).
// Komponent nie wie nic o uprawnieniach — o tym, KTÓRY dokument pokazać,
// decyduje panel (rola konta, podgląd admina). Dlatego dostaje gotowe `doc`
// i `role`, a nie użytkownika.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText, Printer, Link2, Check, BookOpen, AlertTriangle, Archive, Info } from "lucide-react";
import { getInstruction } from "../../content/instructions/index.js";
import "./InstructionPage.css";

// Minimalny zapis pogrubień w treści: **tekst**. Nic więcej — treść to zwykły tekst.
export function renderInline(text) {
  const str = String(text ?? "");
  const parts = str.split(/\*\*/);
  if (parts.length < 3) return str;
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

export function fillYear(text, year) {
  return String(text ?? "").replace(/\{\{\s*year\s*\}\}/g, String(year));
}

function anchorId(doc, role, chapterId) {
  return `instr-${doc}-${role}-${chapterId}`;
}

export default function InstructionPage({
  doc,
  role,
  lang = "pl",
  editionYear,
  organizerHtml = null,
  roleSwitcher = null,     // { value, options: [{ value, label }], onChange }
  directUrl = null,        // bezwzględny adres tej instrukcji (do skopiowania)
  onPrint = null,          // test hook; domyślnie window.print()
}) {
  const { t } = useTranslation("legacy");
  const p = "instructions.page.";
  const content = useMemo(() => getInstruction(doc, role, lang), [doc, role, lang]);
  const year = editionYear || new Date().getFullYear();
  const [copied, setCopied] = useState(false);

  // Nowy dokument: od góry (poprzednia strona panelu mogła być przewinięta na dół);
  // wejście z kotwicą (#rozdział) przewija do niej, gdy treść jest już w DOM.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location?.hash || "";
    const el = hash ? document.getElementById(hash.slice(1)) : null;
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
    else if (typeof window.scrollTo === "function") { try { window.scrollTo(0, 0); } catch { /* jsdom */ } }
  }, [doc, role, lang]);

  const print = useCallback(() => {
    if (onPrint) return onPrint();
    if (typeof window !== "undefined" && typeof window.print === "function") window.print();
  }, [onPrint]);

  const copyLink = useCallback(async () => {
    if (!directUrl) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(directUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch { /* schowek niedostępny — adres i tak jest widoczny w pasku */ }
  }, [directUrl]);

  if (!content) {
    return (
      <div className="fm-instr fm-instr--missing" role="alert">
        <FileText size={16} aria-hidden="true" /> {t(p + "missing")}
      </div>
    );
  }

  const title = fillYear(content.title, year);
  const eyebrow = fillYear(content.eyebrow || "", year);
  const showOrganizer = doc === "preconnect" && role !== "admin" && !!(organizerHtml || "").trim();
  const chapters = content.chapters || [];

  return (
    <article className="fm-instr" lang={lang} data-doc={doc} data-role={role}>
      <header className="fm-instr__header">
        <div className="fm-instr__eyebrow"><BookOpen size={14} aria-hidden="true" />{eyebrow}</div>
        <h1 className="fm-instr__title">{title}</h1>
        {content.summary && <p className="fm-instr__summary">{fillYear(content.summary, year)}</p>}
        <div className="fm-instr__meta">
          <span className="fm-instr__badge">{t(p + `role_${role}`)}</span>
          {content.updated && <span className="fm-instr__updated">{t(p + "updated", { date: content.updated })}</span>}
        </div>
        {roleSwitcher && roleSwitcher.options?.length > 0 && (
          <div className="fm-instr__switch" role="group" aria-label={t(p + "switch_label")}>
            <span className="fm-instr__switch-label">{t(p + "switch_label")}:</span>
            {roleSwitcher.options.map((o) => (
              <button key={o.value} type="button"
                className={"fm-instr__switch-btn" + (o.value === roleSwitcher.value ? " is-active" : "")}
                aria-pressed={o.value === roleSwitcher.value}
                onClick={() => roleSwitcher.onChange?.(o.value)}>
                {o.label}
              </button>
            ))}
          </div>
        )}
        <div className="fm-instr__actions">
          <button type="button" className="fm-instr__btn fm-instr__btn--primary" onClick={print}>
            <Printer size={14} aria-hidden="true" /> {t(p + "print")}
          </button>
          {directUrl && (
            <button type="button" className="fm-instr__btn" onClick={copyLink} title={directUrl}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Link2 size={14} aria-hidden="true" />} {copied ? t(p + "link_copied") : t(p + "copy_link")}
            </button>
          )}
        </div>
        <p className="fm-instr__print-hint">{t(p + "print_hint")}</p>
      </header>

      <nav className="fm-instr__toc" aria-label={t(p + "toc")}>
        <details open className="fm-instr__toc-box">
          <summary className="fm-instr__toc-title">{t(p + "toc")}</summary>
          <ol className="fm-instr__toc-list">
            {chapters.map((ch) => (
              <li key={ch.id}><a href={`#${anchorId(doc, role, ch.id)}`}>{fillYear(ch.title, year)}</a></li>
            ))}
            {content.questions?.length > 0 && <li><a href={`#${anchorId(doc, role, "questions")}`}>{t(p + "questions_title")}</a></li>}
            {content.archive && <li><a href={`#${anchorId(doc, role, "archive")}`}>{fillYear(content.archive.title, year)}</a></li>}
          </ol>
        </details>
      </nav>

      {chapters.map((ch, idx) => (
        <section key={ch.id} id={anchorId(doc, role, ch.id)} className="fm-instr__chapter">
          <h2 className="fm-instr__h2"><span className="fm-instr__num">{idx + 1}.</span> {fillYear(ch.title, year)}</h2>
          {ch.intro && <p className="fm-instr__intro">{renderInline(fillYear(ch.intro, year))}</p>}
          {ch.steps?.length > 0 && (
            <ol className="fm-instr__steps">
              {ch.steps.map((s, i) => {
                const step = typeof s === "string" ? { text: s } : s;
                return (
                  <li key={i}>
                    <span>{renderInline(fillYear(step.text, year))}</span>
                    {step.note && <div className="fm-instr__step-note">{renderInline(fillYear(step.note, year))}</div>}
                  </li>
                );
              })}
            </ol>
          )}
          {ch.notes?.length > 0 && (
            <div className="fm-instr__notes">
              <div className="fm-instr__notes-title"><AlertTriangle size={13} aria-hidden="true" /> {t(p + "notes_title")}</div>
              <ul>{ch.notes.map((n, i) => <li key={i}>{renderInline(fillYear(n, year))}</li>)}</ul>
            </div>
          )}
          {ch.figure?.src && (
            <figure className="fm-instr__figure">
              <img src={ch.figure.src} alt={fillYear(ch.figure.alt || ch.title, year)} loading="lazy" />
              {ch.figure.caption && <figcaption>{fillYear(ch.figure.caption, year)}</figcaption>}
            </figure>
          )}
        </section>
      ))}

      {content.questions?.length > 0 && (
        <section id={anchorId(doc, role, "questions")} className="fm-instr__questions" aria-label={t(p + "questions_title")}>
          <h2 className="fm-instr__h2"><AlertTriangle size={15} aria-hidden="true" /> {t(p + "questions_title")}</h2>
          <p className="fm-instr__intro">{t(p + "questions_intro")}</p>
          <ol className="fm-instr__steps fm-instr__steps--questions">
            {content.questions.map((q, i) => <li key={i}>{renderInline(fillYear(q, year))}</li>)}
          </ol>
        </section>
      )}

      {content.archive && (
        <section id={anchorId(doc, role, "archive")} className="fm-instr__archive">
          <details>
            <summary className="fm-instr__h2 fm-instr__h2--summary"><Archive size={15} aria-hidden="true" /> {fillYear(content.archive.title, year)}</summary>
            {content.archive.intro && <p className="fm-instr__intro">{renderInline(fillYear(content.archive.intro, year))}</p>}
            <ul className="fm-instr__archive-list">
              {content.archive.items.map((it, i) => <li key={i}>{renderInline(fillYear(it, year))}</li>)}
            </ul>
          </details>
        </section>
      )}

      {showOrganizer && (
        // Dotychczasowa treść „Instrukcja" z Brandingu (HTML organizatora). Zostaje
        // dostępna, ale zwinięta na końcu — to ona była połączoną instrukcją
        // PreConnect + spotkań, której rozdzielenie jest celem tej zmiany.
        <section className="fm-instr__organizer" aria-label={t(p + "organizer_note")}>
          <details>
            <summary className="fm-instr__h2 fm-instr__h2--summary"><Info size={15} aria-hidden="true" /> {t(p + "organizer_note")}</summary>
            <p className="fm-instr__intro">{t(p + "organizer_note_hint")}</p>
            <div className="fm-instr__organizer-body" dangerouslySetInnerHTML={{ __html: organizerHtml }} />
          </details>
        </section>
      )}

      <footer className="fm-instr__footer">
        <p>{t(p + "footer_help")}</p>
      </footer>
    </article>
  );
}
