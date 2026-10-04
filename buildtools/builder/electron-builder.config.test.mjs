import path from "node:path";
import { expect, it } from "vitest";
import { getMainFileMatchers } from "app-builder-lib/out/fileMatcher.js";
import { doMergeConfigs } from "app-builder-lib/out/util/config/config.js";
import config from "./electron-builder.config.ts";

it("发行包包含运行资源并排除用户数据和源码", () => {
  const root = path.resolve("fixture");
  const normalized = doMergeConfigs([structuredClone(config)]);
  const matchers = getMainFileMatchers(
    root,
    path.resolve("output"),
    (value) => value.replaceAll("${arch}", "x64"),
    normalized.win,
    {
      info: {
        projectDir: root,
        buildResourcesDir: "public",
        config: normalized,
        debugLogger: { isEnabled: false },
      },
    },
    path.join(root, "build/release"),
    false,
  );
  // 观察归一化后的完整匹配结果，覆盖默认包含规则意外扩大范围的回归。
  const included = (relative) =>
    matchers.some((matcher) =>
      matcher.createFilter()(path.join(root, relative), { isDirectory: () => false }),
    );
  expect(
    [
      "build/dist/index.html",
      "build/dist-electron/index.js",
      "builtin/fixture.txt",
      "package.json",
    ].every(included),
  ).toBe(true);
  expect(
    ["userdata/private.db", "input/source.txt", "output/result.txt", "src/index.ts"].some(included),
  ).toBe(false);
});
