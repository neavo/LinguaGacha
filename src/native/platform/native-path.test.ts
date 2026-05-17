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

    expect(result).toBe(path.resolve("C:\\Project\\Demo.lg").toLowerCase());
  });
});
