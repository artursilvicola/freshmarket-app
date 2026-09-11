// [fix/fm-company-profile-feedback] Wymagania przed zapisem profilu firmy
// (panel dostawcy → „Profil firmy”). Jedno źródło dla blokady w saveProfile
// i dla komunikatu przy przycisku „Zapisz profil” — wcześniej jedyną informacją
// był toast na górze strony, niewidoczny po przewinięciu do przycisku.
import { NIP_REQUIRED } from "../config/features.js";

// Zwraca listę kodów blokad: "logo" (brak logo), "nip" (brak NIP przy włączonej fladze).
export function companySaveBlockers(company, { nipRequired = NIP_REQUIRED } = {}) {
  const out = [];
  if (!company?.logo) out.push("logo");
  if (nipRequired && !String(company?.nip || "").trim()) out.push("nip");
  return out;
}
