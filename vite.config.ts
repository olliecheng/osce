import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  publicDir: "public",
  plugins: [cloudflare({ configPath: "../wrangler.jsonc" })],
  build: { outDir: "../dist", emptyOutDir: true },
});
