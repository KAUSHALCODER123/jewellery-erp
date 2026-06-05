import type { Server as HttpServer } from "node:http";
import { ReadlineParser } from "@serialport/parser-readline";
import { SerialPort } from "serialport";
import { WebSocketServer, type WebSocket } from "ws";
import { broadcastHardwareEvent } from "./deviceManager.js";

type ScaleState = {
  liveWeightMg: number | null;
  isConnected: boolean;
  portName: string | null;
  baudRate: number | null;
  lastRawLine: string | null;
  lastUpdatedAt: string | null;
};

let activePort: SerialPort | null = null;
let broadcastTimer: NodeJS.Timeout | null = null;

const scaleState: ScaleState = {
  liveWeightMg: null,
  isConnected: false,
  portName: null,
  baudRate: null,
  lastRawLine: null,
  lastUpdatedAt: null
};

export function initializeScaleConnection(portName: string, baudRate: number) {
  closeActivePort();

  scaleState.portName = portName;
  scaleState.baudRate = baudRate;
  scaleState.isConnected = false;

  let port: SerialPort;

  try {
    port = new SerialPort({
      path: portName,
      baudRate,
      autoOpen: false
    });
  } catch (error) {
    scaleState.isConnected = false;
    console.error("Failed to create scale serial port", error);

    return getScaleState();
  }

  const parser = port.pipe(new ReadlineParser({ delimiter: "\r\n" }));

  parser.on("data", (line: string) => {
    const parsedWeightMg = parseScaleWeightToMg(line);

    scaleState.lastRawLine = line;

    if (parsedWeightMg === null) {
      return;
    }

    scaleState.liveWeightMg = parsedWeightMg;
    scaleState.lastUpdatedAt = new Date().toISOString();

    broadcastHardwareEvent({
      type: "scale_weight",
      liveWeightMg: scaleState.liveWeightMg,
      isConnected: scaleState.isConnected
    });
  });

  parser.on("error", (error) => {
    scaleState.isConnected = false;
    console.error("Scale serial parser error", error);
  });

  port.on("open", () => {
    scaleState.isConnected = true;
    broadcastHardwareEvent({ type: "scale_weight", ...getScaleState() });
  });

  port.on("close", () => {
    if (activePort === port) {
      scaleState.isConnected = false;
      broadcastHardwareEvent({ type: "scale_weight", ...getScaleState() });
    }
  });

  port.on("error", (error) => {
    scaleState.isConnected = false;
    console.error("Scale serial connection error", error);
    broadcastHardwareEvent({ type: "scale_weight", ...getScaleState() });
  });

  port.open((error) => {
    if (error) {
      scaleState.isConnected = false;
      console.error("Failed to open scale serial port", error);
      broadcastHardwareEvent({ type: "scale_weight", ...getScaleState() });
      return;
    }

    scaleState.isConnected = true;
    broadcastHardwareEvent({ type: "scale_weight", ...getScaleState() });
  });

  activePort = port;

  return getScaleState();
}

export function attachScaleWebSocketServer(server: HttpServer) {
  const websocketServer = new WebSocketServer({
    server,
    path: "/ws/scale"
  });

  websocketServer.on("connection", (socket) => {
    sendScaleState(socket);
  });

  if (!broadcastTimer) {
    broadcastTimer = setInterval(() => {
      const message = JSON.stringify({
        type: "scale_weight",
        ...getScaleState()
      });

      for (const client of websocketServer.clients) {
        if (client.readyState === client.OPEN) {
          client.send(message);
        }
      }
    }, 200);
  }

  return websocketServer;
}

export function getScaleState(): ScaleState {
  return { ...scaleState };
}

export function parseScaleWeightToMg(rawLine: string) {
  try {
    const gramMarkedMatch = rawLine.match(/[+-]?\s*\d+(?:\.\d{1,3})?\s*g\b/i);
    const candidate = gramMarkedMatch?.[0] ?? getLastNumericCandidate(rawLine);

    if (!candidate) {
      return null;
    }

    return decimalGramStringToMg(candidate);
  } catch {
    return null;
  }
}

function getLastNumericCandidate(rawLine: string) {
  const numericText = rawLine
    .trim()
    .replace(/[^\d+\-.]/g, " ")
    .replace(/\s+/g, " ");
  const matches = numericText.match(/[+-]?\s*\d+(?:\.\d{1,3})?/g);

  return matches?.at(-1) ?? null;
}

function decimalGramStringToMg(value: string) {
  const sanitized = value.replace(/[^\d+\-.]/g, "").replace(/^([+-])?0+(?=\d)/, "$1");
  const match = sanitized.match(/^([+-]?)(\d+)(?:\.(\d{1,3}))?$/);

  if (!match) {
    return null;
  }

  const sign = match[1] === "-" ? -1 : 1;
  const whole = Number(match[2]);
  const decimal = (match[3] ?? "").padEnd(3, "0");
  const milligrams = whole * 1000 + Number(decimal);

  if (!Number.isSafeInteger(milligrams)) {
    return null;
  }

  return sign * milligrams;
}

function closeActivePort() {
  if (!activePort) {
    return;
  }

  const portToClose = activePort;
  activePort = null;

  if (portToClose.isOpen) {
    portToClose.close((error) => {
      if (error) {
        console.error("Failed to close previous scale serial port", error);
      }
    });
  }
}

function sendScaleState(socket: WebSocket) {
  socket.send(
    JSON.stringify({
      type: "scale_weight",
      ...getScaleState()
    })
  );
}
