// Translates known server error strings into plain language with a next step,
// so billing staff can act instead of escalating to a manager. Unknown
// messages pass through unchanged — the server text is still the source of
// truth for anything not mapped here.
const MAPPINGS: Array<{ match: RegExp; friendly: (original: string) => string }> = [
  {
    match: /locked GST audit period/i,
    friendly: () =>
      "This date is locked for GST filing — bills cannot be changed for it. Use today's date, or ask your manager to unlock the period."
  },
  {
    match: /has not been hallmarked|HUID is required/i,
    friendly: (original) =>
      `${original} Get the item hallmarked first, or remove it from this bill.`
  },
  {
    match: /blacklist/i,
    friendly: (original) =>
      `${original} Take full payment instead of credit, or ask an admin to review the blacklist.`
  }
];

export function friendlyError(message: string): string {
  for (const { match, friendly } of MAPPINGS) {
    if (match.test(message)) return friendly(message);
  }
  return message;
}
