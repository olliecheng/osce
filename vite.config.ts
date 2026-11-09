import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: "public",
  plugins: [cloudflare({ configPath: "../wrangler.jsonc" })],
  build: { outDir: "../dist", emptyOutDir: true },
  // Two pages: the station (SPA) and the case editor at /editor. Client environment only, not the Worker's.
  environments: {
    client: { build: { rollupOptions: { input: { main: "index.html", editor: "editor/index.html" } } } },
  },
});
