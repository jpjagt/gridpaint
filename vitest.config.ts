import { defineConfig, configDefaults } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    // .claire / .claude hold agent worktrees with duplicated sources; don't run their tests
    exclude: [...configDefaults.exclude, ".claire/**", ".claude/**"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
