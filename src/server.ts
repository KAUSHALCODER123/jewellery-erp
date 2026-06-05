import { createServer } from "node:http";
import express from "express";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { db } from "./db/client.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const commonJsDirname = eval("typeof __dirname === 'undefined' ? undefined : __dirname") as string | undefined;
const serverDirname = commonJsDirname ?? path.dirname(fileURLToPath(import.meta.url));
import { accountsRouter } from "./accounts/routes.js";
import { authRouter } from "./auth/routes.js";
import { complianceRouter } from "./compliance/routes.js";
import { crmRouter } from "./routes/crmRouter.js";
import { ecommerceRouter } from "./routes/ecommerceRouter.js";
import { documentRouter } from "./documents/routes.js";
import { girviRouter } from "./girvi/routes.js";
import { gssRouter } from "./gss/routes.js";
import { attachScaleWebSocketServer } from "./hardware/scaleManager.js";
import { initializeActiveDevices, attachHardwareWebSocketServer } from "./hardware/deviceManager.js";
import { hardwareRouter } from "./hardware/routes.js";
import { inventoryRouter } from "./inventory/routes.js";
import { itemRouter } from "./items/routes.js";
import { karigarRouter } from "./karigar/routes.js";
import { mediaRouter } from "./media/routes.js";
import { posRouter } from "./pos/routes.js";
import { settingsRouter } from "./settings/routes.js";
import { stoneRouter } from "./routes/stoneRouter.js";
import { reportRouter } from "./routes/reportRouter.js";
import { userRouter } from "./users/routes.js";
import { refineryRouter } from "./refinery/routes.js";
import { messageRouter } from "./routes/messageRouter.js";
import { backupRouter } from "./backup/routes.js";
import { startScheduler } from "./backup/backupScheduler.js";
import { errorLog } from "./db/schema.js";
import { startSyncWorker } from "./workers/syncWorker.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const crashLogPath = path.join(os.homedir(), ".shree-erp", "crash_log.txt");

function writeCrashLog(error: unknown) {
  try {
    fs.mkdirSync(path.dirname(crashLogPath), { recursive: true });
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    fs.writeFileSync(crashLogPath, `[${new Date().toISOString()}]\n${detail}\n`, "utf8");
  } catch (logError) {
    console.error("[CrashLog] Failed to write crash log:", logError);
  }
}

process.on("uncaughtException", (error) => {
  writeCrashLog(error);
  console.error("[Backend] Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  writeCrashLog(reason);
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack ?? null : null;
  try {
    db.insert(errorLog).values({
      error_message: message,
      stack_trace: stack
    }).run();
  } catch (dbErr) {
    console.error("[Backend] Failed to log unhandled rejection to error_log:", dbErr);
  }
  console.error("[Backend] Unhandled rejection (logged — continuing):", reason);
});

app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, PUT, POST, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  next();
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/accounts", accountsRouter);
app.use("/api/compliance", complianceRouter);
app.use("/api/crm", crmRouter);
app.use("/api/ecommerce", ecommerceRouter);
app.use("/api/documents", documentRouter);
app.use("/api/girvi", girviRouter);
app.use("/api/gss", gssRouter);
app.use("/api/hardware", hardwareRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/inventory", stoneRouter);
app.use("/api/items", itemRouter);
app.use("/api/karigar", karigarRouter);
app.use("/api", mediaRouter);
app.use("/api/pos", posRouter);
app.use("/api/messenger", messageRouter);
app.use("/api/reports", reportRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/users", userRouter);
app.use("/api/refineries", refineryRouter);
app.use("/api/backup", backupRouter);

export const server = createServer(app);
attachScaleWebSocketServer(server);
attachHardwareWebSocketServer(server);

export { app };

if (process.env.NODE_ENV !== "test" || process.env.PLAYWRIGHT === "true") {
  try {
    console.log("[DB] Running startup migrations...");
    migrate(db, { migrationsFolder: path.join(serverDirname, "../drizzle") });
    console.log("[DB] Migrations completed successfully.");

    startScheduler();

    // Initialize physical hardware devices
    initializeActiveDevices();

    server.on("error", (error) => {
      writeCrashLog(error);
      console.error("[Backend] Server error:", error);
      process.exit(1);
    });

    server.listen(port, () => {
      console.log(`Jewelry ERP backend listening on http://localhost:${port}`);
      startSyncWorker();
    });
  } catch (error) {
    writeCrashLog(error);
    console.error("[Backend] Startup failed:", error);
    process.exit(1);
  }
}
