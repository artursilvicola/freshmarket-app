import React from "react";
import { readFileSync } from "node:fs";
import { create, act } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";

// [feat/login-page] Nowy wygląd strony logowania NIE może zmienić mechanizmu:
// hasło → signIn + przekierowanie, magic link → sendMagicLink, reset → sendPasswordReset,
// rejestracja → /zarejestruj-dostawce, zalogowany → "/".

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  location: { state: null },
  auth: {},
  lang: "pl",
  brand: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => h.navigate,
  useLocation: () => h.location,
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k) => k, i18n: { language: h.lang } }),
}));
vi.mock("./AuthProvider", () => ({ useAuth: () => h.auth }));
vi.mock("../lib/db", () => ({ getBrandSettings: (...a) => h.brand(...a) }));
vi.mock("../components/LanguageSwitcher", () => ({ default: ({ variant }) => <div data-testid="lang" data-variant={variant} /> }));

import LoginPage from "./LoginPage";

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function mount() {
  let tree;
  act(() => { tree = create(<LoginPage />); });
  const root = tree.root;
  const input = (type) => root.findAll((n) => n.type === "input" && n.props.type === type);
  const buttons = () => root.findAll((n) => n.type === "button");
  const byText = (txt) => buttons().find((b) => b.props.children === txt || (Array.isArray(b.props.children) && b.props.children.includes(txt)));
  return {
    tree, root, input, buttons, byText,
    type: (kind, value) => act(() => { input(kind)[0].props.onChange({ target: { value } }); }),
    click: (txt) => act(() => { byText(txt).props.onClick(); }),
    submit: async () => { await act(async () => { await root.findByType("form").props.onSubmit({ preventDefault() {} }); }); await flush(); },
    submitLabel: () => root.find((n) => n.type === "button" && n.props.type === "submit").props.children,
    text: () => JSON.stringify(tree.toJSON()),
  };
}

beforeEach(() => {
  h.navigate.mockReset();
  h.location = { state: null };
  h.lang = "pl";
  h.brand.mockReset();
  h.brand.mockImplementation(async () => ({ brandLogoUrl: null }));
  h.auth = { signIn: vi.fn(async () => {}), sendMagicLink: vi.fn(async () => {}), sendPasswordReset: vi.fn(async () => {}), user: null };
});

