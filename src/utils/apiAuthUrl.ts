export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

// A 401 from our own protected API means the stored token is dead. Auth endpoints
// (login, and verify-password for the unlock screen) return 401 by design and are
// handled by their callers, so they must never trigger an auto-logout — and external
// (non-/api/) URLs are out of scope entirely.
export function isProtectedApiUrl(url: string): boolean {
  return url.includes("/api/") && !url.includes("/api/auth/");
}
