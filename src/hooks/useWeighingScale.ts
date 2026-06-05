import { useEffect, useMemo, useState } from "react";

type ScaleSocketMessage = {
  type?: string;
  liveWeightMg?: number | null;
  isConnected?: boolean;
};

export type WeighingScaleState = {
  liveWeightMg: number | null;
  isConnected: boolean;
  isManualFallback: boolean;
};

export function useWeighingScale(socketUrl = defaultScaleSocketUrl()): WeighingScaleState {
  const [liveWeightMg, setLiveWeightMg] = useState<number | null>(null);
  const [isSocketOpen, setIsSocketOpen] = useState(false);
  const [isScaleConnected, setIsScaleConnected] = useState(false);

  useEffect(() => {
    let socket: WebSocket | null = null;
    const connectTimer = window.setTimeout(() => {
      socket = new WebSocket(socketUrl);

      socket.onopen = () => {
        setIsSocketOpen(true);
      };

      socket.onmessage = (event) => {
        const message = parseScaleSocketMessage(event.data);

        if (!message || message.type !== "scale_weight") {
          return;
        }

        setLiveWeightMg(
          typeof message.liveWeightMg === "number" && Number.isInteger(message.liveWeightMg)
            ? message.liveWeightMg
            : null
        );
        setIsScaleConnected(Boolean(message.isConnected));
      };

      socket.onerror = () => {
        setIsSocketOpen(false);
        setIsScaleConnected(false);
      };

      socket.onclose = () => {
        setIsSocketOpen(false);
        setIsScaleConnected(false);
      };
    }, 0);

    return () => {
      window.clearTimeout(connectTimer);
      socket?.close();
    };
  }, [socketUrl]);

  return useMemo(
    () => ({
      liveWeightMg,
      isConnected: isSocketOpen && isScaleConnected,
      isManualFallback: !isSocketOpen || !isScaleConnected
    }),
    [isScaleConnected, isSocketOpen, liveWeightMg]
  );
}

function parseScaleSocketMessage(data: unknown): ScaleSocketMessage | null {
  if (typeof data !== "string") {
    return null;
  }

  try {
    const parsed = JSON.parse(data) as ScaleSocketMessage;

    return typeof parsed === "object" && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

function defaultScaleSocketUrl() {
  if (typeof window === "undefined") {
    return "ws://localhost:4000/ws/scale";
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.host || "localhost:4000";

  return `${protocol}//${host}/ws/scale`;
}
