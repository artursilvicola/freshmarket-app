import React from "react";
import { create, act } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", () => ({
  BrowserRouter: ({ children }) => <>{children}</>,
  Routes: ({ children }) => <>{children}</>,
  Route: () => null,
  Navigate: () => null,
  useLocation: () => ({ pathname: "/" }),
}));
vi.mock("./auth/AuthProvider", () => ({ AuthProvider: ({ children }) => <>{children}</>, useAuth: () => ({}) }));
vi.mock("./auth/ProtectedRoute", () => ({ ProtectedRoute: ({ children }) => <>{children}</> }));
vi.mock("./auth/LoginPage", () => ({ default: () => null }));
vi.mock("./auth/RegisterPage", () => ({ default: () => null }));
vi.mock("./auth/RegisterSupplierPage", () => ({ default: () => null }));
vi.mock("./auth/PurchaseReturnPage", () => ({ default: () => null }));
vi.mock("./auth/ResetPasswordPage", () => ({ default: () => null }));
vi.mock("./panels/AdminPanel", () => ({ default: () => null }));
vi.mock("./panels/SupplierPanel", () => ({ default: () => null }));
vi.mock("./panels/BuyerPanel", () => ({ default: () => null }));
vi.mock("./lib/supabase", () => ({ isSupabaseConfigured: true }));
vi.mock("./components/NewVersionBanner", () => ({ default: () => <div data-testid="new-version-banner" /> }));

import App from "./App";

describe("globalny komunikat nowej wersji", () => {
  it("jest montowany nad trasami całej aplikacji", () => {
    let tree;
    act(() => { tree = create(<App />); });
    expect(tree.root.findByProps({ "data-testid": "new-version-banner" })).toBeTruthy();
    act(() => tree.unmount());
  });
});
