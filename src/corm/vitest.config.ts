import { configDefaults, defineConfig } from "vitest/config";

const configUrl = (import.meta as unknown as { url: string }).url;
const root = decodeURIComponent(configUrl.replace(/^file:\/\//, "")).replace(
  /\/[^/]+$/,
  "",
);

export default defineConfig({
  resolve: {
    alias: {
      corm: `${root}/src`,
    },
  },
  test: {
    include: ["test/**/*.ts"],
    exclude: [...configDefaults.exclude, "test/common.ts", "test/common/**"],
  },
});
