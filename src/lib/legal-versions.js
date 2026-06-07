/**
 * Wersje dokumentów legalnych Fresh Market B2B.
 * [B2B Round prod-rollout / legal-versioning]
 *
 * Single source of truth — używane:
 *   - przy rejestracji (zapis do profiles.accepted_terms_version / privacy_version)
 *   - przy ewentualnej akceptacji nowych wersji (kiedy zmienisz tu liczbę,
 *     można dopisać banner "zmieniliśmy regulamin")
 *   - w nagłówku/stopce dokumentów legal HTML
 *
 * Konwencja: semantic version "major.minor"
 *   - major: zmiana zmieniająca uprawnienia / obowiązki / cel przetwarzania
 *           (wymaga ponownej akceptacji wszystkich userów + 14 dni wyprzedzenia)
 *   - minor: poprawki redakcyjne, doprecyzowanie (bez ponownej akceptacji)
 *
 * Po każdej major-zmianie zwiększ tutaj, deploy, a aplikacja przy następnym
 * loginie usera porówna jego accepted_*_version z aktualną i pokaże banner
 * "zaakceptuj nową wersję" (TODO: do zaimplementowania gdy będzie potrzebne).
 */

// [feat/lany-fixes-followups] Wyrównanie wersji regulaminu:
//  - publiczny regulamin (public/regulamin.html, regulations.html) i docs/legal/
//    REGULAMIN.md są na 1.1 (definicja Kredytu, 12 mc) + dodano §16 (archiwizacja
//    i usunięcie nieaktywnych kont) → wersja podbita do 1.2.
//  - TERMS_VERSION było rozjeżdżone (1.0) — teraz spójne z dokumentem.
//
// UWAGA (decyzja Operatora): §16 zmienia obowiązki Użytkownika, więc wg konwencji
// powyżej jest to zmiana "major" wymagająca ponownej akceptacji i 14-dniowego
// powiadomienia (§15). Numer 1.2 ustawiono zgodnie z decyzją; formalne wejście
// w życie (data + powiadomienie, ewentualnie bump do 2.0) wymaga decyzji Operatora
// PRZED publikacją. PRIVACY_VERSION bez zmian (Polityka Prywatności nietknięta).
export const TERMS_VERSION = "1.2";
export const PRIVACY_VERSION = "1.0";
