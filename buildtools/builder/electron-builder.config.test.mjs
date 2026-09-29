import path from "node:path";
import { describe, expect, it } from "vitest";
import { FileMatcher, getMainFileMatchers } from "app-builder-lib/out/fileMatcher.js";
import { doMergeConfigs } from "app-builder-lib/out/util/config/config.js";
import config from "./electron-builder.config.ts";

describe("发行包平台依赖筛选", () => {
  it.each(["win", "mac", "linux"])("%s 平台规则不会扩大应用文件白名单", (section) => {
    const root = path.resolve("fixture");
    const normalized = doMergeConfigs([structuredClone(config)]);
    const matchers = getMainFileMatchers(
      root,
      path.resolve("output"),
      (value) => value.replaceAll("${arch}", "x64"),
      normalized[section],
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
      ["userdata/private.db", "input/source.txt", "output/result.txt", "src/index.ts"].some(
        included,
      ),
    ).toBe(false);
  });

  it.each([
    ["win", "win32", "x64"],
    ["win", "win32", "arm64"],
    ["mac", "darwin", "arm64"],
    ["linux", "linux", "x64"],
  ])("%s/%s/%s 只保留目标 esbuild，包括嵌套依赖", (section, platform, arch) => {
    const root = path.resolve("fixture");
    const matcher = new FileMatcher(
      root,
      path.resolve("output"),
      (value) => value.replaceAll("${arch}", arch),
      ["**/*", ...(config[section].files ?? [])],
    );
    const filter = matcher.createFilter();
    const packages = ["win32-x64", "win32-arm64", "darwin-arm64", "linux-x64"];
    for (const prefix of ["node_modules", "node_modules/parent/node_modules"]) {
      const retained = packages.filter((name) => {
        const relative = `${prefix}/@esbuild/${name}/package.json`;
        return filter(path.join(root, relative), {
          isDirectory: () => false,
          moduleFullFilePath: relative,
        });
      });
      expect(retained).toEqual([`${platform}-${arch}`]);
    }
    expect(
      filter(path.join(root, "node_modules/esbuild/lib/main.js"), {
        isDirectory: () => false,
        moduleFullFilePath: "node_modules/esbuild/lib/main.js",
      }),
    ).toBe(true);
  });
});
