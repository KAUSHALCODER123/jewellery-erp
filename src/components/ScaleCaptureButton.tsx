import { scaleSocketUrl, useWeighingScale } from "../hooks/useWeighingScale.js";

type ScaleCaptureButtonProps = {
  apiBaseUrl: string;
  onCapture: (grams: string) => void;
};

// Fills a weight input from the live RS232 scale reading. The scale already
// streams over /ws/scale for the header status pill; entry forms could not
// consume it, so staff transcribed every weight by hand.
export default function ScaleCaptureButton({ apiBaseUrl, onCapture }: ScaleCaptureButtonProps) {
  const scale = useWeighingScale(scaleSocketUrl(apiBaseUrl));
  const grams = scale.liveWeightMg !== null ? (scale.liveWeightMg / 1000).toFixed(3) : null;
  const ready = scale.isConnected && grams !== null;

  return (
    <button
      type="button"
      disabled={!ready}
      onClick={() => {
        if (grams !== null) onCapture(grams);
      }}
      title={ready ? `Capture ${grams} g from the weighing scale` : "Scale offline — enter weight manually"}
      className={`h-8 shrink-0 whitespace-nowrap rounded border px-2 font-mono text-[11px] transition ${
        ready
          ? "border-emerald-700 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40 active:scale-95"
          : "cursor-not-allowed border-slate-800 bg-slate-950 text-slate-600"
      }`}
    >
      ⚖ {ready ? `${grams} g` : "offline"}
    </button>
  );
}
