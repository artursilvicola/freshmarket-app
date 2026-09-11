// [fix/fm-company-profile-feedback] Braki w profilu firmy (panel dostawcy →
// „Profil firmy”). Decyzja produktowa 11.09.2026 (Artur/Codex): brak logo ani
// brak NIP NIE blokują zapisu — „Zapisz profil” zawsze zapisuje uzupełnione pola,
// a braki są widocznym ostrzeżeniem przy przycisku i w toaście po zapisie.
// (NIP nadal jest wymagany osobno przy zakupie pakietu — payment modal.)
import { NIP_REQUIRED } from "../config/features.js";

// Zwraca listę braków: "logo" (brak logo), "nip" (brak NIP przy włączonej fladze).
export function companyProfileGaps(company, { nipRequired = NIP_REQUIRED } = {}) {
  const out = [];
  if (!company?.logo) out.push("logo");
  if (nipRequired && !String(company?.nip || "").trim()) out.push("nip");
  return out;
}
