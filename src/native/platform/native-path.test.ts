import path from "node:path";

import { describe, expect, it } from "vitest";

import { NativePathPolicy } from "./native-path";

describe("原生路径策略", () => {
  it("Windows 绝对路径转换为 namespaced 路径", () => {
    const policy = new NativePathPolicy("win32");

    const result = policy.to_native_path("C:\\very\\deep\\file.txt");

    expect(result).toBe("\\\\?\\C:\\very\\deep\\file.txt");
  });

  it("非 Windows 平台保持原路径不变", () => {
    const policy = new NativePathPolicy("linux");

    const result = policy.to_native_path("/tmp/very/deep/file.txt");

    expect(result).toBe("/tmp/very/deep/file.txt");
  });

  it("Windows 路径身份按解析后的小写路径比较", () => {
    const policy = new NativePathPolicy("win32");

    const result = policy.to_identity_path("C:\\Project\\Demo.lg");

    expect(result).toBe(path.win32.resolve("C:\\Project\\Demo.lg").toLowerCase());
  });

  it.each([
    ["C:\\", true],
    ["C:/", true],
    ["C:\\Project\\Demo.lg", false],
    ["\\\\server\\share\\", true],
    ["\\\\server\\share\\Demo.lg", false],
  ] as const)("按 Windows 规则判断文件系统根目录：%s", (target_path, expected) => {
    const policy = new NativePathPolicy("win32");

    const result = policy.is_filesystem_root(target_path);

    expect(result).toBe(expected);
  });

  it.each([
    ["/", true],
    ["/tmp/demo.lg", false],
  ] as const)("按 POSIX 规则判断文件系统根目录：%s", (target_path, expected) => {
    const policy = new NativePathPolicy("linux");

    const result = policy.is_filesystem_root(target_path);

    expect(result).toBe(expected);
  });
});
