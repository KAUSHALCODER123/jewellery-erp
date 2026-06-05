// Document/PDF routes are opened via browser navigation (window.open / anchor
// href), which cannot send an Authorization header. The backend documents router
// accepts the session JWT as a `?token=` query param as a fallback; this helper
// appends it so authenticated document links keep working.
const AUTH_TOKEN_KEY = "jewelry_erp_jwt";

export function withDocumentToken(url: string): string {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem(AUTH_TOKEN_KEY) : null;
  if (!token) {
    return url;
  }
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}
