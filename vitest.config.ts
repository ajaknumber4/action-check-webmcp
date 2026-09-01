import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
    projects: [
      {
        test: {
          name: "core",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.dom.test.tsx"],
        },
      },
      {
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["tests/**/*.dom.test.tsx"],
          setupFiles: ["./tests/setup-dom.ts"],
        },
      },
    ],
  },
});
