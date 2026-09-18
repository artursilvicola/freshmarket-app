# PL / EN company preview: implementation for review

Date: 2026-09-18
Branch: `feat/company-preview-language`
Base: `origin/main` at `86eb267`
Status: implemented and verified locally; NOT deployed. No production access or data writes.

## Approved rules

Artur requested a local PL / EN description switch and automatic selection of the more complete description. The switch must not change the account/application language, hide other profile sections, translate text, or update company data.

Completeness is structural, not based on text length:

| Available fields | Rank |
| --- | --- |
| Full/standard description, with or without summary | 2 |
| Summary only | 1 |
| Neither field (including whitespace-only values) | 0 |

The higher rank wins. Equal ranks use the application's language. A full description without a summary ties with a full description plus summary: both are complete descriptions. Summary and full text always come from the SAME language.

## Implementation

- `pickDescriptionSet` normalizes whitespace for rendering only, compares structural completeness, and accepts an optional manual language choice. It does not mutate the supplied company record.
- `CompanyPreviewBody` displays a compact PL / EN button group above the description. Missing versions are disabled, with a visible availability message and accessible label/tooltip in the application language.
- Selection is local React state: retained for the current company while the preview stays open, reset on company change or reopening. It does not call `changeLanguage`, localStorage, profile updates, or any database method.
- With neither description present, the previous empty-description state remains; the other profile sections are still shown.
- Products, certificates, operations, markets, materials, contacts and offer privacy filters are unchanged. Section headings stay in the application language even when the description language differs.
- The shared body serves the supplier catalog, FM meeting preview, supplier own preview, and admin drawer. `CompanyPreviewModal` has a named export for direct component testing/local visual QA; its callers are unchanged.
- PL / EN labels added to both `legacy.json` dictionaries. Description paragraphs have the appropriate HTML `lang` attribute and wrapping for long text.

## Verification

- `npm test -- --reporter=dot`: **247/247 PASS**, 37 files (19 new description-language tests).
- Existing description save/roundtrip and pending-edit regression tests pass unchanged.
- `FmBuyerPreview.test.jsx`: existing phase 2/4 tests for Biedronka/Umai now also switch to EN and verify own offers remain visible, other retailer offers and admin-only operator data stay hidden, and meeting decisions/schedule callbacks are not invoked.
- `npm run build`: PASS. Existing large-bundle warning remains; no dependency changes.
- `git diff --check`: PASS.
- Playwright with headless Edge against the real shared modal and real i18n dictionaries, synthetic data only: widths 1440, 390 and 320 px; fuller EN default under PL UI; manual PL selection; keyboard selection; missing-PL disabled/message; EN UI with manual PL description; all shared sections unchanged; locale storage unchanged; no horizontal overflow of modal/switch.
- Nine screenshots captured and desktop/mobile screenshots visually inspected. No browser JS errors, external network requests, or non-GET requests.

Local-only QA files/screenshots are under ignored `out/` in the worktree. They are NOT part of the production bundle or commit. Demo URL while the local server is running: `http://127.0.0.1:5185/out/preview.html` (also `?case=only-en` and `?lang=en&case=both`). It uses a dummy local Supabase URL, no production credentials.

## Deployment boundary

No migration, no database repair, no change to permissions, payment dates, packages, selections, responses, phase, plan, or mail dispatch. Production remains untouched. Review this branch before a separately approved frontend deploy. Frontend rollback does not require any database change.

After an approved deployment, verify the catalog and FM preview on a buyer account read-only, without clicking meeting decisions. Old open tabs need a refresh; preserve any unsaved form edits first.

## Deliberate limitations

This is not automatic translation or language detection. If a supplier entered English into a PL field, the switch still reflects the stored field. Other free-text company fields have no separate PL / EN variants in this change and are displayed verbatim in both description modes. No supplied text is rewritten.
