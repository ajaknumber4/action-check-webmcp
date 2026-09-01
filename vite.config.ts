import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { socialNeuronCanaryBrokerPlugin } from "./server/social-neuron-staging/vite-plugin.ts";

export default defineConfig({
  plugins: [react(), socialNeuronCanaryBrokerPlugin()],
  build: {
    sourcemap: false,
  },
});
