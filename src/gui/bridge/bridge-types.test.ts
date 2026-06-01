import { describe, expectTypeOf, it } from "vitest";

import type {
  DesktopBackendApiInfo,
  DesktopPathPickResult,
  DesktopPlatform,
  DesktopRendererDiagnosticsPayload,
  DesktopShellInfo,
  DesktopSystemProxyStartupNotice,
  DesktopUpdateDownloadProgress,
  DesktopUpdateDownloadRequest,
  DesktopUpdateDownloadResult,
  DesktopUpdateFallbackReason,
  DesktopUpdateLaunchRequest,
  DesktopUpdateLaunchResult,
  ThemeMode,
  TitleBarControlSide,
} from "./bridge-types";

describe("bridge-types", () => {
  it("桌面桥接契约保持可序列化的 renderer 消费形状", () => {
    expectTypeOf<ThemeMode>().toEqualTypeOf<"light" | "dark">();
    expectTypeOf<TitleBarControlSide>().toEqualTypeOf<"left" | "right" | "none">();
    expectTypeOf<DesktopPlatform>().toMatchTypeOf<string>();
    expectTypeOf<DesktopSystemProxyStartupNotice>().toMatchTypeOf<{
      detected: boolean;
      proxiedOriginCount: number;
      proxyDisplay: string | null;
    }>();
    expectTypeOf<DesktopBackendApiInfo>().toMatchTypeOf<{
      baseUrl: string;
      systemProxyStartupNotice: DesktopSystemProxyStartupNotice;
    }>();
    expectTypeOf<DesktopShellInfo>().toMatchTypeOf<{
      platform: DesktopPlatform;
      usesTitleBarOverlay: boolean;
      titleBarHeight: number;
      titleBarControlSide: TitleBarControlSide;
      titleBarSafeAreaStart: number;
      titleBarSafeAreaEnd: number;
    }>();
    expectTypeOf<DesktopPathPickResult>().toMatchTypeOf<{
      canceled: boolean;
      paths: string[];
    }>();
    expectTypeOf<DesktopUpdateDownloadRequest>().toMatchTypeOf<{
      latest_version: string;
      release_url: string;
      windows_x64_zip_url: string | null;
    }>();
    expectTypeOf<DesktopUpdateDownloadProgress>().toMatchTypeOf<{
      request_id: string;
      progress_percent: number;
      downloaded_bytes: number;
      total_bytes: number | null;
    }>();
    expectTypeOf<DesktopUpdateFallbackReason>().toEqualTypeOf<
      "unsupported_platform" | "missing_windows_x64_zip_url" | "target_dir_not_writable"
    >();
    expectTypeOf<DesktopUpdateDownloadResult>().toMatchTypeOf<
      | { status: "downloaded"; latest_version: string; release_url: string; zip_path: string }
      | {
          status: "fallback_to_release_page";
          release_url: string;
          reason: DesktopUpdateFallbackReason;
        }
    >();
    expectTypeOf<DesktopUpdateLaunchRequest>().toMatchTypeOf<{
      latest_version: string;
      zip_path: string;
    }>();
    expectTypeOf<DesktopUpdateLaunchResult>().toMatchTypeOf<{ status: "launched" }>();
    expectTypeOf<DesktopRendererDiagnosticsPayload>().toMatchTypeOf<object>();
  });
});
