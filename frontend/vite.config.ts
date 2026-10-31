import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend's CORS allowlist only includes port 5500, so the dev server must not drift.
export default defineConfig({
  plugins: [react()],
  // All keys live in the root .env; Vite only exposes its VITE_* vars to the browser.
  envDir: "..",
  server: { port: 5500, strictPort: true },
  preview: { port: 5500, strictPort: true },
});
