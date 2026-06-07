import { useEffect, useRef } from "react";
import { isEditableTarget } from "../utils/scannerInput.js";

const SCANNER_INTERVAL_MS = 50;
const BUFFER_TIMEOUT_MS = 120;
const MIN_BARCODE_LENGTH = 3;

export function useBarcodeScanner(onScanCallback: (barcode: string) => void) {
  const callbackRef = useRef(onScanCallback);
  const bufferRef = useRef("");
  const lastKeyAtRef = useRef(0);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    callbackRef.current = onScanCallback;
  }, [onScanCallback]);

  useEffect(() => {
    const clearBuffer = () => {
      bufferRef.current = "";
      lastKeyAtRef.current = 0;

      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };

    const scheduleClear = () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
      }

      clearTimerRef.current = window.setTimeout(clearBuffer, BUFFER_TIMEOUT_MS);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Never intercept keystrokes headed for a focused input/textarea/select. A fast
      // human typist routinely beats the <=50ms "rapid sequence" threshold below, and
      // would otherwise have characters swallowed by preventDefault() — the field would
      // appear to "stop accepting input". Hardware scanners fire with no field focused
      // (POS scan-to-add), so skipping editable targets preserves scanning.
      if (isEditableTarget(event.target)) {
        clearBuffer();
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey) {
        clearBuffer();
        return;
      }

      const now = Date.now();
      const elapsed = lastKeyAtRef.current ? now - lastKeyAtRef.current : Number.POSITIVE_INFINITY;
      const isRapidSequence = elapsed <= SCANNER_INTERVAL_MS;

      if (event.key === "Enter") {
        const barcode = bufferRef.current.trim();

        if (barcode.length >= MIN_BARCODE_LENGTH && isRapidSequence) {
          event.preventDefault();
          event.stopPropagation();
          callbackRef.current(barcode);
        }

        clearBuffer();
        return;
      }

      if (event.key.length !== 1) {
        clearBuffer();
        return;
      }

      if (!isRapidSequence && bufferRef.current) {
        clearBuffer();
      }

      if (bufferRef.current && isRapidSequence) {
        event.preventDefault();
        event.stopPropagation();
      }

      bufferRef.current += event.key;
      lastKeyAtRef.current = now;
      scheduleClear();
    };

    window.addEventListener("keydown", onKeyDown, true);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      clearBuffer();
    };
  }, []);
}
