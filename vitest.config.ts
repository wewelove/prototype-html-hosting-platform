import path from "node:path";
import { defineConfig } from "vitest/config";

// server-only 在 React Server 环境外会主动抛错，测试中用空 stub 替代。
const serverOnlyStub = path.resolve(__dirname, "scripts/stubs/server-only.js");

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": serverOnlyStub,
    },
  },
  test: {
    // 排除 Next.js 构建产物中的测试副本，避免重复收集。
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**", "tests/e2e/**"],
  },
});
