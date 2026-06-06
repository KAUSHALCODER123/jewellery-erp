import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    // Don't watch the Rust/Tauri build tree — its large (and sometimes AV-quarantined)
    // sidecar binaries crash chokidar with an UNKNOWN watch error.
    watch: {
      ignored: ["**/src-tauri/**"]
    },
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true
      },
      "/ws": {
        target: "ws://localhost:4000",
        ws: true
      }
    }
  }
});
