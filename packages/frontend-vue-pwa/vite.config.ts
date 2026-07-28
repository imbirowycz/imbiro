import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import path from "node:path";

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      devOptions: {
        enabled: false,
      },
      registerType: "autoUpdate",
      manifest: {
        name: "My App",
        short_name: "App",
        start_url: "/",
        display: "standalone",
      },
    }),
  ],
  resolve: {
    alias: {
      "@myorg/shared": path.resolve(__dirname, "../shared/index.ts"),
    },
  },
  server: {
    port: 5173,
    hmr: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
