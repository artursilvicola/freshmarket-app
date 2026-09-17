import React, { useEffect, useId, useRef, useState } from "react";
import { Loader2, RotateCcw, Save } from "lucide-react";
import { useTranslation } from "react-i18next";
import { setCompanyFmPaymentDate } from "../lib/db";
import { isPaymentDate } from "../lib/fm-payment-date";
import { registerPendingWork } from "../lib/pending-work";

export default function AdminFmPaymentDate({ company, onSaved }) {
  const { t } = useTranslation("legacy");
  const id = useId();
  const [baseDate, setBaseDate] = useState(company.fm_payment_date || "");
  const [draft, setDraft] = useState(company.fm_payment_date || "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const saving = useRef(false);
  const observedDate = useRef(company.fm_payment_date || "");
  const dirty = draft !== baseDate;
  useEffect(() => {
    if (!dirty && !busy && observedDate.current !== (company.fm_payment_date || "")) {
      observedDate.current = company.fm_payment_date || "";
      setBaseDate(company.fm_payment_date || "");
      setDraft(company.fm_payment_date || "");
    }
  }, [company.fm_payment_date, dirty, busy]);
  useEffect(() => registerPendingWork(() => busy || dirty), [busy, dirty]);

  async function save() {
    if (saving.current || !dirty || !isPaymentDate(draft) || !company.fm_b2b_enabled) return;
    saving.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const row = await setCompanyFmPaymentDate(company.id, draft, baseDate || null);
      onSaved(row);
      setBaseDate(row.fm_payment_date);
      setDraft(row.fm_payment_date);
      setMessage({ ok: true, text: t("admin.firmy.payment_date_saved") });
    } catch (error) {
      if (error?.message === "fm_payment_date_conflict" && isPaymentDate(error.details)) {
        setBaseDate(error.details);
        onSaved({ id: company.id, fm_payment_date: error.details });
        setMessage({ text: t("admin.firmy.payment_date_conflict", { date: error.details }) });
      } else {
        setMessage({ text: t("admin.firmy.payment_date_error") });
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  if (!company.fm_b2b_enabled) return null;
  const iconStyle = { width:32,height:32,flexShrink:0,display:"inline-flex",alignItems:"center",justifyContent:"center",border:"1px solid #cbd5e1",borderRadius:6,background:"white",color:"#0f766e",cursor:"pointer" };
  return <div data-testid="admin-fm-payment-date" style={{ display:"flex",flexDirection:"column",gap:4,minWidth:0,maxWidth:"100%" }}>
    <label htmlFor={id} style={{ fontSize:11,fontWeight:600,color:"#475569" }}>{t("admin.firmy.payment_date_label")}</label>
    <div style={{ display:"flex",gap:4,alignItems:"center",flexWrap:"wrap" }}>
      <input id={id} type="date" min="0001-01-01" max="9999-12-31" value={draft} disabled={busy}
        title={t("admin.firmy.payment_date_tooltip")}
        aria-invalid={dirty && !isPaymentDate(draft)}
        onChange={e => { setDraft(e.target.value); setMessage(null); }}
        style={{ width:145,maxWidth:"100%",minWidth:0,height:32,boxSizing:"border-box",padding:"4px 6px",border:"1px solid #cbd5e1",borderRadius:6,fontSize:12,fontFamily:"inherit",background:"white",color:"#0f172a" }}/>
      <button type="button" style={{ ...iconStyle,opacity:busy || !dirty || !isPaymentDate(draft) ? 0.45 : 1 }}
        title={t("admin.firmy.payment_date_save")} aria-label={t("admin.firmy.payment_date_save")}
        disabled={busy || !dirty || !isPaymentDate(draft)} onClick={save}>
        {busy ? <Loader2 size={15}/> : <Save size={15}/>}
      </button>
      <button type="button" style={{ ...iconStyle,opacity:busy || !dirty ? 0.45 : 1 }}
        title={t("admin.firmy.payment_date_reset")} aria-label={t("admin.firmy.payment_date_reset")}
        disabled={busy || !dirty} onClick={() => { setDraft(baseDate); setMessage(null); }}><RotateCcw size={15}/></button>
    </div>
    {message && <div role={message.ok ? "status" : "alert"} style={{ fontSize:11,color:message.ok ? "#047857" : "#b91c1c",maxWidth:300,overflowWrap:"anywhere" }}>{message.text}</div>}
  </div>;
}
