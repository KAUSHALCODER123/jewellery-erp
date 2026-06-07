import { isEditableTarget } from "../../src/utils/scannerInput.js";
import { isProtectedApiUrl, requestUrl } from "../../src/utils/apiAuthUrl.js";

// Node-env unit coverage for the two browser-only fixes' core decisions. The full
// DOM/fetch behaviour is exercised manually; these lock in the bug-prone predicates
// (which keystrokes get intercepted, which 401s force a logout).

describe("barcode scanner: editable-target gate (input-swallow fix)", () => {
  it("treats input/textarea/select/contentEditable as editable (scanner must skip)", () => {
    expect(isEditableTarget({ tagName: "INPUT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ tagName: "SELECT" } as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget({ isContentEditable: true, tagName: "DIV" } as unknown as EventTarget)).toBe(true);
  });

  it("treats non-editable elements and null as not editable (scanner may act)", () => {
    expect(isEditableTarget({ tagName: "DIV" } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe("401 recovery: protected-API gate", () => {
  it("matches our own business API", () => {
    expect(isProtectedApiUrl("/api/pos/checkout")).toBe(true);
    expect(isProtectedApiUrl("http://localhost:3001/api/accounts/udhari")).toBe(true);
  });

  it("excludes auth endpoints (expected 401s) and external URLs", () => {
    expect(isProtectedApiUrl("/api/auth/login")).toBe(false);
    expect(isProtectedApiUrl("/api/auth/verify-password")).toBe(false);
    expect(isProtectedApiUrl("https://gold.g.apised.com/v1/latest")).toBe(false);
  });

  it("requestUrl extracts the URL from string / URL / Request-like inputs", () => {
    expect(requestUrl("/api/x")).toBe("/api/x");
    expect(requestUrl(new URL("http://host/api/x"))).toBe("http://host/api/x");
    expect(requestUrl({ url: "/api/y" } as unknown as Request)).toBe("/api/y");
  });
});
