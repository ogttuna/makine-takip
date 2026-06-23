import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST ?? "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_"],
  server: {
    host,
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**", "**/collector/**", "**/target/**"],
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
