import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: [
      { find: /^@\/config\/(.*)$/, replacement: path.resolve(__dirname, "config/$1") },
      { find: /^@\/scene\/(.*)$/, replacement: path.resolve(__dirname, "scene/$1") },
      { find: /^@\/ai\/(.*)$/, replacement: path.resolve(__dirname, "ai/$1") },
      { find: /^@\/models\/(.*)$/, replacement: path.resolve(__dirname, "models/$1") },
      { find: /^@\/services\/(.*)$/, replacement: path.resolve(__dirname, "services/$1") },
      { find: /^@\/lib\/storage$/, replacement: path.resolve(__dirname, "lib/storage/index.ts") },
      { find: /^@\/lib\/queue$/, replacement: path.resolve(__dirname, "lib/queue/index.ts") },
      { find: /^@\/lib\/db$/, replacement: path.resolve(__dirname, "lib/db/index.ts") },
      { find: /^@\/(.*)$/, replacement: path.resolve(__dirname, "src/$1") },
    ],
  },
});
