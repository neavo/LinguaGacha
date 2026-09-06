import { describe, expect, it } from "vitest";
import { build_app_version_argument, resolve_app_version_from_argv } from "./app-version";

describe("桌面启动版本", () => {
  it("窗口参数将发布版本交付给 preload", () => {
    const version = "v1.2.3-beta.1+build.42";
    expect(resolve_app_version_from_argv(["electron", build_app_version_argument(version)])).toBe(
      version,
    );
  });

  it.each([[], ["--app-version="], ["--app-version= "]])("拒绝不完整的启动版本 %j", (...argv) => {
    expect(() => resolve_app_version_from_argv(argv)).toThrow(
      "App version launch argument is missing or empty.",
    );
  });
});
