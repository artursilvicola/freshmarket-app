// [feat/fm-queue] PL/EN dla panelu obsługi (/obsluga) i logowania.
// Osobny, mały słownik zamiast namespace'ów i18next: obsługa nie ma profilu
// z locale — język wybiera na ekranie logowania (zapamiętany w localStorage
// i w i18n aplikacji), tablica /tablica jest zawsze dwujęzyczna.
import { useCallback, useEffect, useState } from "react";
import i18n from "../i18n";

const DICT = {
  pl: {
    brand: "FRESH MARKET 2026", staff_title: "Obsługa spotkań B2B", staff_sub: "Zaloguj się kodem operatora i PIN-em od organizatora.",
    code: "Kod operatora", code_ph: "np. OBSLUGA-3", pin: "PIN (6 cyfr)", login: "Zaloguj", logging_in: "Logowanie…",
    login_help: "Problem z logowaniem? Zgłoś się do biura organizatora (Gate 1).", unlock_in: "Odblokowanie za",
    err_input: "Podaj kod operatora i 6-cyfrowy PIN.", err_session: "Nie udało się ustawić sesji", err_network: "Brak połączenia z serwerem. Sprawdź Wi-Fi i spróbuj ponownie.", err_login: "Logowanie nieudane.",
    not_staff: "To konto nie jest kontem obsługi.", logout: "Wyloguj", change_station: "Zmień stanowisko", loading: "Ładowanie…",
    offline: "Brak połączenia z siecią — przyciski zablokowane. Ostatni znany stan może być nieaktualny.",
    pick_station: "Wybierz stanowisko", no_stations: "Brak przypisanych stanowisk. Poproś organizatora o przypisanie do sieci.",
    station: "Stanowisko", of: "z", gate: "GATE", now: "TERAZ", next: "NASTĘPNY", last_called: "ostatnio wywołany", in_queue: "w kolejce",
    returnee_pill: "POWRACAJĄCY · POZA TABLICĄ", in_progress: "W TRAKCIE", called_waiting: "WYWOŁANY — CZEKAMY", ongoing: "trwa", since_call: "od wywołania",
    free_entry_now: "Wolne wejście — bez numerków.", station_free: "Stanowisko wolne.", station_closed: "Stanowisko zamknięte.", queue_end: "Koniec kolejki.",
    btn_finish_returnee: "Zakończ powracającego", btn_open: "Otwórz stanowisko", btn_resume: "Wznów", btn_close: "Zamknij", btn_back_queue: "Wróć do kolejki",
    btn_start: "Rozpocznij spotkanie", btn_no_show: "Nieobecny", btn_finish_next: "Zakończ i wywołaj następny", btn_finish: "Zakończ",
    btn_call_next: "Wywołaj następny", btn_serve_returnee: "Obsłuż powracającego", btn_free_entry: "Wolne wejście", btn_pause: "Przerwa",
    btn_undo: "Cofnij", btn_exception: "+ Wyjątek", undo_hint: "cofnięcie dotyczy statusu spotkania; wywołania numeru nie da się cofnąć",
    returnees_title: "Powracający (obsługa poza tablicą)", returnees_empty: "Nikt nie czeka.", ready_hint: "gotowy — stanowisko wolne → „Obsłuż powracającego”",
    waits_for: "czeka na zakończenie spotkania nr", resigns: "Rezygnuje", noshows_title: "Nieobecni — zgłosili się ponownie?", noshows_empty: "Brak nieobecnych.", returned: "Wrócił",
    exc_title: "Spotkanie wyjątkowe", exc_desc: "Firma bez umówionego spotkania dostaje numer NA KOŃCU kolejki. Nie ma walk-inów bez decyzji obsługi.",
    exc_name: "Nazwa firmy", exc_confirm: (n, nr) => `Dodać „${n}” jako numer ${nr}?`, exc_add: "Dodaj numer", exc_cancel: "Anuluj", exc_next_nr: "następny wolny numer",
    conflict_refreshed: "Stan stanowiska zmienił się w międzyczasie — odświeżono.",
    mode: { closed: "ZAMKNIĘTE", open: "OTWARTE", paused: "PRZERWA", free_entry: "WOLNE WEJŚCIE" },
    status: { planned: "zaplanowane", called: "wywołane", in_progress: "w trakcie", done: "zakończone", no_show: "nieobecny", skipped: "pominięte", cancelled: "anulowane", returned_waiting: "powrócił — czeka", returned_in_progress: "powrócił — w trakcie" },
    fm: {
      FM_CONFLICT: "Stan stanowiska zmienił się w międzyczasie — odświeżono.", FM_STATION_NOT_OPEN: "Stanowisko nie jest otwarte.",
      FM_STATION_BUSY: "Na stanowisku trwa spotkanie — najpierw je zakończ.", FM_STATION_BUSY_RETURNEE: "Trwa obsługa powracającego — najpierw ją zakończ.",
      FM_QUEUE_EMPTY: "Kolejka pusta — brak kolejnych zaplanowanych spotkań.", FM_NO_CALLED_MEETING: "Brak wywołanego spotkania.", FM_NO_ACTIVE_MEETING: "Brak aktywnego spotkania.",
      FM_NO_RETURNEE: "Brak obsługiwanego powracającego.", FM_RETURNEE_BARRIER: "Powracający może wejść dopiero po zakończeniu spotkania z bariery.",
      FM_BAD_STATUS: "Ta operacja nie pasuje do stanu spotkania.", FM_UNDO_EXPIRED: "Cofnięcie możliwe tylko do 30 s po operacji.",
      FM_UNDO_NOT_LAST: "Po tej operacji zaszło już coś innego — nie można cofnąć.", FM_UNDO_FORBIDDEN: "Wywołania numeru nie da się cofnąć — numery idą tylko do przodu.",
      FM_NOT_ASSIGNED: "Nie masz przypisania do tej sieci.", FM_FORBIDDEN: "Brak uprawnień (konto obsługi działa tylko w dniu wydarzenia).", FM_AUTH_REQUIRED: "Sesja wygasła — zaloguj się ponownie.",
      FM_STATION_INACTIVE: "Stanowisko jest nieaktywne.", FM_NAME_REQUIRED: "Podaj nazwę firmy.", FM_IDEM_REQUIRED: "Błąd klienta (brak klucza operacji) — odśwież stronę.",
      FM_NO_SCHEDULE: "Brak zatwierdzonego planu spotkań.", FM_PLAN_NOT_PUBLISHED: "Plan spotkań dla tej daty nie jest opublikowany.", FM_FORWARD_ONLY: "Numer nie może się zmniejszyć.",
      FM_CONFIRM_REQUIRED: "Niepoprawne potwierdzenie.", FM_RESET_LIVE_DAY: "Nie można resetować dnia, w którym trwają spotkania.", FM_NOT_FOUND: "Nie znaleziono.", unknown: "Nieznany błąd.",
    },
  },
  en: {
    brand: "FRESH MARKET 2026", staff_title: "B2B meetings desk staff", staff_sub: "Sign in with the operator code and PIN from the organiser.",
    code: "Operator code", code_ph: "e.g. OBSLUGA-3", pin: "PIN (6 digits)", login: "Sign in", logging_in: "Signing in…",
    login_help: "Login problem? Go to the organiser's office (Gate 1).", unlock_in: "Unlocks in",
    err_input: "Enter the operator code and the 6-digit PIN.", err_session: "Could not set the session", err_network: "No connection to the server. Check Wi-Fi and try again.", err_login: "Login failed.",
    not_staff: "This account is not a staff account.", logout: "Sign out", change_station: "Change desk", loading: "Loading…",
    offline: "No network — buttons disabled. The last known state may be outdated.",
    pick_station: "Choose a desk", no_stations: "No desks assigned. Ask the organiser to assign you to a retailer.",
    station: "Desk", of: "of", gate: "GATE", now: "NOW", next: "NEXT", last_called: "last called", in_queue: "in queue",
    returnee_pill: "RETURNEE · OFF BOARD", in_progress: "IN PROGRESS", called_waiting: "CALLED — WAITING", ongoing: "ongoing", since_call: "since call",
    free_entry_now: "Walk-in mode — no numbers.", station_free: "Desk free.", station_closed: "Desk closed.", queue_end: "End of queue.",
    btn_finish_returnee: "Finish returnee", btn_open: "Open desk", btn_resume: "Resume", btn_close: "Close", btn_back_queue: "Back to queue",
    btn_start: "Start meeting", btn_no_show: "No-show", btn_finish_next: "Finish & call next", btn_finish: "Finish",
    btn_call_next: "Call next", btn_serve_returnee: "Serve returnee", btn_free_entry: "Walk-in", btn_pause: "Break",
    btn_undo: "Undo", btn_exception: "+ Exception", undo_hint: "undo applies to the meeting status only; a called number cannot be taken back",
    returnees_title: "Returnees (served off board)", returnees_empty: "Nobody waiting.", ready_hint: "ready — desk free → “Serve returnee”",
    waits_for: "waiting until meeting no. is finished:", resigns: "Gives up", noshows_title: "No-shows — came back?", noshows_empty: "No no-shows.", returned: "Returned",
    exc_title: "Exception meeting", exc_desc: "A company without a scheduled meeting gets a number AT THE END of the queue. No walk-ins without a staff decision.",
    exc_name: "Company name", exc_confirm: (n, nr) => `Add “${n}” as number ${nr}?`, exc_add: "Add number", exc_cancel: "Cancel", exc_next_nr: "next free number",
    conflict_refreshed: "The desk state changed meanwhile — refreshed.",
    mode: { closed: "CLOSED", open: "OPEN", paused: "BREAK", free_entry: "WALK-IN" },
    status: { planned: "planned", called: "called", in_progress: "in progress", done: "finished", no_show: "no-show", skipped: "skipped", cancelled: "cancelled", returned_waiting: "returned — waiting", returned_in_progress: "returned — in progress" },
    fm: {
      FM_CONFLICT: "The desk state changed meanwhile — refreshed.", FM_STATION_NOT_OPEN: "The desk is not open.",
      FM_STATION_BUSY: "A meeting is in progress at this desk — finish it first.", FM_STATION_BUSY_RETURNEE: "A returnee is being served — finish that first.",
      FM_QUEUE_EMPTY: "Queue empty — no more planned meetings.", FM_NO_CALLED_MEETING: "No called meeting.", FM_NO_ACTIVE_MEETING: "No active meeting.",
      FM_NO_RETURNEE: "No returnee being served.", FM_RETURNEE_BARRIER: "The returnee can enter only after the barrier meeting is finished.",
      FM_BAD_STATUS: "This action does not match the meeting state.", FM_UNDO_EXPIRED: "Undo is possible only within 30 s.",
      FM_UNDO_NOT_LAST: "Something else happened after that action — cannot undo.", FM_UNDO_FORBIDDEN: "A called number cannot be taken back — numbers only go forward.",
      FM_NOT_ASSIGNED: "You are not assigned to this retailer.", FM_FORBIDDEN: "No permission (staff accounts work only on the event day).", FM_AUTH_REQUIRED: "Session expired — sign in again.",
      FM_STATION_INACTIVE: "The desk is inactive.", FM_NAME_REQUIRED: "Enter the company name.", FM_IDEM_REQUIRED: "Client error (missing operation key) — reload the page.",
      FM_NO_SCHEDULE: "No approved meeting plan.", FM_PLAN_NOT_PUBLISHED: "The plan for this date is not published.", FM_FORWARD_ONLY: "The number cannot decrease.",
      FM_CONFIRM_REQUIRED: "Invalid confirmation.", FM_RESET_LIVE_DAY: "Cannot reset a day with live meetings.", FM_NOT_FOUND: "Not found.", unknown: "Unknown error.",
    },
  },
};

export function pickLang(raw) { return String(raw || "").toLowerCase().startsWith("en") ? "en" : "pl"; }

export function useStaffLang() {
  const [lang, setLangState] = useState(() => {
    try { return pickLang(localStorage.getItem("fm_staff_lang") || i18n.language); } catch { return pickLang(i18n.language); }
  });
  const setLang = useCallback((l) => {
    const v = pickLang(l);
    setLangState(v);
    try { localStorage.setItem("fm_staff_lang", v); } catch { /* noop */ }
    try { i18n.changeLanguage(v); } catch { /* noop */ }
  }, []);
  useEffect(() => { try { if (pickLang(i18n.language) !== lang) i18n.changeLanguage(lang); } catch { /* noop */ } }, [lang]);
  return { lang, setLang, t: DICT[lang] };
}

export function fmErrorText(lang, e) {
  const d = DICT[pickLang(lang)].fm;
  const code = e?.fmCode || e?.code || "";
  return d[code] || e?.message || d.unknown;
}

export const STAFF_DICT = DICT;
