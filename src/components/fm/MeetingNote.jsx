import { useTranslation } from "react-i18next";

// Deliberately never reads supplierRequirements: those belong to PreConnect.
export default function MeetingNote({ retailer }) {
  const { t, i18n } = useTranslation("legacy");
  const pl = String(retailer?.fmMeetingNote ?? retailer?.fm_meeting_note ?? "").trim();
  const en = String(retailer?.fmMeetingNoteEn ?? retailer?.fm_meeting_note_en ?? "").trim();
  const note = i18n.language?.startsWith("en") ? en || pl : pl || en;
  if (!note) return null;
  return <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.5, color: "#0369a1", whiteSpace: "pre-line" }}>
    <strong>{t("fm.meeting_note_label")}: </strong>{note}
  </div>;
}
