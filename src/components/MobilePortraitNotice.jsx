import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * Warn logged-in users when the legacy panel is opened on a phone in portrait.
 * The current panel layout has a fixed sidebar, so landscape is the supported
 * mobile compromise for the pilot.
 */
export default function MobilePortraitNotice() {
  const { t } = useTranslation("panel");
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <>
      <style>{`
        .fm-mobile-portrait-notice {
          display: none;
        }

        @media (max-width: 760px) and (orientation: portrait) {
          .fm-mobile-portrait-notice {
            position: fixed;
            inset: 0;
            z-index: 2147483000;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(15, 23, 42, 0.86);
            color: #0f172a;
          }

          .fm-mobile-portrait-notice__card {
            width: 100%;
            max-width: 360px;
            border: 1px solid #ccfbf1;
            border-radius: 12px;
            background: #ffffff;
            box-shadow: 0 24px 80px rgba(0, 0, 0, 0.28);
            padding: 22px;
            text-align: center;
          }

          .fm-mobile-portrait-notice__icon {
            width: 46px;
            height: 46px;
            margin: 0 auto 14px;
            border-radius: 999px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f0fdfa;
            color: #0d9488;
          }

          .fm-mobile-portrait-notice__title {
            margin: 0;
            font-size: 18px;
            line-height: 1.25;
            font-weight: 750;
            color: #0f172a;
          }

          .fm-mobile-portrait-notice__body {
            margin: 10px 0 0;
            font-size: 14px;
            line-height: 1.55;
            color: #475569;
          }

          .fm-mobile-portrait-notice__button {
            margin-top: 18px;
            width: 100%;
            border: 0;
            border-radius: 8px;
            background: #0d9488;
            color: #ffffff;
            padding: 11px 14px;
            font: inherit;
            font-size: 14px;
            font-weight: 700;
            cursor: pointer;
          }
        }
      `}</style>
      <div className="fm-mobile-portrait-notice" role="status" aria-live="polite">
        <div className="fm-mobile-portrait-notice__card">
          <div className="fm-mobile-portrait-notice__icon" aria-hidden="true">
            <RotateCcw size={24} />
          </div>
          <h2 className="fm-mobile-portrait-notice__title">{t("mobile_portrait.title")}</h2>
          <p className="fm-mobile-portrait-notice__body">{t("mobile_portrait.body")}</p>
          <button
            type="button"
            className="fm-mobile-portrait-notice__button"
            onClick={() => setDismissed(true)}
          >
            {t("mobile_portrait.continue_button")}
          </button>
        </div>
      </div>
    </>
  );
}
