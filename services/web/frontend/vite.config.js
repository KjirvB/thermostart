import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/static/v2/",
  build: {
    outDir: "../thermostart/static/v2",
    emptyOutDir: true,
    manifest: true,
    rollupOptions: {
      input: "src/main.jsx",
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