describe("strona logowania — mechanizm bez zmian", () => {
  it("hasło: signIn(email, hasło) i przejście na stronę główną", async () => {
    const p = mount();
    expect(p.input("email")[0].props).toMatchObject({ required: true, autoComplete: "email" });
    expect(p.input("password")[0].props).toMatchObject({ required: true, autoComplete: "current-password" });
    expect(p.submitLabel()).toBe("login.sign_in_button");
    p.type("email", "a@firma.test"); p.type("password", "tajne-haslo");
    await p.submit();
    expect(h.auth.signIn).toHaveBeenCalledTimes(1);
    expect(h.auth.signIn).toHaveBeenCalledWith("a@firma.test", "tajne-haslo");
    expect(h.navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(h.auth.sendMagicLink).not.toHaveBeenCalled();
    expect(h.auth.sendPasswordReset).not.toHaveBeenCalled();
  });

  it("hasło: powrót na stronę, z której użytkownik został odesłany do logowania", async () => {
    h.location = { state: { from: { pathname: "/zakup-ok" } } };
    const p = mount();
    p.type("email", "a@firma.test"); p.type("password", "x");
    await p.submit();
    expect(h.navigate).toHaveBeenCalledWith("/zakup-ok", { replace: true });
  });

  it("błąd logowania: komunikat, bez przekierowania, przycisk znów aktywny", async () => {
    h.auth.signIn = vi.fn(async () => { throw new Error("Invalid login credentials"); });
    const p = mount();
    p.type("email", "a@firma.test"); p.type("password", "zle");
    await p.submit();
    expect(h.navigate).not.toHaveBeenCalled();
    const alert = p.root.find((n) => n.props.role === "alert");
    expect(alert.props.children).toBe("Invalid login credentials");
    expect(p.root.find((n) => n.type === "button" && n.props.type === "submit").props.disabled).toBe(false);
  });

  it("magic link: bez pola hasła, sendMagicLink(email), komunikat o wysłaniu, bez przekierowania", async () => {
    const p = mount();
    p.click("login.magic_link_switch");
    expect(p.input("password")).toHaveLength(0);
    expect(p.submitLabel()).toBe("login.magic_link_send");
    expect(p.byText("login.forgot_password")).toBeUndefined();
    p.type("email", "a@firma.test");
    await p.submit();
    expect(h.auth.sendMagicLink).toHaveBeenCalledWith("a@firma.test");
    expect(h.auth.signIn).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(p.root.find((n) => n.props.role === "status").props.children).toBe("login.magic_link_sent");
    p.click("login.back_to_password");
    expect(p.input("password")).toHaveLength(1);
    expect(p.submitLabel()).toBe("login.sign_in_button");
  });

  it("magic link dla nieznanego adresu: czytelny tekst z authErrors (bez zmian)", async () => {
    h.auth.sendMagicLink = vi.fn(async () => { const e = new Error("Signups not allowed for otp"); e.code = "otp_disabled"; throw e; });
    const p = mount();
    p.click("login.magic_link_switch");
    p.type("email", "nikt@firma.test");
    await p.submit();
    expect(p.root.find((n) => n.props.role === "alert").props.children).toBe("login.magic_link_no_account");
  });

  it("reset hasła: bez pola hasła, sendPasswordReset(email), komunikat o wysłaniu", async () => {
    const p = mount();
    p.click("login.forgot_password");
    expect(p.input("password")).toHaveLength(0);
    expect(p.submitLabel()).toBe("login.send_reset_link");
    p.type("email", "a@firma.test");
    await p.submit();
    expect(h.auth.sendPasswordReset).toHaveBeenCalledWith("a@firma.test");
    expect(h.auth.signIn).not.toHaveBeenCalled();
    expect(h.navigate).not.toHaveBeenCalled();
    expect(p.root.find((n) => n.props.role === "status").props.children).toBe("login.reset_link_sent");
  });

  it("rejestracja dostawcy i linki prawne: te same adresy co wcześniej (PL i EN)", () => {
    const hrefs = (p) => p.root.findAll((n) => n.type === "a").map((a) => a.props.href);
    expect(hrefs(mount())).toEqual(["/zarejestruj-dostawce", "/regulamin", "/polityka-prywatnosci", "mailto:support@freshmarket.eu"]);
    h.lang = "en-US";
    expect(hrefs(mount())).toEqual(["/zarejestruj-dostawce", "/regulations", "/privacy-policy", "mailto:support@freshmarket.eu"]);
  });

  it("zalogowany użytkownik: od razu na stronę główną, formularz się nie rysuje", () => {
    h.auth.user = { id: "u1" };
    const p = mount();
    expect(h.navigate).toHaveBeenCalledWith("/", { replace: true });
    expect(p.tree.toJSON()).toBeNull();
  });
});

describe("strona logowania — treść i grafika", () => {
  it("jeden nagłówek główny, przełącznik języka na jasne tło, logo: jeden obraz", async () => {
    const p = mount();
    await flush();
    expect(p.root.findAll((n) => n.type === "h1")).toHaveLength(1);
    const logo = p.root.find((n) => n.type === "img");
    expect(logo.props).toMatchObject({ src: "/brand/fm-email-logo-green.png", alt: "Fresh Market" });
    expect(p.root.findByProps({ "data-testid": "lang" }).props["data-variant"]).toBe("auth-light");
    // grafika jest wyłącznie dekoracją: jeden <img> (logo), pas owoców to tło ukryte przed czytnikami
    expect(p.root.findAll((n) => n.type === "img")).toHaveLength(1);
    expect(p.root.find((n) => n.props.className === "fm-login-produce").props["aria-hidden"]).toBe("true");
  });

  // [review Codexa 22da34b — P2] logo nadal z ustawień marki (panel Branding), znak z repo tylko jako zapas
  describe("logo z ustawień marki (Branding)", () => {
    const logoOf = (p) => p.root.findAll((n) => n.type === "img");

    it("ustawiony brand_logo_url: strona pokazuje logo wgrane przez administratora", async () => {
      h.brand.mockImplementation(async () => ({ brandLogoUrl: "https://storage.example/brand/logo-123.png" }));
      const p = mount();
      expect(logoOf(p)).toHaveLength(0);                       // przed odpowiedzią: zarezerwowane miejsce, bez obrazu
      expect(p.root.findAll((n) => n.props.className === "fm-login-logo fm-login-logo--pending")).toHaveLength(1);
      await flush();
      expect(h.brand).toHaveBeenCalledTimes(1);
      expect(logoOf(p)).toHaveLength(1);
      expect(logoOf(p)[0].props).toMatchObject({ src: "https://storage.example/brand/logo-123.png", alt: "Fresh Market", className: "fm-login-logo" });
    });

    it("brak logo w ustawieniach: oficjalny znak z repozytorium", async () => {
      const p = mount();
      await flush();
      expect(logoOf(p)[0].props.src).toBe("/brand/fm-email-logo-green.png");
    });

    it("plik logo z ustawień się nie wczytał: znak z repozytorium, bez pętli błędów", async () => {
      h.brand.mockImplementation(async () => ({ brandLogoUrl: "https://storage.example/brand/usuniety.png" }));
      const p = mount();
      await flush();
      act(() => { logoOf(p)[0].props.onError(); });
      expect(logoOf(p)[0].props.src).toBe("/brand/fm-email-logo-green.png");
      act(() => { logoOf(p)[0].props.onError(); });            // błąd zapasowego pliku niczego już nie zmienia
      expect(logoOf(p)).toHaveLength(1);
      expect(logoOf(p)[0].props.src).toBe("/brand/fm-email-logo-green.png");
    });

    it("błąd odczytu ustawień marki: znak z repozytorium, formularz działa", async () => {
      h.brand.mockImplementation(async () => { throw new Error("sieć"); });
      const p = mount();
      await flush();
      expect(logoOf(p)[0].props.src).toBe("/brand/fm-email-logo-green.png");
      expect(p.input("email")).toHaveLength(1);
    });

    it("ustawienia marki nie odpowiadają: po 1,5 s znak z repozytorium; spóźniona odpowiedź podmienia logo", async () => {
      vi.useFakeTimers();
      try {
        let release;
        h.brand.mockImplementation(() => new Promise((r) => { release = r; }));
        const p = mount();
        expect(logoOf(p)).toHaveLength(0);
        act(() => { vi.advanceTimersByTime(1499); });
        expect(logoOf(p)).toHaveLength(0);
        act(() => { vi.advanceTimersByTime(2); });
        expect(logoOf(p)[0].props.src).toBe("/brand/fm-email-logo-green.png");
        await act(async () => { release({ brandLogoUrl: "https://storage.example/brand/pozno.png" }); await Promise.resolve(); await Promise.resolve(); });
        expect(logoOf(p)[0].props.src).toBe("https://storage.example/brand/pozno.png");
      } finally { vi.useRealTimers(); }
    });
  });

  it("ikony pochodzą z lucide-react i są ukryte przed czytnikami ekranu", () => {
    const p = mount();
    const svgs = p.root.findAll((n) => n.type === "svg");
    expect(svgs.length).toBe(8);
    for (const s of svgs) { expect(String(s.props.className)).toMatch(/lucide/); expect(s.props["aria-hidden"]).toBe(true); }
    expect(readFileSync(new URL("./LoginPage.jsx", import.meta.url), "utf8")).not.toMatch(/<svg|<path /);
  });

  it("style: bez letter-spacing innego niż 0 i bez rozmiaru czcionki zależnego od szerokości okna", () => {
    const css = readFileSync(new URL("./loginPage.css", import.meta.url), "utf8");
    for (const m of css.matchAll(/letter-spacing:\s*([^;]+);/g)) expect(m[1].trim()).toBe("0");
    for (const m of css.matchAll(/font-size:\s*([^;]+);/g)) expect(m[1]).not.toMatch(/vw|vh|clamp|calc/);
    expect(css).toMatch(/\.fm-login-header \{[^}]*flex-wrap: wrap;/);
  });

  it("PreConnect (online) i Spotkania B2B (stacjonarnie) pokazane jako dwa osobne moduły", () => {
    const text = mount().text();
    for (const k of ["login.module_preconnect_title", "login.module_preconnect_text", "login.module_meetings_title", "login.module_meetings_text"]) expect(text).toContain(k);
  });

  it("teksty PL i EN: ten sam zestaw kluczy, bez daty i roku wydarzenia, bez pustych wartości", () => {
    const load = (l) => JSON.parse(readFileSync(new URL(`../i18n/${l}/auth.json`, import.meta.url), "utf8")).login;
    const pl = load("pl"), en = load("en");
    expect(Object.keys(pl).sort()).toEqual(Object.keys(en).sort());
    const used = [...readFileSync(new URL("./LoginPage.jsx", import.meta.url), "utf8").matchAll(/t\("login\.([a-z0-9_]+)"\)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(20);
    for (const k of used) { expect(pl[k], `pl:${k}`).toBeTruthy(); expect(en[k], `en:${k}`).toBeTruthy(); }
    for (const dict of [pl, en]) for (const [k, v] of Object.entries(dict)) expect(v, k).not.toMatch(/20\d\d|\b24\b|wrze[sś]|september/i);
    expect(pl.module_preconnect_text).toMatch(/online/); expect(pl.module_meetings_text).toMatch(/stacjonarn/);
    expect(en.module_preconnect_text).toMatch(/online/); expect(en.module_meetings_text).toMatch(/in-person/);
  });
});
