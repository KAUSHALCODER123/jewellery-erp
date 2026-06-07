// True when a keystroke is destined for a focused editable field — the barcode scanner
// must NOT intercept these (a fast typist beats the rapid-sequence threshold and would
// otherwise have characters swallowed). Hardware scanners fire with no field focused.
export function isEditableTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element) {
    return false;
  }
  if (element.isContentEditable) {
    return true;
  }
  const tagName = element.tagName;
  return tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}
