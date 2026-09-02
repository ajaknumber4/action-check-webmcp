import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { externalTargetCanaryBrokerPlugin } from "./server/external-target-staging/vite-plugin.ts";

export default defineConfig({
  plugins: [react(), externalTargetCanaryBrokerPlugin()],
  build: {
    sourcemap: false,
  },
});
