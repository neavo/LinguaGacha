import { describe, expect, it } from "vitest";

import {
  build_windows_release_zip_name,
  is_windows_release_zip_name_for_arch,
  normalize_windows_release_arch,
  select_windows_release_zip_url,
  select_windows_release_zip_urls,
} from "./windows-update-target";

describe("windows-update-target", () => {
  it("把外部架构值收口成 Windows 发布架构", () => {
    expect(normalize_windows_release_arch("x64")).toBe("x64");
    expect(normalize_windows_release_arch("arm64")).toBe("arm64");
    expect(normalize_windows_release_arch("ia32")).toBeNull();
    expect(normalize_windows_release_arch("")).toBeNull();
    expect(normalize_windows_release_arch(undefined)).toBeNull();
  });

  it("按版本和架构生成 Windows release zip 文件名", () => {
    expect(build_windows_release_zip_name("1.2.4", "x64")).toBe(
      "LinguaGacha_v1.2.4_Windows_x64.zip",
    );
    expect(build_windows_release_zip_name("1.2.4", "arm64")).toBe(
      "LinguaGacha_v1.2.4_Windows_arm64.zip",
    );
  });

  it("从 release assets 中解析 x64 与 arm64 zip 下载地址", () => {
    const urls = select_windows_release_zip_urls(
      [
        {
          name: "LinguaGacha_v1.2.4_Windows_x64.zip",
          browser_download_url: " https://example.com/x64.zip ",
        },
        {
          name: "LinguaGacha_v1.2.4_Windows_arm64.zip",
          browser_download_url: "https://example.com/arm64.zip",
        },
        {
          name: "LinguaGacha_v1.2.4_Linux_x86_64.AppImage",
          browser_download_url: "https://example.com/linux.AppImage",
        },
      ],
      "1.2.4",
    );

    expect(urls).toEqual({
      x64: "https://example.com/x64.zip",
      arm64: "https://example.com/arm64.zip",
    });
  });

  it("允许 release asset 名带构建前缀并跳过坏载荷和空 URL", () => {
    const urls = select_windows_release_zip_urls(
      [
        null,
        {
          name: "LinguaGacha_MANUAL_BUILD_v1.2.4_Windows_x64.zip",
          browser_download_url: "",
        },
        {
          name: "LinguaGacha_MANUAL_BUILD_v1.2.4_Windows_arm64.zip",
          browser_download_url: "https://example.com/prefixed-arm64.zip",
        },
        {
          name: "LinguaGacha_MANUAL_BUILD_v1.2.5_Windows_x64.zip",
          browser_download_url: "https://example.com/wrong-version.zip",
        },
      ],
      "1.2.4",
    );

    expect(urls).toEqual({
      arm64: "https://example.com/prefixed-arm64.zip",
    });
  });

  it("按当前架构选择 zip URL，缺失当前架构时返回 null", () => {
    expect(select_windows_release_zip_url({ x64: "https://example.com/x64.zip" }, "x64")).toBe(
      "https://example.com/x64.zip",
    );
    expect(select_windows_release_zip_url({ x64: "https://example.com/x64.zip" }, "arm64")).toBe(
      null,
    );
    expect(select_windows_release_zip_url({ arm64: "   " }, "arm64")).toBeNull();
  });

  it("校验本地 zip 文件名的版本和架构", () => {
    expect(
      is_windows_release_zip_name_for_arch(
        "LinguaGacha_v1.2.4_Windows_arm64.zip",
        "1.2.4",
        "arm64",
      ),
    ).toBe(true);
    expect(
      is_windows_release_zip_name_for_arch(
        "LinguaGacha_MANUAL_BUILD_v1.2.4_Windows_arm64.zip",
        "1.2.4",
        "arm64",
      ),
    ).toBe(true);
    expect(
      is_windows_release_zip_name_for_arch("LinguaGacha_v1.2.4_Windows_x64.zip", "1.2.4", "arm64"),
    ).toBe(false);
    expect(
      is_windows_release_zip_name_for_arch(
        "LinguaGacha_v1.2.5_Windows_arm64.zip",
        "1.2.4",
        "arm64",
      ),
    ).toBe(false);
    expect(
      is_windows_release_zip_name_for_arch(
        "../LinguaGacha_v1.2.4_Windows_arm64.zip",
        "1.2.4",
        "arm64",
      ),
    ).toBe(false);
  });
});
