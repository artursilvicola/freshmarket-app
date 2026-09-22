import React from "react";
import { useTranslation } from "react-i18next";
import { meetingNotice, noticeRuns } from "../../lib/fm-plan/notice.js";
import "./MeetingDisclaimer.css";

function Copy({ text }) {
  return noticeRuns(text).map((run, i) => run.bold ? <strong key={i}>{run.text}</strong> : <React.Fragment key={i}>{run.text}</React.Fragment>);
}

function MeetingHelp({ notice, standalone = false }) {
  const Heading = standalone ? "h2" : "h3";
  return <section className="fm-meeting-notice__help"><Heading>{notice.helpTitle}</Heading><p>{notice.helpIntro}</p>
    <div className="fm-meeting-notice__contacts">{notice.contacts.map(contact => <div className="fm-meeting-notice__contact" key={contact.email}>
      <strong>{contact.name}</strong><span className="fm-meeting-notice__language">{contact.language}</span>
      <a href={`mailto:${contact.email}`}>{contact.email}</a>
      <span>{contact.phoneLabel} <a href={`tel:${contact.phoneLink}`}>{contact.phone}</a></span>
      {contact.whatsapp && <a href={`https://wa.me/${contact.whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp ↗</a>}
    </div>)}</div>
  </section>;
}

export default function MeetingDisclaimer({ audience = "supplier" }) {
  const { i18n } = useTranslation();
  const notice = meetingNotice(i18n.language, audience);
  if (audience === "buyer") return (
    <section className="fm-meeting-notice fm-meeting-notice--help" data-testid="fm-meeting-help" lang={notice.lang} aria-label={notice.helpTitle}>
      <div className="fm-meeting-notice__body"><MeetingHelp notice={notice} standalone/></div>
    </section>
  );
  return (
    <section className="fm-meeting-notice" data-testid="fm-meeting-notice" lang={notice.lang} aria-label={notice.noticeTitle}>
      <header className="fm-meeting-notice__header"><h2>{notice.noticeTitle}</h2><p>{notice.intro}</p></header>
      <div className="fm-meeting-notice__body">
        {notice.sections.map(section => <section key={section.id} className={`fm-meeting-notice__section fm-meeting-notice__section--${section.id}`}>
          <h3>{section.title}</h3>
          {section.intro && <p>{section.intro}</p>}
          {section.items && <ol className="fm-meeting-notice__priorities">{section.items.map(([title, body]) => <li key={title}><strong>{title}</strong><p>{body}</p></li>)}</ol>}
          {section.paragraphs.map((text, i) => <p key={i}><Copy text={text}/></p>)}
        </section>)}
        <section className="fm-meeting-notice__live">
          <h3>{notice.liveTitle}</h3><p>{notice.liveIntro}</p>
          <div className="fm-meeting-notice__links"><a href={notice.links.app} target="_blank" rel="noopener noreferrer">{notice.appQr}<span>b2b.freshmarket.eu</span></a><a href={notice.links.boards} target="_blank" rel="noopener noreferrer">{notice.boardQr}<span>b2b.freshmarket.eu/tablice</span></a></div>
          <p>{notice.liveOutro}</p>
        </section>
        <MeetingHelp notice={notice}/>
      </div>
    </section>
  );
}
