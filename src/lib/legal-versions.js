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

export const TERMS_VERSION = "2.0";
export const PRIVACY_VERSION = "1.0";
